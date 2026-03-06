"""
app/api/bulk_upload_routes.py

Bulk photo upload (batched, with progress tracking).
Replaces direct disk writes with storage_service calls.
All existing business logic (plan limits, slot counting, etc.) preserved.
"""
import os
import uuid
import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.core.plans import PLANS
from app.services import storage_service

router = APIRouter(prefix="/bulk-upload", tags=["bulk-upload"])

ACCEPTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
MAX_FILE_SIZE_MB    = int(os.getenv("MAX_PHOTO_SIZE_MB", "20"))
MAX_FILES_PER_BATCH = 50


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ext(filename: str) -> str:
    return Path(filename).suffix.lower()


def _sync_read(file: UploadFile) -> bytes:
    """Sync wrapper — UploadFile.read() must be awaited in async context."""
    import asyncio
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(file.read())


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

    # ── 2. Plan cap ───────────────────────────────────────────────────────────
    plan_config = PLANS.get(current_user.plan_type, PLANS["free"])
    max_imgs    = plan_config["max_images_per_event"]
    slots_left  = max(max_imgs - (event.image_count or 0), 0)

    # ── 3. Batch size guard ───────────────────────────────────────────────────
    if len(files) > MAX_FILES_PER_BATCH:
        raise HTTPException(status_code=400, detail=f"Max {MAX_FILES_PER_BATCH} files per request")

    # ── 4. Process files ──────────────────────────────────────────────────────
    photo_records  = []
    result_files   = []
    uploaded_count = 0
    skipped_count  = 0

    for idx, file in enumerate(files):
        if uploaded_count >= slots_left:
            skipped_count += len(files) - idx
            result_files.append({
                "original_filename": file.filename,
                "stored_filename":   None,
                "status":            "skipped",
                "reason":            "plan_limit_reached",
            })
            continue

        if _ext(file.filename or "") not in ACCEPTED_EXTENSIONS:
            result_files.append({
                "original_filename": file.filename,
                "stored_filename":   None,
                "status":            "failed",
                "reason":            "invalid_file_type",
            })
            continue

        content = await file.read()
        file_size = len(content)

        if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            result_files.append({
                "original_filename": file.filename,
                "stored_filename":   None,
                "status":            "failed",
                "reason":            f"file_too_large_max_{MAX_FILE_SIZE_MB}mb",
            })
            continue

        # Store raw file
        raw_filename = f"raw_{uuid.uuid4().hex}{_ext(file.filename or '.jpg')}"
        try:
            storage_service.upload_file(
                data=content,
                event_id=event_id,
                filename=raw_filename,
                content_type=file.content_type or "image/jpeg",
            )
        except Exception as e:
            result_files.append({
                "original_filename": file.filename,
                "stored_filename":   None,
                "status":            "failed",
                "reason":            f"storage_error: {e}",
            })
            continue

    #After the loop that approves all photos, add: for incremental    
    guest_count = sum(1 for p in approved_photos if p.uploaded_by == "guest")
    if guest_count > 0:
        event = db.query(Event).filter(Event.id == event_id).first()
        if event:
            event.guest_uploads_used = (event.guest_uploads_used or 0) + guest_count    

        photo_records.append(Photo(
            event_id=event_id,
            original_filename=file.filename,
            stored_filename=raw_filename,
            file_size_bytes=file_size,
            uploaded_by="owner",
            approval_status="approved",
            status="uploaded",
        ))
        result_files.append({
            "original_filename": file.filename,
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

    return {
        "uploaded":    uploaded_count,
        "skipped":     skipped_count,
        "failed":      sum(1 for r in result_files if r["status"] == "failed"),
        "results":     result_files,
        "event_image_count": event.image_count,
    }
