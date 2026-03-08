"""
app/api/upload_routes.py

Owner photo upload — two modes:
  1. POST /{event_id}/presign   → returns presigned MinIO PUT URLs (browser uploads direct)
  2. POST /{event_id}/confirm   → registers DB records after direct upload completes
  3. POST /{event_id}           → legacy multipart fallback (still works)
"""

import os
import uuid
from pathlib import Path
from typing import List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.services import storage_service
from app.core.plans import PLANS

router = APIRouter(prefix="/upload", tags=["upload"])

ACCEPTED_EXTENSIONS  = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
MAX_FILE_SIZE_MB     = int(os.getenv("MAX_PHOTO_SIZE_MB", "20"))
LEGACY_FALLBACK_QUOTA = 5000  # for events created before billing system (photo_quota=NULL)

# MinIO internal hostname as seen by the backend container
MINIO_INTERNAL = os.getenv("MINIO_ENDPOINT", "http://minio:9000")
# Public-facing URL that the browser can reach (goes through nginx/tunnel)
MINIO_PUBLIC   = os.getenv("MINIO_PUBLIC_URL", "/storage")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _effective_quota(event: Event, user: User) -> int:
    """Return upload quota, handling NULL photo_quota on legacy events."""
    if event.photo_quota is not None:
        return event.photo_quota
    plan = PLANS.get(user.plan_type, PLANS["free"])
    return plan.get("max_images_per_event") or LEGACY_FALLBACK_QUOTA


def _guard_event(event_id: int, current_user: User, db: Session) -> Event:
    """Common guards: existence, ownership, payment, expiry."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if event.payment_status not in ("paid", "free"):
        raise HTTPException(status_code=402, detail="Complete payment before uploading.")
    if event.expires_at and datetime.utcnow() > event.expires_at:
        raise HTTPException(status_code=410, detail="This event has expired.")
    return event


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PresignRequest(BaseModel):
    filenames: List[str]

class ConfirmItem(BaseModel):
    original_filename: str
    stored_filename: str
    file_size_bytes: int = 0

class ConfirmRequest(BaseModel):
    uploads: List[ConfirmItem]


# ── POST /{event_id}/presign ──────────────────────────────────────────────────

@router.post("/{event_id}/presign")
def presign_uploads(
    event_id: int,
    body: PresignRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Step 1 of direct-upload flow.
    Returns a presigned PUT URL per file — browser uploads directly to MinIO,
    bypassing the Cloudflare tunnel size limit entirely.
    """
    event = _guard_event(event_id, current_user, db)

    quota     = _effective_quota(event, current_user)
    available = quota - (event.image_count or 0)
    if available <= 0:
        raise HTTPException(status_code=400, detail=f"Photo quota reached ({quota}).")

    s3      = storage_service._get_s3()
    results = []

    for original_name in body.filenames[:available]:  # never exceed quota
        ext = Path(original_name).suffix.lower()
        if ext not in ACCEPTED_EXTENSIONS:
            results.append({"original_filename": original_name, "error": "unsupported_type"})
            continue

        stored_filename = f"raw_{uuid.uuid4().hex}{ext}"
        object_key      = f"events/{event_id}/{stored_filename}"

        # Generate a 1-hour presigned PUT URL
        internal_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket":      storage_service.MINIO_BUCKET,
                "Key":         object_key,
                "ContentType": "image/jpeg",
            },
            ExpiresIn=3600,
        )

        # Rewrite internal MinIO URL to the public nginx path so the browser
        # can reach it through the Cloudflare tunnel.
        # internal: http://minio:9000/snapfind/events/1/raw_abc.jpg?X-Amz-...
        # public:   /minio-upload/snapfind/events/1/raw_abc.jpg?X-Amz-...
        public_url = internal_url.replace(
            MINIO_INTERNAL.rstrip("/") + "/" + storage_service.MINIO_BUCKET,
            "/minio-upload/" + storage_service.MINIO_BUCKET,
        )

        results.append({
            "original_filename": original_name,
            "stored_filename":   stored_filename,
            "upload_url":        public_url,
            "object_key":        object_key,
        })

    return {"files": results, "quota_remaining": available}


# ── POST /{event_id}/confirm ──────────────────────────────────────────────────

@router.post("/{event_id}/confirm")
def confirm_uploads(
    event_id: int,
    body: ConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Step 2 of direct-upload flow.
    Called after browser has PUT files directly to MinIO.
    Creates Photo DB records and increments event.image_count.
    """
    event = _guard_event(event_id, current_user, db)

    new_count = 0
    for item in body.uploads:
        photo = Photo(
            event_id=event_id,
            original_filename=item.original_filename,
            stored_filename=item.stored_filename,
            file_size_bytes=item.file_size_bytes,
            uploaded_by="owner",
            approval_status="approved",
            status="uploaded",
        )
        db.add(photo)
        new_count += 1

    if new_count:
        event.image_count = (event.image_count or 0) + new_count
        db.commit()

    quota = _effective_quota(event, current_user)
    return {
        "confirmed":         new_count,
        "event_image_count": event.image_count,
        "photo_quota":       quota,
        "photos_remaining":  max(0, quota - (event.image_count or 0)),
    }


# ── POST /{event_id}  (legacy multipart fallback) ─────────────────────────────

@router.post("/{event_id}")
async def upload_photos(
    event_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Legacy multipart upload — still works but bypassed by presign flow."""
    event = _guard_event(event_id, current_user, db)

    # ── Quota guard ───────────────────────────────────────────────────────────
    effective_quota = _effective_quota(event, current_user)
    available_slots = effective_quota - (event.image_count or 0)
    if available_slots <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Photo quota reached ({effective_quota} photos). "
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
        "photo_quota":       effective_quota,
        "photos_remaining":  max(0, effective_quota - (event.image_count or 0)),
    }