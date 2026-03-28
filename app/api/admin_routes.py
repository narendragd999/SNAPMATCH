from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database.db import SessionLocal
from app.models.user import User
from app.models.event import Event
from app.models.cluster import Cluster
from app.core.dependencies import get_current_user, get_db
from app.core.security import hash_password
from app.core.plans import VALID_PLAN_TYPES
from app.services.faiss_manager import FaissManager
from app.core.config import INDEXES_PATH, STORAGE_PATH
from app.services.storage_cleanup import delete_event_storage
from app.models.platform_settings import PlatformSetting
from app.api.analytics_routes import log_activity
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
import os

router = APIRouter(prefix="/admin", tags=["admin"])


def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


class UserUpdateRequest(BaseModel):
    email:     Optional[EmailStr] = None
    plan_type: Optional[str]      = None
    role:      Optional[str]      = None
    password:  Optional[str]      = None


class UserCreateRequest(BaseModel):
    email:     EmailStr
    password:  str
    plan_type: str = "free"
    role:      str = "owner"


# ── Settings allowed keys ─────────────────────────────────────────────────────
# Pricing config (free_photo_quota, free_guest_quota, free_validity_days,
# min_photo_quota, max_photo_quota, max_guest_quota, base_event_fee_paise)
# has been moved to the pricing_config table.
# Manage it via GET/PUT /pricing/config (pricing_routes.py).
# Only feature flags and non-pricing platform settings remain here.

SETTINGS_SCHEMA: dict[str, dict] = {
    "upload_photo_enabled": {
        "type":    "bool",
        "default": False,
        "label":   "Guest photo upload on public page",
    },
}

ALLOWED_KEYS = set(SETTINGS_SCHEMA.keys())


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
def admin_stats(db: Session = Depends(get_db), _: User = Depends(get_admin_user)):
    total_users  = db.query(User).count()
    total_events = db.query(Event).count()
    total_images = db.query(func.sum(Event.image_count)).scalar() or 0
    total_faces  = db.query(func.sum(Event.total_faces)).scalar() or 0

    plan_dist = (
        db.query(User.plan_type, func.count(User.id))
        .group_by(User.plan_type).all()
    )
    processing_dist = (
        db.query(Event.processing_status, func.count(Event.id))
        .group_by(Event.processing_status).all()
    )

    return {
        "total_users":             total_users,
        "total_events":            total_events,
        "total_images":            int(total_images),
        "total_faces":             int(total_faces),
        "plan_distribution":       {p: c for p, c in plan_dist},
        "processing_distribution": {s: c for s, c in processing_dist},
    }


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
def list_users(
    page:   int = Query(1, ge=1),
    limit:  int = Query(20, ge=1, le=100),
    search: str = Query(""),
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = db.query(User)
    if search:
        query = query.filter(User.email.ilike(f"%{search}%"))
    total  = query.count()
    users  = query.order_by(User.id.desc()).offset((page - 1) * limit).limit(limit).all()
    result = []
    for u in users:
        event_count = db.query(Event).filter(Event.owner_id == u.id).count()
        result.append({
            "id": u.id, "email": u.email, "role": u.role,
            "plan_type": u.plan_type, "created_at": u.created_at,
            "event_count": event_count,
        })
    return {"total": total, "page": page, "limit": limit,
            "total_pages": (total + limit - 1) // limit, "users": result}


@router.post("/users")
def create_user(
    data: UserCreateRequest, 
    request: Request,
    db: Session = Depends(get_db), 
    admin: User = Depends(get_admin_user)
):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if data.plan_type not in VALID_PLAN_TYPES:
        raise HTTPException(status_code=400, detail=f"plan_type must be one of {VALID_PLAN_TYPES}")
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        plan_type=data.plan_type,
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Log activity
    log_activity(
        db=db,
        activity_type="admin_user_create",
        action="admin_created_user",
        user_id=admin.id,
        description=f"Admin created user: {data.email} (role: {data.role}, plan: {data.plan_type})",
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        request_path="/admin/users",
        request_method="POST",
        metadata={"created_user_id": user.id, "created_user_email": data.email},
    )
    
    return {"id": user.id, "email": user.email, "role": user.role, "plan_type": user.plan_type}


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    data: UserUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    changes = []
    if data.email is not None:
        if db.query(User).filter(User.email == data.email, User.id != user_id).first():
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = data.email
        changes.append(f"email: {data.email}")
    if data.plan_type is not None:
        if data.plan_type not in VALID_PLAN_TYPES:
            raise HTTPException(status_code=400, detail=f"plan_type must be one of {VALID_PLAN_TYPES}")
        user.plan_type = data.plan_type
        changes.append(f"plan: {data.plan_type}")
    if data.role is not None:
        if data.role not in ("owner", "admin"):
            raise HTTPException(status_code=400, detail="Invalid role")
        user.role = data.role
        changes.append(f"role: {data.role}")
    if data.password is not None:
        if len(data.password) < 6:
            raise HTTPException(status_code=400, detail="Password min 6 chars")
        user.password_hash = hash_password(data.password)
        changes.append("password updated")
    
    db.commit()
    db.refresh(user)
    
    # Log activity
    if changes:
        log_activity(
            db=db,
            activity_type="admin_user_update",
            action="admin_updated_user",
            user_id=admin.id,
            description=f"Admin updated user {user.email}: {', '.join(changes)}",
            ip_address=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
            request_path=f"/admin/users/{user_id}",
            request_method="PATCH",
            metadata={"target_user_id": user_id, "changes": changes},
        )
    
    return {"id": user.id, "email": user.email, "role": user.role, "plan_type": user.plan_type}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int, 
    request: Request,
    db: Session = Depends(get_db), 
    admin: User = Depends(get_admin_user)
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_email = user.email  # Store for logging
    events = db.query(Event).filter(Event.owner_id == user_id).all()
    event_count = len(events)
    for event in events:
        try:
            delete_event_storage(event.id)
        except Exception:
            pass
        db.query(Cluster).filter(Cluster.event_id == event.id).delete()
        db.delete(event)
    db.delete(user)
    db.commit()
    
    # Log activity
    log_activity(
        db=db,
        activity_type="admin_user_delete",
        action="admin_deleted_user",
        user_id=admin.id,
        description=f"Admin deleted user: {user_email} with {event_count} events",
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        request_path=f"/admin/users/{user_id}",
        request_method="DELETE",
        metadata={"deleted_user_id": user_id, "deleted_user_email": user_email, "events_deleted": event_count},
    )
    
    return {"success": True}


# ── Events ────────────────────────────────────────────────────────────────────

@router.get("/events")
def list_events(
    page:   int = Query(1, ge=1),
    limit:  int = Query(20, ge=1, le=100),
    search: str = Query(""),
    status: str = Query(""),
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = db.query(Event)
    if search:
        query = query.filter(Event.name.ilike(f"%{search}%"))
    if status:
        query = query.filter(Event.processing_status == status)
    total  = query.count()
    events = query.order_by(Event.id.desc()).offset((page - 1) * limit).limit(limit).all()
    result = []
    for e in events:
        owner = db.query(User).filter(User.id == e.owner_id).first()
        result.append({
            "id": e.id, "name": e.name,
            "owner_email":       owner.email if owner else "deleted",
            "owner_plan":        owner.plan_type if owner else "-",
            "processing_status": e.processing_status,
            "image_count":       e.image_count,
            "total_faces":       e.total_faces,
            "total_clusters":    e.total_clusters,
            "public_status":     e.public_status,
            "expires_at":        e.expires_at,
            "created_at":        e.created_at,
        })
    return {"total": total, "page": page, "limit": limit,
            "total_pages": (total + limit - 1) // limit, "events": result}


@router.delete("/events/{event_id}")
def delete_event(
    event_id: int, 
    request: Request,
    db: Session = Depends(get_db), 
    admin: User = Depends(get_admin_user)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    event_name = event.name
    try:
        delete_event_storage(event_id)
    except Exception:
        pass
    db.query(Cluster).filter(Cluster.event_id == event_id).delete()
    db.delete(event)
    db.commit()
    
    # Log activity
    log_activity(
        db=db,
        activity_type="admin_event_delete",
        action="admin_deleted_event",
        user_id=admin.id,
        event_id=event_id,
        description=f"Admin deleted event: {event_name}",
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        request_path=f"/admin/events/{event_id}",
        request_method="DELETE",
    )
    
    return {"success": True}


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: User = Depends(get_admin_user)):
    """
    Returns platform feature-flag settings (not pricing config).
    Pricing config is managed via GET/PUT /pricing/config.
    """
    rows = {r.key: r.value for r in db.query(PlatformSetting).all()}
    result = {}
    for key, schema in SETTINGS_SCHEMA.items():
        raw = rows.get(key)
        if raw is None:
            result[key] = schema["default"]
        elif schema["type"] == "int":
            result[key] = int(raw)
        elif schema["type"] == "bool":
            result[key] = raw.lower() == "true"
        else:
            result[key] = raw
    return {"values": result, "schema": SETTINGS_SCHEMA}


@router.patch("/settings")
def update_settings(body: dict, db: Session = Depends(get_db), _: User = Depends(get_admin_user)):
    """
    Accepts {key: value} pairs. Only ALLOWED_KEYS are written.
    Pricing keys are no longer accepted here — use PUT /pricing/config.
    """
    errors = {}
    for key, value in body.items():
        if key not in ALLOWED_KEYS:
            continue
        schema = SETTINGS_SCHEMA[key]

        if schema["type"] == "int":
            try:
                v = int(value)
            except (ValueError, TypeError):
                errors[key] = "must be an integer"
                continue
            if "min" in schema and v < schema["min"]:
                errors[key] = f"minimum is {schema['min']}"
                continue
            if "max" in schema and v > schema["max"]:
                errors[key] = f"maximum is {schema['max']}"
                continue
            str_value = str(v)
        elif schema["type"] == "bool":
            str_value = "true" if str(value).lower() in ("true", "1", "yes") else "false"
        else:
            str_value = str(value)

        row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
        if row:
            row.value = str_value
        else:
            db.add(PlatformSetting(key=key, value=str_value))

    if errors:
        raise HTTPException(status_code=422, detail=errors)

    db.commit()
    return {"success": True}


# ── Cleanup ───────────────────────────────────────────────────────────────────

@router.post("/cleanup")
def trigger_cleanup(_: User = Depends(get_admin_user)):
    from app.workers.tasks import cleanup_expired_events
    task = cleanup_expired_events.delay()
    return {"message": "Cleanup task triggered", "task_id": task.id}
