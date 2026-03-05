from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database.db import SessionLocal
from app.models.user import User
from app.models.event import Event
from app.models.cluster import Cluster
from app.core.dependencies import get_current_user, get_db
from app.core.security import hash_password
from app.core.plans import PLANS
from app.services.faiss_manager import FaissManager
from app.core.config import INDEXES_PATH, STORAGE_PATH
from app.services.storage_cleanup import delete_event_storage   # ← MinIO fix
from app.models.platform_settings import PlatformSetting
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
    email: Optional[EmailStr] = None
    plan_type: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None

class UserCreateRequest(BaseModel):
    email: EmailStr
    password: str
    plan_type: str = "free"
    role: str = "owner"


@router.get("/stats")
def admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
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
    offset = (page - 1) * limit
    users  = query.order_by(User.id.desc()).offset(offset).limit(limit).all()

    result = []
    for u in users:
        event_count = db.query(Event).filter(Event.owner_id == u.id).count()
        result.append({
            "id":          u.id,
            "email":       u.email,
            "role":        u.role,
            "plan_type":   u.plan_type,
            "created_at":  u.created_at,
            "event_count": event_count,
        })

    return {
        "total":       total,
        "page":        page,
        "limit":       limit,
        "total_pages": (total + limit - 1) // limit,
        "users":       result,
    }


@router.post("/users")
def create_user(
    data: UserCreateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    if data.plan_type not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan type")

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        plan_type=data.plan_type,
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"id": user.id, "email": user.email, "role": user.role, "plan_type": user.plan_type}


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    data: UserUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if data.email is not None:
        existing = db.query(User).filter(User.email == data.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = data.email

    if data.plan_type is not None:
        if data.plan_type not in PLANS:
            raise HTTPException(status_code=400, detail="Invalid plan type")
        user.plan_type = data.plan_type

    if data.role is not None:
        if data.role not in ("owner", "admin"):
            raise HTTPException(status_code=400, detail="Invalid role")
        user.role = data.role

    if data.password is not None:
        if len(data.password) < 6:
            raise HTTPException(status_code=400, detail="Password min 6 chars")
        user.password_hash = hash_password(data.password)

    db.commit()
    db.refresh(user)
    return {"id": user.id, "email": user.email, "role": user.role, "plan_type": user.plan_type}


# --------------------------------------------------
# Delete User + ALL their events and storage files
# --------------------------------------------------
@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_admin_user),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    events = db.query(Event).filter(Event.owner_id == user_id).all()

    # Capture storage info before DB records are gone
    event_assets = [(e.id, e.cover_image) for e in events]

    # Delete DB records
    for event in events:
        db.query(Cluster).filter(Cluster.event_id == event.id).delete()
        db.delete(event)

    db.commit()
    db.delete(user)
    db.commit()

    # ── STORAGE: delete FAISS + MinIO/local files for every event ────────────
    for event_id, cover_image in event_assets:
        delete_event_storage(event_id, cover_image=cover_image)

    return {"message": f"User {user_id} and all data deleted"}


# --------------------------------------------------
# Force Delete Event (admin)
# --------------------------------------------------
@router.delete("/events/{event_id}")
def admin_delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    cover_image = event.cover_image  # capture before delete

    # Delete DB records
    db.query(Cluster).filter(Cluster.event_id == event_id).delete()
    db.delete(event)
    db.commit()

    # ── STORAGE: delete FAISS + MinIO/local files ─────────────────────────────
    delete_event_storage(event_id, cover_image=cover_image)

    return {"message": f"Event {event_id} deleted"}


@router.get("/events")
def list_all_events(
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
    offset = (page - 1) * limit
    events = query.order_by(Event.created_at.desc()).offset(offset).limit(limit).all()

    result = []
    for e in events:
        owner = db.query(User).filter(User.id == e.owner_id).first()
        result.append({
            "id":                e.id,
            "name":              e.name,
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

    return {
        "total":       total,
        "page":        page,
        "limit":       limit,
        "total_pages": (total + limit - 1) // limit,
        "events":      result,
    }


@router.get("/plans")
def get_plans(_: User = Depends(get_admin_user)):
    return PLANS


@router.post("/cleanup")
def trigger_cleanup(_: User = Depends(get_admin_user)):
    from app.workers.tasks import cleanup_expired_events
    task = cleanup_expired_events.delay()
    return {"message": "Cleanup task triggered", "task_id": task.id}


@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    _:  User    = Depends(get_admin_user),
):
    rows = db.query(PlatformSetting).all()
    return {r.key: r.value for r in rows}


@router.patch("/settings")
def update_settings(
    body: dict,
    db:   Session = Depends(get_db),
    _:    User    = Depends(get_admin_user),
):
    ALLOWED_KEYS = {"upload_photo_enabled"}
    for key, value in body.items():
        if key not in ALLOWED_KEYS:
            continue
        row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
        if row:
            row.value = str(value).lower()
        else:
            db.add(PlatformSetting(key=key, value=str(value).lower()))
    db.commit()
    return {"success": True}