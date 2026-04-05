"""
app/api/event_routes.py

Owner-only event management endpoints.

WORKFLOW:
  1. Owner uploads photos  → POST /upload/{event_id}
       - Files saved via storage_service (local / MinIO / R2)
       - Photo rows created (status='uploaded', approval_status='approved')
       - event.processing_status → 'queued'

  2. Owner clicks Process  → POST /events/{event_id}/process
       - Finds Photo rows: status='uploaded' AND approval_status='approved'
       - Fires process_event Celery task
       - event.processing_status → 'processing'

  3. Guest uploads photos  → POST /public/events/{token}/contribute
       - Photo rows created (status='uploaded', approval_status='pending')
       - event.image_count NOT incremented yet

  4. Owner approves guests → POST /events/{event_id}/guest-uploads/bulk-approve
       - approval_status → 'approved', image_count incremented
       - process_event Celery task fired (incremental)

STORAGE CHANGES (MinIO integration):
  - Cover images: storage_service.upload_cover() / delete_cover()
  - Event photo folders: storage_service.delete_event_folder()
  - Thumbnail/image serving: RedirectResponse to MinIO URL (minio/r2)
                              or FileResponse (local backend)
  - get_event response: cover_image_url built via storage_service.get_cover_url()
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, RedirectResponse
from typing import List
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.cluster import Cluster
from app.models.photo import Photo
from app.core.dependencies import get_current_user
from app.workers.tasks import process_event
from app.core.config import STORAGE_PATH, INDEXES_PATH, DEFAULT_EVENT_PIN
from app.services.search_service import search_face
from app.services import storage_service
from app.services.storage_service import STORAGE_BACKEND
from app.services.storage_cleanup import delete_event_storage
from app.api.analytics_routes import log_activity
from datetime import datetime, timedelta
from app.models.user import User
import redis as redis_lib
import uuid
import secrets
import os
import json


from pydantic import BaseModel, Field, validator
import re

# ═══════════════════════════════════════════════════════════════════════════════
# 🖌️  BRANDING SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════════

VALID_TEMPLATES = {"classic", "minimal", "wedding", "corporate", "dark"}
VALID_FONTS     = {"system", "playfair", "dm-serif", "cormorant",
                   "syne", "outfit", "josefin", "mono"}
_HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')



router = APIRouter(prefix="/events", tags=["events"])


def _user_from_token(token: str, db) -> "User | None":
    """
    Decode a JWT passed as a query param (?token=...) and return the User.
    Used by image/thumbnail endpoints since <img src> tags are plain browser
    GETs and cannot send Authorization headers.
    """
    try:
        from jose import jwt as jose_jwt
        try:
            from app.core.dependencies import SECRET_KEY, ALGORITHM
        except ImportError:
            SECRET_KEY = os.getenv("SECRET_KEY", "")
            ALGORITHM  = os.getenv("ALGORITHM", "HS256")

        if not token or not SECRET_KEY:
            return None

        payload = jose_jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            return None
        return db.query(User).filter(User.id == int(user_id)).first()
    except Exception:
        return None


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------
# Create Event
# --------------------------------------------------
@router.post("/")
def create_event(
    name: str = Form(...),
    description: str = Form(None),
    cover_image: UploadFile = File(None),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    expires_at = datetime.utcnow() + timedelta(days=30)

    while True:
        slug = str(uuid.uuid4())[:8]
        if not db.query(Event).filter(Event.slug == slug).first():
            break

    public_token = secrets.token_urlsafe(16)
    cover_filename = None

    if cover_image and cover_image.filename:
        ext = Path(cover_image.filename).suffix.lower() or ".jpg"
        unique_name = f"{uuid.uuid4()}{ext}"
        content = cover_image.file.read()
        # ── STORAGE: upload cover via storage_service (local/MinIO/R2) ──────
        storage_service.upload_cover(content, unique_name)
        cover_filename = unique_name

    event = Event(
        name=name,
        description=description,
        cover_image=cover_filename,
        slug=slug,
        public_token=public_token,
        owner_id=current_user.id,
        expires_at=expires_at,
        processing_status="pending",
        public_status="active",
    )
    # 🔒 Set default PIN so public page is protected from the start
    event.set_pin(DEFAULT_EVENT_PIN)
    db.add(event)
    db.commit()
    db.refresh(event)

    # Log activity
    log_activity(
        db=db,
        activity_type="event_create",
        action="event_created",
        user_id=current_user.id,
        event_id=event.id,
        description=f"Created event: {name}",
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        request_path="/events/",
        request_method="POST",
    )

    return {
        "id":            event.id,
        "name":          event.name,
        "slug":          event.slug,
        "public_token":  event.public_token,
        "expires_at":    event.expires_at,
        "cover_image":   event.cover_image,
        "cover_image_url": storage_service.get_cover_url(event.cover_image) if event.cover_image else None,
    }


# --------------------------------------------------
# Get My Events
# --------------------------------------------------
@router.get("/my")
def get_my_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    events = db.query(Event).filter(
        Event.owner_id == current_user.id
    ).order_by(Event.created_at.desc()).all()

    return [
        {
            "id":              e.id,
            "name":            e.name,
            "slug":            e.slug,
            "public_token":    e.public_token,
            "processing_status": e.processing_status,
            "image_count":     e.image_count,
            "public_status":   e.public_status,
            "expires_at":      e.expires_at,
            "created_at":      e.created_at,
            "cover_image":     e.cover_image,
            # ── STORAGE: return full URL, not raw filename ──────────────────
            "cover_image_url": storage_service.get_cover_url(e.cover_image) if e.cover_image else None,
        }
        for e in events
    ]


# --------------------------------------------------
# Get Single Event  (owner detail)
# --------------------------------------------------
@router.get("/{event_id}")
def get_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get single event details (owner view)."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    photo_status_counts = dict(
        db.query(Photo.status, func.count(Photo.id))
        .filter(Photo.event_id == event_id)
        .group_by(Photo.status)
        .all()
    )

    unprocessed = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.status == "uploaded",
        Photo.approval_status == "approved",
    ).count()

    pending_guest_uploads = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest",
        Photo.approval_status == "pending",
    ).count()

    # Guest management stats (graceful - returns 0 if table doesn't exist or no guests)
    try:
        from app.models.guest import Guest
        guest_count = db.query(func.count(Guest.id)).filter(Guest.event_id == event_id).scalar() or 0
        pending_notifications = db.query(func.count(Guest.id)).filter(
            Guest.event_id == event_id,
            Guest.email_sent == False
        ).scalar() or 0
    except:
        guest_count = 0
        pending_notifications = 0

    return {
        "id":                   event.id,
        "name":                 event.name,
        "slug":                 event.slug,
        "public_token":         event.public_token,
        "processing_status":    event.processing_status,
        "processing_progress":  event.processing_progress,
        "expires_at":           event.expires_at,
        "image_count":          event.image_count,
        "total_faces":          event.total_faces,
        "total_clusters":       event.total_clusters,
        "description":          event.description,
        "cover_image":          event.cover_image,
        "cover_image_url":      storage_service.get_cover_url(event.cover_image) if event.cover_image else None,
        "public_status":        event.public_status,
        "plan_type":            current_user.plan_type,
        # Billing / quota details used by owner dashboard controls
        "photo_quota":          event.photo_quota,
        "guest_quota":          event.guest_quota,
        "guest_uploads_used":   event.guest_uploads_used,
        "payment_status":       event.payment_status,
        "is_free_tier":         event.is_free_tier,
        "validity_days":        event.validity_days,
        "photo_status":         photo_status_counts,
        "unprocessed_count":    unprocessed,
        "has_new_photos":       unprocessed > 0,
        "pending_guest_uploads": pending_guest_uploads,
        "guest_upload_enabled": event.guest_upload_enabled,
        # 🎨 Watermark settings
        "watermark_enabled":    event.watermark_enabled,
        "watermark_config":     event.get_watermark_config(),
        # 🔒 PIN protection
        "pin_enabled":          event.pin_enabled,
        "template_id":           event.brand_template_id or "classic",
        "brand_logo_url":        event.brand_logo_url or "",
        "brand_primary_color":   event.brand_primary_color or "#3b82f6",
        "brand_accent_color":    event.brand_accent_color or "#60a5fa",
        "brand_font":            event.brand_font or "system",
        "brand_footer_text":     event.brand_footer_text or "",
        "brand_show_powered_by": bool(event.brand_show_powered_by),
        # 👥 Guest management
        "guest_count":          guest_count,
        "pending_notifications": pending_notifications,
        "has_guests":           guest_count > 0,
    }


# --------------------------------------------------
# Update Event  (name / description / cover / guest upload toggle)
# --------------------------------------------------
@router.patch("/{event_id}")
def update_event(
    event_id:    int,
    name:        str        = Form(None),
    description: str        = Form(None),
    cover_image: UploadFile = File(None),
    guest_upload_enabled: bool = Form(None),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update event details."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    changes = []
    if name is not None:
        event.name = name
        changes.append(f"name: {name}")
    if description is not None:
        event.description = description
        changes.append("description updated")
    if guest_upload_enabled is not None:
        event.guest_upload_enabled = guest_upload_enabled
        changes.append(f"guest_upload: {guest_upload_enabled}")

    if cover_image and cover_image.filename:
        if event.cover_image:
            storage_service.delete_cover(event.cover_image)

        ext = Path(cover_image.filename).suffix.lower() or ".jpg"
        unique_name = f"{uuid.uuid4()}{ext}"
        content = cover_image.file.read()
        storage_service.upload_cover(content, unique_name)
        event.cover_image = unique_name
        changes.append("cover_image updated")

    db.commit()
    db.refresh(event)

    # Log activity
    if changes:
        log_activity(
            db=db,
            activity_type="event_update",
            action="event_updated",
            user_id=current_user.id,
            event_id=event_id,
            description=f"Updated event: {', '.join(changes)}",
            ip_address=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
            request_path=f"/events/{event_id}",
            request_method="PATCH",
        )

    return {
        "id":              event.id,
        "name":            event.name,
        "description":     event.description,
        "cover_image":     event.cover_image,
        "cover_image_url": storage_service.get_cover_url(event.cover_image) if event.cover_image else None,
        "guest_upload_enabled": event.guest_upload_enabled,
        "watermark_enabled": event.watermark_enabled,
        "pin_enabled":       event.pin_enabled,
    }




# --------------------------------------------------
# Delete Event
# --------------------------------------------------
@router.delete("/{event_id}")
def delete_event(
    event_id: int,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    event_name = event.name  # Store for logging before deletion
    cover_image = event.cover_image  # Store cover image before deletion

    # Log activity BEFORE deleting the event (so FK constraint works)
    log_activity(
        db=db,
        activity_type="event_delete",
        action="event_deleted",
        user_id=current_user.id,
        event_id=event_id,
        description=f"Deleted event: {event_name}",
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        request_path=f"/events/{event_id}",
        request_method="DELETE",
    )

    # Delete DB records
    db.query(Cluster).filter(Cluster.event_id == event_id).delete()
    db.query(Photo).filter(Photo.event_id == event_id).delete()
    db.delete(event)
    db.commit()

    # ── STORAGE: delete FAISS + all files (local/MinIO/R2) ───────────────────
    # Runs after db.commit() so DB deletion always succeeds regardless of storage errors
    delete_event_storage(event_id, cover_image=cover_image)

    return {"message": "Event deleted successfully"}


# --------------------------------------------------
# Owner Thumbnail  ← works regardless of public_status
# GET /events/{event_id}/thumbnail/{image_name}?token=<jwt>
#
# WHY QUERY PARAM instead of Authorization header:
# Browser <img src="..."> tags never send headers — they make
# plain GET requests. Passing the JWT as a query param is the
# standard solution for image endpoints that need auth.
# --------------------------------------------------
@router.get("/{event_id}/thumbnail/{image_name}")
def owner_thumbnail(
    event_id:   int,
    image_name: str,
    token:      str,
    db: Session = Depends(get_db),
):
    current_user = _user_from_token(token, db)
    if not current_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    safe_name = Path(image_name).name
    base_name = os.path.splitext(safe_name)[0]

    # ── STORAGE: for MinIO/R2 → redirect to public URL; local → FileResponse ─
    if STORAGE_BACKEND != "local":
        # Try .webp thumbnail first, then fall back to .jpg
        for thumb_ext in (".webp", ".jpg"):
            thumb_filename = f"{base_name}{thumb_ext}"
            if storage_service.thumbnail_exists(event_id, thumb_filename):
                url = storage_service.get_thumbnail_url(event_id, thumb_filename)
                return RedirectResponse(url=url, status_code=302)
        # Fall back to full image
        for full_ext in (".jpg", ".jpeg", ".png", ".webp"):
            full_filename = f"{base_name}{full_ext}"
            if storage_service.file_exists(event_id, full_filename):
                url = storage_service.get_file_url(event_id, full_filename)
                return RedirectResponse(url=url, status_code=302)
        raise HTTPException(status_code=404, detail="Image not found")

    # ── Local backend: serve from filesystem ─────────────────────────────────
    thumb_dir = os.path.join(STORAGE_PATH, str(event_id), "thumbnails")
    for thumb_ext in (".webp", ".jpg", ".jpeg", ".png"):
        thumb_path = os.path.join(thumb_dir, f"{base_name}{thumb_ext}")
        if os.path.exists(thumb_path):
            return FileResponse(thumb_path)

    event_dir = os.path.join(STORAGE_PATH, str(event_id))
    for full_ext in ("", ".jpg", ".jpeg", ".png", ".webp"):
        full_path = os.path.join(event_dir, f"{base_name}{full_ext}")
        if os.path.exists(full_path):
            return FileResponse(full_path)

    raise HTTPException(status_code=404, detail="Image not found")


# --------------------------------------------------
# Owner Full Image  ← works regardless of public_status
# GET /events/{event_id}/image/{image_name}?token=<jwt>
# --------------------------------------------------
@router.get("/{event_id}/image/{image_name}")
def owner_image(
    event_id:   int,
    image_name: str,
    token:      str,
    db: Session = Depends(get_db),
):
    current_user = _user_from_token(token, db)
    if not current_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    safe_name = Path(image_name).name

    # ── STORAGE: MinIO/R2 → redirect; local → FileResponse ───────────────────
    if STORAGE_BACKEND != "local":
        if storage_service.file_exists(event_id, safe_name):
            url = storage_service.get_file_url(event_id, safe_name)
            return RedirectResponse(url=url, status_code=302)
        raise HTTPException(status_code=404, detail="Image not found")

    image_path = os.path.join(STORAGE_PATH, str(event_id), safe_name)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(image_path)


# --------------------------------------------------
# Owner Image Download  (forces download header)
# GET /events/{event_id}/download/{image_name}?token=<jwt>
# --------------------------------------------------
@router.get("/{event_id}/download/{image_name}")
def owner_download(
    event_id:   int,
    image_name: str,
    token:      str,
    db: Session = Depends(get_db),
):
    current_user = _user_from_token(token, db)
    if not current_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    safe_name = Path(image_name).name

    if STORAGE_BACKEND != "local":
        if storage_service.file_exists(event_id, safe_name):
            url = storage_service.get_file_url(event_id, safe_name)
            return RedirectResponse(url=url, status_code=302)
        raise HTTPException(status_code=404, detail="Image not found")

    image_path = os.path.join(STORAGE_PATH, str(event_id), safe_name)
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(
        image_path,
        media_type="application/octet-stream",
        filename=safe_name,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# --------------------------------------------------
# Owner Cluster Download ZIP
# GET /events/{event_id}/clusters/{cluster_id}/download?token=<jwt>
# --------------------------------------------------
@router.get("/{event_id}/clusters/{cluster_id}/download")
def owner_cluster_download(
    event_id:   int,
    cluster_id: int,
    token:      str,
    db: Session = Depends(get_db),
):
    import io, zipfile
    from fastapi.responses import StreamingResponse

    current_user = _user_from_token(token, db)
    if not current_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.is_free_tier:
       raise HTTPException(status_code=403, detail="Download not available on free events")

    cluster_rows = (
        db.query(Cluster.image_name)
        .filter(Cluster.event_id == event_id, Cluster.cluster_id == cluster_id)
        .all()
    )
    if not cluster_rows:
        raise HTTPException(status_code=404, detail="Cluster not found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for (image_name,) in cluster_rows:
            safe_name = Path(image_name).name
            try:
                # ── STORAGE: download bytes from storage_service ─────────────
                data = storage_service.download_file(event_id, safe_name)
                zf.writestr(safe_name, data)
            except Exception as e:
                print(f"⚠ Skipping {safe_name} in ZIP: {e}")

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=cluster_{cluster_id}.zip"},
    )


# --------------------------------------------------
# Start / Re-process Event
# POST /events/{event_id}/process
# --------------------------------------------------
@router.post("/{event_id}/process")
def start_processing(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    unprocessed = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.status == "uploaded",
        Photo.approval_status == "approved",
    ).count()

    if unprocessed == 0:
        raise HTTPException(status_code=400, detail="No photos to process")

    event.processing_status   = "processing"
    event.processing_progress = 0
    event.processing_started_at = datetime.utcnow()
    event.process_count = (event.process_count or 0) + 1
    db.commit()

    process_event.apply_async(args=[event_id], queue="photo_processing")

    return {"message": "Processing started", "event_id": event_id}


_redis_client = None
def _get_redis():
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.Redis.from_url(
            os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"),
            decode_responses=True
        )
    return _redis_client


# ── GET /events/{event_id}/processing-status ──────────────────────────────────
@router.get("/{event_id}/processing-status")
def get_processing_status(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Polling endpoint for frontend — returns current processing phase + progress.
    Phases: queued → face_detection → clustering → building_index → enriching → done
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    r         = _get_redis()
    total     = int(r.get(f"event:{event_id}:total")     or 0)
    completed = int(r.get(f"event:{event_id}:completed") or 0)
    phase     = r.get(f"event:{event_id}:phase") or event.processing_status or "unknown"

    # Human-readable phase labels for frontend display
    phase_labels = {
        "queued":         "Waiting to start...",
        "face_detection": "Detecting faces in photos",
        "clustering":     "Grouping people together",
        "building_index": "Building search index",
        "enriching":      "Detecting scenes & objects",
        "done":           "Ready!",
        "failed":         "Processing failed",
        "completed":      "Ready!",
        "processing":     "Processing photos...",
    }

    # Calculate percent — face_detection drives 0-70%, rest is 70-100%
    if phase == "face_detection" and total > 0:
        percent = int((completed / total) * 70)
    elif phase == "clustering":
        percent = 75
    elif phase == "building_index":
        percent = 88
    elif phase == "enriching":
        percent = 95
    elif phase in ("done", "completed"):
        percent = 100
    elif phase == "queued":
        percent = 0
    else:
        percent = int(event.processing_progress or 0)

    return {
        "status":       event.processing_status,
        "phase":        phase,
        "phase_label":  phase_labels.get(phase, phase),
        "total":        total,
        "completed":    completed,
        "percent":      percent,
        "total_clusters": event.total_clusters or 0,
        "total_faces":    event.total_faces or 0,
    }

# --------------------------------------------------
# Get Clusters  ← paginated, sorted largest first
# GET /events/{event_id}/clusters?page=1&page_size=20
# --------------------------------------------------
@router.get("/{event_id}/clusters")
def get_event_clusters(
    event_id:  int,
    page:      int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from collections import Counter

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    page_size = min(max(page_size, 1), 100)
    page      = max(page, 1)

    agg_rows = (
        db.query(Cluster.cluster_id, func.count(Cluster.id).label("cnt"))
        .filter(Cluster.event_id == event_id)
        .group_by(Cluster.cluster_id)
        .order_by(func.count(Cluster.id).desc())
        .all()
    )

    if not agg_rows:
        return {
            "event_id":       event_id,
            "total_clusters": 0,
            "total_images":   0,
            "page":           page,
            "page_size":      page_size,
            "has_more":       False,
            "clusters":       [],
        }

    total_clusters = len(agg_rows)
    total_images   = sum(r.cnt for r in agg_rows)

    start    = (page - 1) * page_size
    end      = start + page_size
    page_agg = agg_rows[start:end]
    has_more = end < total_clusters

    if not page_agg:
        return {
            "event_id":       event_id,
            "total_clusters": total_clusters,
            "total_images":   total_images,
            "page":           page,
            "page_size":      page_size,
            "has_more":       False,
            "clusters":       [],
        }

    page_cluster_ids = [r.cluster_id for r in page_agg]
    page_cnt_map     = {r.cluster_id: r.cnt for r in page_agg}

    cluster_rows = (
        db.query(Cluster.cluster_id, Cluster.image_name)
        .filter(
            Cluster.event_id == event_id,
            Cluster.cluster_id.in_(page_cluster_ids),
        )
        .all()
    )

    cluster_map: dict[int, list[str]] = {}
    for row in cluster_rows:
        cluster_map.setdefault(row.cluster_id, []).append(row.image_name)

    # Scene labels for these images
    all_image_names = [row.image_name for row in cluster_rows]
    photo_scene_map: dict[str, str] = {}
    if all_image_names:
        photos = (
            db.query(Photo.optimized_filename, Photo.scene_label)
            .filter(
                Photo.event_id == event_id,
                Photo.optimized_filename.in_(all_image_names),
            )
            .all()
        )
        for fn, label in photos:
            if fn:
                photo_scene_map[fn] = label

    def dominant_scene(images: list[str]) -> str | None:
        scene_counts = Counter(
            photo_scene_map[img]
            for img in images
            if img in photo_scene_map and photo_scene_map[img]
        )
        return scene_counts.most_common(1)[0][0] if scene_counts else None

    cluster_list = [
        {
            "cluster_id":    cid,
            "image_count":   page_cnt_map[cid],
            "preview_image": cluster_map[cid][0],
            "images":        cluster_map[cid],
            "scene_label":   dominant_scene(cluster_map[cid]),
        }
        for cid in page_cluster_ids
        if cid in cluster_map
    ]

    return {
        "event_id":       event_id,
        "total_clusters": total_clusters,
        "total_images":   total_images,
        "page":           page,
        "page_size":      page_size,
        "has_more":       has_more,
        "clusters":       cluster_list,
    }


# --------------------------------------------------
# Get Scenes  ← filter pill bar
# GET /events/{event_id}/scenes
# --------------------------------------------------
@router.get("/{event_id}/scenes")
def get_event_scenes(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    scene_counts = (
        db.query(Photo.scene_label, func.count(Photo.id).label("count"))
        .filter(
            Photo.event_id == event_id,
            Photo.scene_label.isnot(None),
            Photo.approval_status == "approved",
        )
        .group_by(Photo.scene_label)
        .order_by(func.count(Photo.id).desc())
        .all()
    )

    return {
        "event_id": event_id,
        "scenes": [
            {"scene_label": label, "count": count}
            for label, count in scene_counts
        ],
    }


# --------------------------------------------------
# Owner Face Search  ← enriched with scene + objects
# POST /events/{event_id}/search
# --------------------------------------------------
@router.post("/{event_id}/search")
async def search_face_in_event(
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if event.processing_status != "completed":
        raise HTTPException(status_code=400, detail="Event not processed yet")

    result = await search_face(event_id, file, db)

    matches = result.get("matches", [])
    if matches:
        image_names = [m["image_name"] for m in matches if "image_name" in m]
        photos = (
            db.query(
                Photo.optimized_filename,
                Photo.scene_label,
                Photo.objects_detected,
            )
            .filter(
                Photo.event_id == event_id,
                Photo.optimized_filename.in_(image_names),
            )
            .all()
        )
        photo_meta = {
            row.optimized_filename: {
                "scene_label":      row.scene_label,
                "objects_detected": row.objects_detected,
            }
            for row in photos
        }

        import json
        for match in matches:
            meta = photo_meta.get(match.get("image_name"), {})
            match["scene_label"] = meta.get("scene_label")
            raw_objects = meta.get("objects_detected")
            try:
                parsed = json.loads(raw_objects) if raw_objects else []
                match["objects"] = [o["label"] for o in parsed if "label" in o]
            except (json.JSONDecodeError, TypeError):
                match["objects"] = []

        result["matches"] = matches

    return result


# --------------------------------------------------
# Extend Event
# --------------------------------------------------
@router.post("/{event_id}/extend")
def extend_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    event.expires_at = datetime.utcnow() + timedelta(days=30)
    db.commit()
    return {"message": "Event extended", "expires_at": event.expires_at}


# --------------------------------------------------
# Toggle Public Status
# --------------------------------------------------
@router.post("/{event_id}/toggle-public")
def toggle_public(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    event.public_status = "disabled" if event.public_status == "active" else "active"
    db.commit()
    db.refresh(event)
    return {"public_status": event.public_status}


# --------------------------------------------------
# Regenerate Public Link
# --------------------------------------------------
@router.post("/{event_id}/regenerate-link")
def regenerate_public_link(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    event.public_token = secrets.token_urlsafe(16)
    db.commit()
    return {"public_token": event.public_token}


# --------------------------------------------------
# Dashboard Stats
# --------------------------------------------------
@router.get("/dashboard/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_events = db.query(Event).filter(Event.owner_id == current_user.id).count()

    total_images = db.query(func.sum(Event.image_count)).filter(
        Event.owner_id == current_user.id
    ).scalar() or 0

    total_process_runs = db.query(func.sum(Event.process_count)).filter(
        Event.owner_id == current_user.id
    ).scalar() or 0

    user_event_ids = [
        e.id for e in db.query(Event.id).filter(Event.owner_id == current_user.id).all()
    ]

    unprocessed_count = 0
    if user_event_ids:
        unprocessed_count = db.query(Photo).filter(
            Photo.event_id.in_(user_event_ids),
            Photo.status == "uploaded",
            Photo.approval_status == "approved",
        ).count()

    
    return {
        "total_events":          total_events,
        "total_images":          total_images,
        "total_process_runs":    int(total_process_runs),
        "plan_type":             current_user.plan_type,
        "max_events":           None,   # unlimited — enforced per-event via billing
        "max_images_per_event": None,   # quota lives on event.photo_quota
        "unprocessed_photos":    unprocessed_count,
    }

# ═══════════════════════════════════════════════════════════════
# 🎨 WATERMARK ENDPOINTS
# ═══════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# WATERMARK API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

WATERMARK_POSITIONS = [
    "top-left", "top-center", "top-right",
    "center-left", "center", "center-right",
    "bottom-left", "bottom-center", "bottom-right"
]

DEFAULT_WATERMARK_CONFIG = {
    "enabled": False,
    "type": "text",
    "text": "© Event Photos",
    "textSize": 3,
    "textOpacity": 60,
    "textPosition": "bottom-center",
    "textColor": "#ffffff",
    "textFont": "Arial, sans-serif",
    "padding": 20,
    "rotation": 0,
    "tile": False,
}


@router.get("/{event_id}/watermark")
def get_watermark_config(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get watermark configuration for an event.
    
    Returns:
        - enabled: bool
        - type: "text" | "logo"
        - text config (if type=text)
        - logo config (if type=logo)
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Check plan - watermark is Pro feature
    is_pro = not event.is_free_tier

    config = event.get_watermark_config()

    return {
        "event_id": event_id,
        "plan_type": current_user.plan_type,
        "is_pro": is_pro,
        "watermark_enabled": event.watermark_enabled,
        "watermark_config": config,
        "available_positions": WATERMARK_POSITIONS,
    }


@router.put("/{event_id}/watermark")
def update_watermark_config(
    event_id: int,
    enabled: bool = Form(False),
    type: str = Form("text"),
    # Text watermark options
    text: str = Form(None),
    textSize: float = Form(None),
    textOpacity: int = Form(None),
    textPosition: str = Form(None),
    textColor: str = Form(None),
    textFont: str = Form(None),
    # Logo watermark options
    logoUrl: str = Form(None),
    logoSize: float = Form(None),
    logoOpacity: int = Form(None),
    logoPosition: str = Form(None),
    # Advanced options
    padding: int = Form(None),
    rotation: int = Form(None),
    tile: bool = Form(False),
    # Database
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update watermark configuration for an event.
    
    This is a PRO feature. Free plan users will receive 403.
    
    Form Parameters:
        - enabled: Enable/disable watermark (bool)
        - type: "text" or "logo"
        
    For text watermark:
        - text: Watermark text (e.g., "© John Doe Photography")
        - textSize: Size as % of image width (1-8)
        - textOpacity: Opacity 0-100
        - textPosition: Position on image
        - textColor: Hex color (#ffffff)
        
    For logo watermark:
        - logoUrl: URL to logo image
        - logoSize: Size as % of image width (5-40)
        - logoOpacity: Opacity 0-100
        - logoPosition: Position on image
        
    Advanced:
        - padding: Pixels from edge (0-100)
        - rotation: Rotation angle (-180 to 180)
        - tile: Repeat watermark across image
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Check plan - watermark is Pro feature
    if current_user.plan_type == "free" or current_user.plan_type is None:
        raise HTTPException(
            status_code=403, 
            detail="Watermark is a Pro feature. Please upgrade your plan."
        )

    # Validate type
    if type not in ["text", "logo"]:
        raise HTTPException(status_code=400, detail="Type must be 'text' or 'logo'")

    # Validate position
    position = textPosition or logoPosition
    if position and position not in WATERMARK_POSITIONS:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid position. Must be one of: {', '.join(WATERMARK_POSITIONS)}"
        )

    # Validate opacity
    opacity = textOpacity or logoOpacity
    if opacity is not None and (opacity < 20 or opacity > 100):
        raise HTTPException(status_code=400, detail="Opacity must be between 20 and 100")

    # Validate size
    size = textSize or logoSize
    if size is not None:
        if type == "text" and (size < 1 or size > 8):
            raise HTTPException(status_code=400, detail="Text size must be between 1 and 8")
        if type == "logo" and (size < 5 or size > 40):
            raise HTTPException(status_code=400, detail="Logo size must be between 5 and 40")

    # Build config object
    config = DEFAULT_WATERMARK_CONFIG.copy()
    config["enabled"] = enabled
    config["type"] = type
    
    # Text options
    if type == "text":
        if text:
            config["text"] = text
        if textSize is not None:
            config["textSize"] = textSize
        if textOpacity is not None:
            config["textOpacity"] = textOpacity
        if textPosition:
            config["textPosition"] = textPosition
        if textColor:
            config["textColor"] = textColor
        if textFont:
            config["textFont"] = textFont
    
    # Logo options
    if type == "logo":
        if logoUrl:
            config["logoUrl"] = logoUrl
        if logoSize is not None:
            config["logoSize"] = logoSize
        if logoOpacity is not None:
            config["logoOpacity"] = logoOpacity
        if logoPosition:
            config["logoPosition"] = logoPosition
    
    # Advanced options
    if padding is not None:
        config["padding"] = max(0, min(100, padding))
    if rotation is not None:
        config["rotation"] = max(-180, min(180, rotation))
    config["tile"] = tile

    # Update event
    event.watermark_enabled = enabled
    event.watermark_config = json.dumps(config)
    db.commit()
    db.refresh(event)

    return {
        "success": True,
        "event_id": event_id,
        "watermark_enabled": event.watermark_enabled,
        "watermark_config": config,
        "message": "Watermark settings updated successfully"
    }


@router.post("/{event_id}/watermark/toggle")
def toggle_watermark(
    event_id: int,
    enabled: bool = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Quick toggle watermark on/off.
    
    This is a PRO feature.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Check plan
    if current_user.plan_type == "free" or current_user.plan_type is None:
        raise HTTPException(
            status_code=403, 
            detail="Watermark is a Pro feature. Please upgrade your plan."
        )

    event.watermark_enabled = enabled
    
    # Update config enabled flag too
    if event.watermark_config:
        config = json.loads(event.watermark_config)
        config["enabled"] = enabled
        event.watermark_config = json.dumps(config)
    
    db.commit()

    return {
        "success": True,
        "watermark_enabled": event.watermark_enabled,
        "message": f"Watermark {'enabled' if enabled else 'disabled'}"
    }


@router.post("/{event_id}/watermark/reset")
def reset_watermark_config(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Reset watermark config to defaults.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    event.watermark_enabled = False
    event.watermark_config = json.dumps(DEFAULT_WATERMARK_CONFIG)
    db.commit()

    return {
        "success": True,
        "watermark_config": DEFAULT_WATERMARK_CONFIG,
        "message": "Watermark settings reset to defaults"
    }

# ══════════════════════════════════════════════════════════════════════════════
# 🔒 PIN PROTECTION  —  Owner endpoints
# ══════════════════════════════════════════════════════════════════════════════

from pydantic import BaseModel, Field as PydanticField

class PinSetRequest(BaseModel):
    pin: str = PydanticField(..., min_length=4, max_length=4, pattern=r"^\d{4}$")

class PinRemoveRequest(BaseModel):
    pass


@router.get("/{event_id}/pin-value")
def get_pin_value(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the plain-text PIN for an event — owner only.
    Used by dashboard to show PIN on QR card and build owner share links.
    NOTE: We re-derive by brute-checking 0000–9999. PIN is only 4 digits so
    this is instant (<10ms) and avoids storing the plain PIN anywhere.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not event.pin_enabled or not event.pin_hash:
        return {"event_id": event_id, "pin_enabled": False, "pin": None}

    # Brute-force 0000–9999 to recover plain PIN (safe — only 10k iterations)
    plain_pin = None
    for i in range(10000):
        candidate = f"{i:04d}"
        if event.verify_pin(candidate):
            plain_pin = candidate
            break

    return {
        "event_id":    event_id,
        "pin_enabled": event.pin_enabled,
        "pin":         plain_pin,
    }


@router.get("/{event_id}/pin")
def get_pin_status(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return whether PIN protection is currently enabled for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return {
        "event_id":    event_id,
        "pin_enabled": event.pin_enabled,
    }


@router.put("/{event_id}/pin")
def set_pin(
    event_id: int,
    body: PinSetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Set (or replace) a 4-digit numeric PIN on an event.
    The PIN is hashed before storage — it is never persisted in plain text.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    event.set_pin(body.pin)
    db.commit()

    return {
        "success":     True,
        "event_id":    event_id,
        "pin_enabled": True,
        "message":     "PIN set successfully. Visitors will need this PIN to access the public page.",
    }


@router.delete("/{event_id}/pin")
def remove_pin(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove PIN protection from an event, making it freely accessible."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    event.clear_pin()
    db.commit()

    return {
        "success":     True,
        "event_id":    event_id,
        "pin_enabled": False,
        "message":     "PIN protection removed. The public page is now freely accessible.",
    }






class BrandingUpdateRequest(BaseModel):
    """
    Payload for PATCH /events/{event_id}/branding.
    All fields are optional — only supplied fields are updated.
    Mirrors the BrandingConfig TypeScript type from BrandingSettings.tsx.
    """
    template_id:          str | None = Field(None, max_length=40)
    brand_logo_url:       str | None = Field(None)          # R2 public URL or data URL
    brand_primary_color:  str | None = Field(None, max_length=7)
    brand_accent_color:   str | None = Field(None, max_length=7)
    brand_font:           str | None = Field(None, max_length=40)
    brand_footer_text:    str | None = Field(None, max_length=100)
    brand_show_powered_by: bool | None = None

    @validator("template_id")
    def validate_template(cls, v):
        if v is not None and v not in VALID_TEMPLATES:
            raise ValueError(f"template_id must be one of: {VALID_TEMPLATES}")
        return v

    @validator("brand_primary_color", "brand_accent_color")
    def validate_color(cls, v):
        if v is not None and not _HEX_RE.match(v):
            raise ValueError("Color must be a valid #RRGGBB hex string")
        return v

    @validator("brand_font")
    def validate_font(cls, v):
        if v is not None and v not in VALID_FONTS:
            raise ValueError(f"brand_font must be one of: {VALID_FONTS}")
        return v

    @validator("brand_logo_url")
    def validate_logo_url(cls, v):
        if v is None or v == "":
            return v
        # Accept: https:// R2 URLs, http:// (dev), data: URLs (fallback), /storage/ (local backend)
        if not (v.startswith("https://") or v.startswith("http://") or v.startswith("data:") or v.startswith("/storage/")):
            raise ValueError("brand_logo_url must be an https/http/data URL or /storage/ path")
        # Reject suspiciously large data URLs (>500 KB is almost certainly wrong)
        if v.startswith("data:") and len(v) > 700_000:
            raise ValueError("Logo data URL is too large — upload via presign endpoint instead")
        return v


class LogoPresignRequest(BaseModel):
    filename:     str = Field(..., max_length=255)
    content_type: str = Field(..., max_length=100)

    @validator("content_type")
    def validate_mime(cls, v):
        allowed = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
        if v not in allowed:
            raise ValueError(f"content_type must be one of: {allowed}")
        return v


# ═══════════════════════════════════════════════════════════════════════════════
# 🖌️  BRANDING ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{event_id}/branding")
def get_branding(
    event_id: int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    GET /events/{event_id}/branding
    Returns the current branding configuration for the event.
    Owner-only — requires Bearer token.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return event.get_branding_config()


@router.patch("/{event_id}/branding")
def update_branding(
    event_id: int,
    payload:      BrandingUpdateRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    PATCH /events/{event_id}/branding
    Save branding settings for the event.
    Only supplied fields are updated (partial update).
    Owner-only — requires Bearer token.

    Request body (all fields optional):
    {
        "template_id":           "wedding",
        "brand_logo_url":        "https://r2.example.com/logos/abc.png",
        "brand_primary_color":   "#e879a0",
        "brand_accent_color":    "#f9a8d4",
        "brand_font":            "playfair",
        "brand_footer_text":     "© Riya Photography 2025",
        "brand_show_powered_by": true
    }
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Partial update — only touch fields that were actually sent
    data = payload.dict(exclude_none=True)

    if "template_id" in data:
        event.brand_template_id = data["template_id"]
    if "brand_logo_url" in data:
        event.brand_logo_url = data["brand_logo_url"] or None
    if "brand_primary_color" in data:
        event.brand_primary_color = data["brand_primary_color"]
    if "brand_accent_color" in data:
        event.brand_accent_color = data["brand_accent_color"]
    if "brand_font" in data:
        event.brand_font = data["brand_font"]
    if "brand_footer_text" in data:
        # Empty string is valid (clears the footer text)
        event.brand_footer_text = data["brand_footer_text"] or None
    if "brand_show_powered_by" in data:
        event.brand_show_powered_by = data["brand_show_powered_by"]

    db.commit()
    db.refresh(event)

    return {
        "message": "Branding updated",
        **event.get_branding_config(),
    }


@router.post("/{event_id}/branding/logo-presign")
def logo_presign(
    event_id: int,
    payload:      LogoPresignRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    POST /events/{event_id}/branding/logo-presign
    Generate a presigned PUT URL so the browser can upload the logo
    directly to R2/MinIO — same pattern as /upload/{event_id}/presign.

    Request body:
    { "filename": "logo.png", "content_type": "image/png" }

    Response:
    {
        "upload_url":  "https://...presigned-put-url...",
        "public_url":  "https://r2.example.com/logos/{event_id}/{uuid}.png",
        "stored_name": "{uuid}.png"
    }

    After the browser PUTs the file, it stores public_url via
    PATCH /events/{event_id}/branding { "brand_logo_url": public_url }.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    ext = Path(payload.filename).suffix.lower() or ".png"
    # Whitelist extensions for safety
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    stored_name = f"{uuid.uuid4()}{ext}"
    # Logos live under a dedicated prefix so they're easy to find / delete
    object_key  = f"logos/{event_id}/{stored_name}"

    try:
        upload_url = storage_service.generate_presigned_put(
            object_key=object_key,
            content_type=payload.content_type,
            expires_in=300,         # 5 minutes — plenty for a logo upload
        )
        public_url = storage_service.get_public_url(object_key)
    except (AttributeError, RuntimeError):
        # storage_service doesn't support presigned PUT (local backend)
        # Return a fallback so the frontend can gracefully use data URL storage.
        raise HTTPException(
            status_code=501,
            detail="Presigned upload not available on this storage backend. "
                   "Use data URL fallback.",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Presign failed: {exc}")

    return {
        "upload_url":  upload_url,
        "public_url":  public_url,
        "stored_name": stored_name,
    }


@router.delete("/{event_id}/branding/logo")
def delete_logo(
    event_id: int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    DELETE /events/{event_id}/branding/logo
    Remove the brand logo — deletes from R2 and clears the DB field.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.brand_logo_url:
        # Only attempt R2 deletion for actual R2/MinIO URLs (not data URLs)
        logo_url = event.brand_logo_url
        if logo_url.startswith("https://") or logo_url.startswith("http://"):
            try:
                # Extract object key from URL: everything after the bucket domain
                # e.g. "https://pub-xxx.r2.dev/logos/42/abc.png" → "logos/42/abc.png"
                from urllib.parse import urlparse
                parsed   = urlparse(logo_url)
                obj_key  = parsed.path.lstrip("/")
                storage_service.delete_file_by_key(obj_key)
            except Exception as exc:
                # Non-fatal — clear DB field even if storage deletion fails
                print(f"⚠ Logo R2 deletion failed (continuing): {exc}")

        event.brand_logo_url = None
        db.commit()

    return {"message": "Logo removed"}