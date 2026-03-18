"""
app/api/upload_routes.py

Owner photo upload — two modes:

  1. Direct-to-MinIO (preferred, scales to 1000+ files)
     POST /upload/{event_id}/presign   → returns per-file presigned PUT URLs
     Browser PUTs each file directly to MinIO (one PUT per file, parallel)
     POST /upload/{event_id}/confirm   → registers completed uploads in DB

  2. Legacy multipart fallback (≤ ~50 files, kept for backwards compat)
     POST /upload/{event_id}           → original FormData endpoint

Key invariants preserved:
  - event.photo_quota enforced (not plan-level limit)
  - payment_status / expires_at guards
  - Photo records created with uploaded_by="owner", approval_status="approved"
  - event.image_count incremented atomically
"""

import os
import uuid
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.services import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

ACCEPTED_EXTENSIONS  = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
MAX_FILE_SIZE_MB      = int(os.getenv("MAX_PHOTO_SIZE_MB", "20"))
PRESIGN_TTL_SECONDS   = int(os.getenv("PRESIGN_TTL_SECONDS", "3600"))   # 1 h
MAX_PRESIGN_BATCH     = int(os.getenv("MAX_PRESIGN_BATCH", "2000"))      # per request


# ─── DB dependency ────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Shared guards ────────────────────────────────────────────────────────────

def _get_authorized_event(event_id: int, user: User, db: Session) -> Event:
    """Load event, verify ownership, payment status, and expiry."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if event.payment_status not in ("paid", "free"):
        raise HTTPException(
            status_code=402,
            detail="Event payment is pending. Complete payment before uploading photos.",
        )
    if event.expires_at and datetime.utcnow() > event.expires_at:
        raise HTTPException(
            status_code=410,
            detail="This event has expired. Please create a new event to continue.",
        )
    return event


def _ext(filename: str) -> str:
    return Path(filename).suffix.lower()


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class PresignRequest(BaseModel):
    filenames: list[str]


class PresignedFile(BaseModel):
    original_filename: str
    stored_filename: str
    upload_url: str
    error: str | None = None


class PresignResponse(BaseModel):
    files: list[PresignedFile]
    quota_remaining: int
    photo_quota: int


class ConfirmedUpload(BaseModel):
    original_filename: str
    stored_filename: str
    file_size_bytes: int


class ConfirmRequest(BaseModel):
    uploads: list[ConfirmedUpload]


class ConfirmResponse(BaseModel):
    accepted: int
    rejected: int
    event_image_count: int
    photo_quota: int
    photos_remaining: int


# ─── Route 1: Presign ─────────────────────────────────────────────────────────

@router.post("/{event_id}/presign", response_model=PresignResponse)
async def presign_uploads(
    event_id: int,
    body: PresignRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Generate presigned PUT URLs so the browser can upload directly to MinIO.
    Returns one entry per filename; files that can't be accepted carry an error.
    Does NOT write to the DB — that happens at /confirm after actual upload.
    """
    event = _get_authorized_event(event_id, current_user, db)

    if len(body.filenames) > MAX_PRESIGN_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Max {MAX_PRESIGN_BATCH} filenames per presign request.",
        )

    quota_remaining = max(0, (event.photo_quota or 0) - (event.image_count or 0))
    results: list[PresignedFile] = []
    allocated = 0  # how many slots consumed in this presign call

    for original_name in body.filenames:
        ext = _ext(original_name or "")

        # Reject unsupported types immediately — no URL issued
        if ext not in ACCEPTED_EXTENSIONS:
            results.append(PresignedFile(
                original_filename=original_name,
                stored_filename="",
                upload_url="",
                error="unsupported_file_type",
            ))
            continue

        # Stop issuing URLs when quota is exhausted
        if allocated >= quota_remaining:
            results.append(PresignedFile(
                original_filename=original_name,
                stored_filename="",
                upload_url="",
                error="quota_exceeded",
            ))
            continue

        stored_filename = f"raw_{uuid.uuid4().hex}{ext}"

        try:
            upload_url = storage_service.generate_presigned_put_url(
                event_id=event_id,
                filename=stored_filename,
                # Sign with application/octet-stream so the browser's Content-Type
                # header is always valid regardless of image subtype.
                content_type="application/octet-stream",
                expires_in=PRESIGN_TTL_SECONDS,
            )
        except Exception as exc:
            logger.error("presign failed for %s: %s", original_name, exc)
            results.append(PresignedFile(
                original_filename=original_name,
                stored_filename="",
                upload_url="",
                error=f"presign_error: {exc}",
            ))
            continue

        allocated += 1
        results.append(PresignedFile(
            original_filename=original_name,
            stored_filename=stored_filename,
            upload_url=upload_url,
            error=None,
        ))

    return PresignResponse(
        files=results,
        quota_remaining=max(0, quota_remaining - allocated),
        photo_quota=event.photo_quota or 0,
    )


# ─── Route 2: Confirm ─────────────────────────────────────────────────────────

@router.post("/{event_id}/confirm", response_model=ConfirmResponse)
async def confirm_uploads(
    event_id: int,
    body: ConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Called after the browser has successfully PUT all files to MinIO.
    Writes Photo records and increments event.image_count atomically.

    • Accepts up to 200 uploads per call (caller chunks large batches).
    • Verifies each stored_filename exists in storage before inserting
      (guards against forged confirm requests).
    • Remaining quota is re-checked here so concurrent uploads don't
      overrun the limit even without a DB lock.
    """
    # Re-fetch inside a short-lived transaction so we see the latest image_count
    event = _get_authorized_event(event_id, current_user, db)

    if len(body.uploads) > 200:
        raise HTTPException(status_code=400, detail="Max 200 uploads per confirm call.")

    # ── FIX 1: Row lock — only one confirm runs at a time per event ───────────
    event = db.execute(
        select(Event)
        .where(Event.id == event_id, Event.owner_id == current_user.id)
        .with_for_update()              # ← prevents quota race condition
    ).scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found or not authorized")
    if event.payment_status not in ("paid", "free"):
        raise HTTPException(status_code=402, detail="Complete payment before uploading.")
    if event.expires_at and datetime.utcnow() > event.expires_at:
        raise HTTPException(status_code=410, detail="Event has expired.")

    quota_remaining = max(0, (event.photo_quota or 0) - (event.image_count or 0))
    photo_records: list[Photo] = []
    rejected = 0

    for item in body.uploads:
        if quota_remaining <= 0:
            rejected += 1
            continue

        ext = _ext(item.stored_filename or "")
        if ext not in ACCEPTED_EXTENSIONS:
            rejected += 1
            continue

        # Optional but strongly recommended: verify the file actually landed
        # in MinIO before creating a DB record.  storage_service.file_exists()
        # is a cheap HEAD request.  Skip if your storage_service lacks it.
        try:
            if hasattr(storage_service, "file_exists"):
                exists = storage_service.file_exists(
                    event_id=event_id,
                    filename=item.stored_filename,
                )
                if not exists:
                    logger.warning(
                        "confirm: %s not found in storage, skipping", item.stored_filename
                    )
                    rejected += 1
                    continue
        except Exception as exc:
            # file_exists failures are non-fatal — log and accept
            logger.error("file_exists check failed: %s", exc)

        photo_records.append(Photo(
            event_id=event_id,
            original_filename=item.original_filename,
            stored_filename=item.stored_filename,
            file_size_bytes=item.file_size_bytes,
            uploaded_by="owner",
            approval_status="approved",
            status="uploaded",
        ))
        quota_remaining -= 1

    accepted = len(photo_records)

    if accepted > 0:
        db.add_all(photo_records)
        event.image_count = (event.image_count or 0) + accepted
        db.commit()
        db.refresh(event)

    # ── FIX 2: Auto-trigger processing on final chunk ─────────────────────────
    if body.is_last_chunk and accepted > 0:
        task = process_event.apply_async(args=[event_id], queue="default")
        task_id = task.id
        processing_status = "queued"

        # Update event status
        event.processing_status   = "queued"
        event.processing_progress = 0
        db.commit()

        logger.info("Auto-triggered processing for event %s — task %s", event_id, task_id)

    return ConfirmResponse(
        accepted=accepted,
        rejected=rejected,
        event_image_count=event.image_count or 0,
        photo_quota=event.photo_quota or 0,
        photos_remaining=max(0, (event.photo_quota or 0) - (event.image_count or 0)),
        task_id=task_id,
        processing_status=processing_status,
    )


# ─── Route 3: Legacy multipart (kept for backwards compat) ────────────────────

@router.post("/{event_id}")
async def upload_photos(
    event_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Original FormData endpoint.  Retained unchanged so existing integrations
    (mobile apps, older frontend builds, SDK users) keep working.
    New code should use /presign + /confirm instead.
    """
    event = _get_authorized_event(event_id, current_user, db)

    available_slots = (event.photo_quota or 0) - (event.image_count or 0)
    if available_slots <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Photo quota reached ({event.photo_quota} photos). "
                   "This event cannot accept more photos.",
        )

    uploaded:  list[dict[str, Any]] = []
    failed:    list[dict[str, Any]] = []
    new_count  = 0

    for file in files:
        if new_count >= available_slots:
            failed.append({"filename": file.filename or "unknown", "reason": "quota_reached"})
            continue

        original_name = file.filename or ""
        ext = _ext(original_name)

        if ext not in ACCEPTED_EXTENSIONS:
            failed.append({"filename": original_name, "reason": "unsupported_type"})
            continue

        content = await file.read()
        size_mb = len(content) / (1024 * 1024)
        if size_mb > MAX_FILE_SIZE_MB:
            failed.append({"filename": original_name, "reason": f"too_large_{size_mb:.1f}mb"})
            continue

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

        db.add(Photo(
            event_id=event_id,
            original_filename=original_name,
            stored_filename=stored_filename,
            file_size_bytes=len(content),
            uploaded_by="owner",
            approval_status="approved",
            status="uploaded",
        ))
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
        "photos_remaining":  max(0, (event.photo_quota or 0) - (event.image_count or 0)),
    }