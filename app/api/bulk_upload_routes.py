"""
app/api/bulk_upload_routes.py

Bulk photo upload — owner-initiated, batched, with progress tracking.
Quota is always read from event.photo_quota (set at event creation):
  - Free event:  500  (FREE_TIER_CONFIG in pricing.py)
  - Paid event:  whatever the owner chose at purchase time
"""
import os
import uuid
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.services import storage_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bulk-upload", tags=["bulk-upload"])

ACCEPTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
MAX_FILE_SIZE_MB     = int(os.getenv("MAX_PHOTO_SIZE_MB", "20"))
MAX_FILES_PER_BATCH  = 50


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ext(filename: str) -> str:
    return Path(filename).suffix.lower()


@router.post("/{event_id}")
async def bulk_upload(
    event_id: int,
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # ── 1. Event ownership ────────────────────────────────────────────────────
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # ── 2. Quota — always from event.photo_quota, set at creation ────────────
    max_imgs   = event.photo_quota or 0
    slots_left = max(max_imgs - (event.image_count or 0), 0)

    # ── 3. Batch size guard ───────────────────────────────────────────────────
    if len(files) > MAX_FILES_PER_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Max {MAX_FILES_PER_BATCH} files per request.",
        )

    # ── 4. Process files ──────────────────────────────────────────────────────
    photo_records: list[Photo] = []
    result_files:  list[dict]  = []
    uploaded_count = 0
    skipped_count  = 0

    for idx, file in enumerate(files):
        if uploaded_count >= slots_left:
            skipped_count += len(files) - idx
            for remaining_file in files[idx:]:
                result_files.append({
                    "original_filename": remaining_file.filename,
                    "stored_filename":   None,
                    "status":            "skipped",
                    "reason":            "quota_reached",
                })
            break

        original_name = file.filename or ""
        ext = _ext(original_name)

        if ext not in ACCEPTED_EXTENSIONS:
            result_files.append({
                "original_filename": original_name,
                "stored_filename":   None,
                "status":            "failed",
                "reason":            "invalid_file_type",
            })
            continue

        content   = await file.read()
        file_size = len(content)

        if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            result_files.append({
                "original_filename": original_name,
                "stored_filename":   None,
                "status":            "failed",
                "reason":            f"file_too_large_max_{MAX_FILE_SIZE_MB}mb",
            })
            continue

        raw_filename = f"raw_{uuid.uuid4().hex}{ext}"
        try:
            storage_service.upload_file(
                data=content,
                event_id=event_id,
                filename=raw_filename,
                content_type=file.content_type or "image/jpeg",
            )
        except Exception as exc:
            logger.error("bulk_upload storage error for %s: %s", original_name, exc)
            result_files.append({
                "original_filename": original_name,
                "stored_filename":   None,
                "status":            "failed",
                "reason":            f"storage_error: {exc}",
            })
            continue

        photo_records.append(Photo(
            event_id=event_id,
            original_filename=original_name,
            stored_filename=raw_filename,
            file_size_bytes=file_size,
            uploaded_by="owner",
            approval_status="approved",
            status="uploaded",
        ))
        result_files.append({
            "original_filename": original_name,
            "stored_filename":   raw_filename,
            "status":            "ok",
            "reason":            None,
        })
        uploaded_count += 1

    # ── 5. Bulk DB insert ─────────────────────────────────────────────────────
    if photo_records:
        db.add_all(photo_records)
        event.image_count = (event.image_count or 0) + len(photo_records)
        db.commit()
        db.refresh(event)

    return {
        "uploaded":          uploaded_count,
        "skipped":           skipped_count,
        "failed":            sum(1 for r in result_files if r["status"] == "failed"),
        "results":           result_files,
        "event_image_count": event.image_count,
    }