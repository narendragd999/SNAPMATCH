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
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
import shutil
import os

router = APIRouter(prefix="/admin", tags=["admin"])


# --------------------------------------------------
# Superuser Guard
# --------------------------------------------------
def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# --------------------------------------------------
# Pydantic Schemas
# --------------------------------------------------
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


# --------------------------------------------------
# Dashboard Stats
# --------------------------------------------------
@router.get("/stats")
def admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    total_users  = db.query(User).count()
    total_events = db.query(Event).count()
    total_images = db.query(func.sum(Event.image_count)).scalar() or 0
    total_faces  = db.query(func.sum(Event.total_faces)).scalar() or 0

    # Plan distribution
    plan_dist = (
        db.query(User.plan_type, func.count(User.id))
        .group_by(User.plan_type)
        .all()
    )
    plan_distribution = {p: c for p, c in plan_dist}

    # Processing status distribution
    status_dist = (
        db.query(Event.processing_status, func.count(Event.id))
        .group_by(Event.processing_status)
        .all()
    )
    status_distribution = {s: c for s, c in status_dist}

    # Recent signups (last 7 days)
    from datetime import timedelta
    week_ago = datetime.utcnow() - timedelta(days=7)
    new_users_week = db.query(User).filter(User.created_at >= week_ago).count()

    # Events expiring in next 3 days
    three_days = datetime.utcnow() + timedelta(days=3)
    expiring_soon = db.query(Event).filter(
        Event.expires_at != None,
        Event.expires_at <= three_days,
        Event.expires_at >= datetime.utcnow()
    ).count()

    return {
        "total_users":         total_users,
        "total_events":        total_events,
        "total_images":        int(total_images),
        "total_faces":         int(total_faces),
        "plan_distribution":   plan_distribution,
        "status_distribution": status_distribution,
        "new_users_this_week": new_users_week,
        "expiring_soon":       expiring_soon,
    }


# --------------------------------------------------
# List Users
# --------------------------------------------------
@router.get("/users")
def list_users(
    page:   int = Query(1, ge=1),
    limit:  int = Query(20, ge=1, le=100),
    search: str = Query(""),
    plan:   str = Query(""),
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    query = db.query(User)

    if search:
        query = query.filter(User.email.ilike(f"%{search}%"))

    if plan:
        query = query.filter(User.plan_type == plan)

    total  = query.count()
    offset = (page - 1) * limit
    users  = query.order_by(User.created_at.desc()).offset(offset).limit(limit).all()

    result = []
    for u in users:
        event_count = db.query(Event).filter(Event.owner_id == u.id).count()
        result.append({
            "id":          u.id,
            "email":       u.email,
            "role":        u.role,
            "plan_type":   u.plan_type,
            "event_count": event_count,
            "created_at":  u.created_at,
        })

    return {
        "total":       total,
        "page":        page,
        "limit":       limit,
        "total_pages": (total + limit - 1) // limit,
        "users":       result,
    }


# --------------------------------------------------
# Get Single User
# --------------------------------------------------
@router.get("/users/{user_id}")
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    events = db.query(Event).filter(Event.owner_id == user_id).all()

    return {
        "id":         user.id,
        "email":      user.email,
        "role":       user.role,
        "plan_type":  user.plan_type,
        "created_at": user.created_at,
        "events": [
            {
                "id":                e.id,
                "name":              e.name,
                "processing_status": e.processing_status,
                "image_count":       e.image_count,
                "expires_at":        e.expires_at,
                "created_at":        e.created_at,
            }
            for e in events
        ],
    }


# --------------------------------------------------
# Create User
# --------------------------------------------------
@router.post("/users")
def create_user(
    data: UserCreateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    if data.plan_type not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan type")

    if data.role not in ("owner", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role")

    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        plan_type=data.plan_type,
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "id":        user.id,
        "email":     user.email,
        "role":      user.role,
        "plan_type": user.plan_type,
    }


# --------------------------------------------------
# Update User
# --------------------------------------------------
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
        existing = db.query(User).filter(
            User.email == data.email,
            User.id != user_id
        ).first()
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

    return {
        "id":        user.id,
        "email":     user.email,
        "role":      user.role,
        "plan_type": user.plan_type,
    }


# --------------------------------------------------
# Delete User (+ all their events/files)
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

    # Delete all user events + files
    events = db.query(Event).filter(Event.owner_id == user_id).all()
    for event in events:
        db.query(Cluster).filter(Cluster.event_id == event.id).delete()
        FaissManager.remove_index(event.id)

        for fname in [
            os.path.join(INDEXES_PATH, f"event_{event.id}.index"),
            os.path.join(INDEXES_PATH, f"event_{event.id}_map.npy"),
        ]:
            if os.path.exists(fname):
                os.remove(fname)

        folder = os.path.join(STORAGE_PATH, str(event.id))
        if os.path.exists(folder):
            shutil.rmtree(folder)

        if event.cover_image:
            cover = f"storage/covers/{event.cover_image}"
            if os.path.exists(cover):
                os.remove(cover)

        db.delete(event)

    db.commit()
    db.delete(user)
    db.commit()

    return {"message": f"User {user_id} and all data deleted"}


# --------------------------------------------------
# List All Events (admin view)
# --------------------------------------------------
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

    db.query(Cluster).filter(Cluster.event_id == event_id).delete()
    FaissManager.remove_index(event_id)

    for fname in [
        os.path.join(INDEXES_PATH, f"event_{event_id}.index"),
        os.path.join(INDEXES_PATH, f"event_{event_id}_map.npy"),
    ]:
        if os.path.exists(fname):
            os.remove(fname)

    folder = os.path.join(STORAGE_PATH, str(event_id))
    if os.path.exists(folder):
        shutil.rmtree(folder)

    if event.cover_image:
        cover = f"storage/covers/{event.cover_image}"
        if os.path.exists(cover):
            os.remove(cover)

    db.delete(event)
    db.commit()

    return {"message": f"Event {event_id} deleted"}


# --------------------------------------------------
# Plans Reference
# --------------------------------------------------
@router.get("/plans")
def get_plans(_: User = Depends(get_admin_user)):
    return PLANS


# --------------------------------------------------
# Manual Cleanup Trigger
# --------------------------------------------------
@router.post("/cleanup")
def trigger_cleanup(
    _: User = Depends(get_admin_user),
):
    from app.workers.tasks import cleanup_expired_events
    task = cleanup_expired_events.delay()
    return {"message": "Cleanup task triggered", "task_id": task.id}