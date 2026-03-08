"""
app/api/upload_routes.py

Owner photo upload — enforces per-event photo_quota instead of plan limits.

Key changes from previous version:
  - Replaced: PLANS.get(user.plan_type)["max_images_per_event"]
  - With:     event.photo_quota  (set at purchase time)
  - Added:    payment_status guard — only paid/free events accept uploads
"""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.services import storage_service

router = APIRouter(prefix="/upload", tags=["upload"])

ACCEPTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
MAX_FILE_SIZE_MB     = int(os.getenv("MAX_PHOTO_SIZE_MB", "20"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/{event_id}")
async def upload_photos(
    event_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # ── Payment guard ─────────────────────────────────────────────────────────
    if event.payment_status not in ("paid", "free"):
        raise HTTPException(
            status_code=402,
            detail="Event payment is pending. Complete payment before uploading photos.",
        )

    # ── Expiry guard ──────────────────────────────────────────────────────────
    from datetime import datetime
    if event.expires_at and datetime.utcnow() > event.expires_at:
        raise HTTPException(
            status_code=410,
            detail="This event has expired. Please create a new event to continue.",
        )

    # ── Quota guard (uses event.photo_quota, not plan) ────────────────────────
    available_slots = event.photo_quota - (event.image_count or 0)
    if available_slots <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Photo quota reached ({event.photo_quota} photos). "
                   f"This event cannot accept more photos.",
        )

    uploaded  = []
    failed    = []
    new_count = 0

    for file in files:
        # Stop mid-batch if quota fills up
        if new_count >= available_slots:
            failed.append({
                "filename": file.filename or "unknown",
                "reason":   "quota_reached",
            })
            continue

        original_name = file.filename or ""
        ext = Path(original_name).suffix.lower()

        if ext not in ACCEPTED_EXTENSIONS:
            failed.append({"filename": original_name, "reason": "unsupported_type"})
            continue

        content = await file.read()
        size_mb = len(content) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            failed.append({"filename": original_name, "reason": f"too_large_{size_mb:.1f}mb"})
            continue

        # Store raw file
        stored_filename = f"raw_{uuid.uuid4().hex}{ext}"
        try:
            storage_service.upload_file(
                data=content,
                event_id=event_id,
                filename=stored_filename,
                content_type=file.content_type or "image/jpeg",
            )
        except Exception as e:
            failed.append({"filename": original_name, "reason": f"storage_error: {e}"})
            continue

        # Insert Photo record
        photo = Photo(
            event_id=event_id,
            original_filename=original_name,
            stored_filename=stored_filename,
            file_size_bytes=len(content),
            uploaded_by="owner",
            approval_status="approved",
            status="uploaded",
        )
        db.add(photo)
        new_count += 1
        uploaded.append({"filename": original_name, "stored": stored_filename})

    if new_count:
        event.image_count = (event.image_count or 0) + new_count
        db.commit()

    return {
        "uploaded":          uploaded,
        "failed":            failed,
        "total_uploaded":    new_count,
        "event_image_count": event.image_count,
        "photo_quota":       event.photo_quota,
        "photos_remaining":  max(0, event.photo_quota - event.image_count),
    }
