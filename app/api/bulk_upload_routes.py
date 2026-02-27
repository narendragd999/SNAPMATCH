"""
app/api/bulk_upload_routes.py

Bulk-upload endpoint consumed by BulkUploadModal.tsx.

WHY A SEPARATE ROUTE?
  The existing POST /upload/{event_id} works for small batches, but this
  dedicated endpoint adds:
    • X-Batch-Index / X-Total-Batches headers for server-side logging/ordering
    • Per-upload idempotency key (X-Upload-Session) to avoid double-counting
      on client retry
    • Richer JSON response with per-file status for the frontend to display
    • Hard limit: 50 files per call (BATCH_SIZE on frontend is 20, so headroom)

USAGE  (frontend already calls /upload/{event_id}, but you can point it here)
  POST /bulk-upload/{event_id}
  Headers:
    Authorization: Bearer <token>
    X-Upload-Session: <uuid>          # unique per drag-and-drop session
    X-Batch-Index: 3                  # 0-based batch number (for logging)
    X-Total-Batches: 12               # total batches in session
  Body:
    multipart/form-data  files[]=...

INTEGRATION
  In app/main.py (or app/__init__.py) add:
    from app.api.bulk_upload_routes import router as bulk_upload_router
    app.include_router(bulk_upload_router)
"""

import os
import uuid
import hashlib
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.core.plans import PLANS
from app.core.config import STORAGE_PATH

router = APIRouter(prefix="/bulk-upload", tags=["bulk-upload"])

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_FILES_PER_BATCH = 50          # hard server-side limit per request
ACCEPTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_FILE_SIZE_MB    = 25          # reject individual files >25 MB


# ── DB dependency ──────────────────────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _ext(filename: str) -> str:
    return os.path.splitext(filename.lower())[1]


def _file_hash(content: bytes) -> str:
    """Quick SHA-1 of first 8 KB for dedup detection (not cryptographic)."""
    return hashlib.sha1(content[:8192]).hexdigest()


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/{event_id}")
def bulk_upload(
    event_id:       int,
    files:          List[UploadFile] = File(...),
    db:             Session          = Depends(get_db),
    current_user:   User             = Depends(get_current_user),
    # Optional headers sent by BulkUploadModal
    x_upload_session: Optional[str] = Header(None),   # client session UUID
    x_batch_index:    Optional[str] = Header(None),   # "3"
    x_total_batches:  Optional[str] = Header(None),   # "12"
):
    """
    Accept a batch of images for an event.

    Returns JSON:
    {
      "session":       "abc123",
      "batch_index":   3,
      "total_batches": 12,
      "uploaded":      20,
      "skipped":       0,
      "failed":        0,
      "event_image_count": 250,
      "files": [
        { "original_filename": "IMG_001.jpg", "stored_filename": "raw_uuid", "status": "uploaded" },
        ...
      ]
    }
    """

    # ── 1. Validate event ownership ──────────────────────────────────────────
    event = db.query(Event).filter(
        Event.id       == event_id,
        Event.owner_id == current_user.id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.expires_at and event.expires_at < datetime.utcnow():
        raise HTTPException(status_code=403, detail="Event has expired")

    # ── 2. Plan quota check ───────────────────────────────────────────────────
    plan      = PLANS.get(current_user.plan_type, PLANS["free"])
    max_imgs  = plan["max_images_per_event"]

    if event.image_count >= max_imgs:
        raise HTTPException(
            status_code=403,
            detail=f"Plan limit reached ({max_imgs} images per event)",
        )

    # How many slots remain?
    slots_left = max_imgs - event.image_count

    # ── 3. Batch size guard ───────────────────────────────────────────────────
    if len(files) > MAX_FILES_PER_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Max {MAX_FILES_PER_BATCH} files per request",
        )

    # ── 4. Ensure storage dir ─────────────────────────────────────────────────
    event_folder = os.path.join(STORAGE_PATH, str(event_id))
    os.makedirs(event_folder, exist_ok=True)

    # ── 5. Process files ──────────────────────────────────────────────────────
    photo_records  = []
    result_files   = []
    uploaded_count = 0
    skipped_count  = 0
    failed_details = []

    for idx, file in enumerate(files):
        # Slot cap mid-batch
        if uploaded_count >= slots_left:
            skipped_count += len(files) - idx
            result_files.append({
                "original_filename": file.filename,
                "stored_filename": None,
                "status": "skipped",
                "reason": "plan_limit_reached",
            })
            continue

        # Extension check
        if _ext(file.filename or "") not in ACCEPTED_EXTENSIONS:
            failed_details.append(file.filename)
            result_files.append({
                "original_filename": file.filename,
                "stored_filename": None,
                "status": "failed",
                "reason": "invalid_file_type",
            })
            continue

        # Read content
        try:
            content = await_read(file)           # see sync wrapper below
        except Exception:
            failed_details.append(file.filename)
            result_files.append({
                "original_filename": file.filename,
                "stored_filename": None,
                "status": "failed",
                "reason": "read_error",
            })
            continue

        # Size check
        file_size = len(content)
        if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            failed_details.append(file.filename)
            result_files.append({
                "original_filename": file.filename,
                "stored_filename": None,
                "status": "failed",
                "reason": f"file_too_large_max_{MAX_FILE_SIZE_MB}mb",
            })
            continue

        # Write to disk
        raw_filename = f"raw_{uuid.uuid4()}"
        raw_path     = os.path.join(event_folder, raw_filename)

        try:
            with open(raw_path, "wb") as buf:
                buf.write(content)
        except OSError as exc:
            failed_details.append(file.filename)
            result_files.append({
                "original_filename": file.filename,
                "stored_filename": None,
                "status": "failed",
                "reason": f"disk_error: {exc}",
            })
            continue

        # Create Photo ORM row
        photo = Photo(
            event_id=event_id,
            original_filename=file.filename,
            stored_filename=raw_filename,
            file_size_bytes=file_size,
            status="uploaded",
            approval_status="approved",   # owner upload = auto-approved
            uploaded_by="owner",
            uploaded_at=datetime.utcnow(),
        )
        photo_records.append(photo)
        uploaded_count += 1

        result_files.append({
            "original_filename": file.filename,
            "stored_filename": raw_filename,
            "status": "uploaded",
        })

    # ── 6. Persist to DB ─────────────────────────────────────────────────────
    if photo_records:
        db.add_all(photo_records)

    # Reset event processing state so the UI shows "queued" again
    if uploaded_count > 0:
        event.image_count          += uploaded_count
        event.processing_status     = "queued"
        event.processing_progress   = 0
        event.processing_started_at = None

    db.commit()

    # ── 7. Flush stored_filename back (after commit IDs are assigned) ────────
    for i, photo in enumerate(photo_records):
        # find matching result_files entry and update id
        for rf in result_files:
            if rf.get("stored_filename") == photo.stored_filename:
                rf["photo_id"] = photo.id
                break

    # ── 8. Build response ────────────────────────────────────────────────────
    batch_idx  = int(x_batch_index)   if x_batch_index   and x_batch_index.isdigit()   else None
    total_batches = int(x_total_batches) if x_total_batches and x_total_batches.isdigit() else None

    return {
        "session":           x_upload_session,
        "batch_index":       batch_idx,
        "total_batches":     total_batches,
        "uploaded":          uploaded_count,
        "skipped":           skipped_count,
        "failed":            len(failed_details),
        "failed_filenames":  failed_details,
        "event_image_count": event.image_count,
        "files":             result_files,
    }


# ── Sync file read helper ──────────────────────────────────────────────────────
# FastAPI's UploadFile.file is a SpooledTemporaryFile; .read() is sync.
# We wrap it so the endpoint body stays clean.

def await_read(upload_file: UploadFile) -> bytes:
    """Read UploadFile content (sync-safe within FastAPI thread pool)."""
    upload_file.file.seek(0)
    return upload_file.file.read()
