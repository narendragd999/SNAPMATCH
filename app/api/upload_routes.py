"""
app/api/upload_routes.py

Owner photo upload — two modes:
  1. POST /{event_id}/presign   → returns presigned MinIO PUT URLs (browser uploads direct)
  2. POST /{event_id}/confirm   → registers DB records after direct upload completes
  3. POST /{event_id}           → legacy multipart fallback (still works)

Performance notes:
  - presign:  UUIDs generated in Python (no boto3 loop), URLs generated in parallel
              via ThreadPoolExecutor — 1000 files ≈ same latency as 10
  - confirm:  single bulk INSERT via bulk_insert_mappings — 2000 rows = 1 DB round trip
  - image_count: atomic SQL UPDATE ... + N — no race condition on concurrent retries
"""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.services import storage_service
from app.core.plans import PLANS

router = APIRouter(prefix="/upload", tags=["upload"])

ACCEPTED_EXTENSIONS   = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
MAX_FILE_SIZE_MB      = int(os.getenv("MAX_PHOTO_SIZE_MB", "20"))
LEGACY_FALLBACK_QUOTA = 5000
PRESIGN_WORKERS       = int(os.getenv("PRESIGN_WORKERS", "20"))
PRESIGN_EXPIRY        = 3600  # 1 hour

MINIO_INTERNAL = os.getenv("MINIO_ENDPOINT", "http://minio:9000")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _effective_quota(event: Event, user: User) -> int:
    if event.photo_quota is not None:
        return event.photo_quota
    plan = PLANS.get(user.plan_type, PLANS["free"])
    return plan.get("max_images_per_event") or LEGACY_FALLBACK_QUOTA


def _guard_event(event_id: int, current_user: User, db: Session) -> Event:
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
    Generates presigned PUT URLs in parallel (PRESIGN_WORKERS threads).
    1000 files with 20 workers = same wall-clock time as ~50 files serial.
    """
    event = _guard_event(event_id, current_user, db)

    quota     = _effective_quota(event, current_user)
    available = quota - (event.image_count or 0)
    if available <= 0:
        raise HTTPException(status_code=400, detail=f"Photo quota reached ({quota}).")

    # Filter and assign stored filenames — pure Python, instant regardless of count
    accepted: list[tuple[str, str]] = []
    errors:   list[dict]            = []

    for original_name in body.filenames[:available]:
        ext = Path(original_name).suffix.lower()
        if ext not in ACCEPTED_EXTENSIONS:
            errors.append({"original_filename": original_name, "error": "unsupported_type"})
            continue
        stored_filename = f"raw_{uuid.uuid4().hex}{ext}"
        accepted.append((original_name, stored_filename))

    if not accepted:
        return {"files": errors, "quota_remaining": available}

    s3     = storage_service._get_s3()
    bucket = storage_service.MINIO_BUCKET

    def _make_url(item: tuple[str, str]) -> dict:
        original_name, stored_filename = item
        object_key = f"events/{event_id}/{stored_filename}"
        try:
            # Sign with application/octet-stream so the URL works for
            # any image type (jpeg, png, webp) — browser must send this
            # exact Content-Type header when doing the PUT
            internal_url = s3.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket":      bucket,
                    "Key":         object_key,
                    "ContentType": "application/octet-stream",
                },
                ExpiresIn=PRESIGN_EXPIRY,
            )
            # Rewrite internal MinIO URL → public nginx /minio-upload/ path
            public_url = internal_url.replace(
                MINIO_INTERNAL.rstrip("/") + "/" + bucket,
                "/minio-upload/" + bucket,
            )
            return {
                "original_filename": original_name,
                "stored_filename":   stored_filename,
                "upload_url":        public_url,
                "object_key":        object_key,
            }
        except Exception as e:
            return {"original_filename": original_name, "error": str(e)}

    # Parallel URL generation — boto3 is thread-safe for presigned URLs
    results: list[dict] = [None] * len(accepted)  # type: ignore
    with ThreadPoolExecutor(max_workers=min(PRESIGN_WORKERS, len(accepted))) as pool:
        future_to_idx = {pool.submit(_make_url, item): i for i, item in enumerate(accepted)}
        for future in as_completed(future_to_idx):
            results[future_to_idx[future]] = future.result()

    return {"files": errors + results, "quota_remaining": available}


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
    Single bulk INSERT regardless of file count.
    Atomic image_count increment — safe under concurrent retries.
    Idempotent — duplicate stored_filenames are silently skipped.
    """
    event = _guard_event(event_id, current_user, db)

    if not body.uploads:
        quota = _effective_quota(event, current_user)
        return {
            "confirmed":          0,
            "skipped_duplicates": 0,
            "event_image_count":  event.image_count or 0,
            "photo_quota":        quota,
            "photos_remaining":   max(0, quota - (event.image_count or 0)),
        }

    # Deduplicate against what's already in DB — makes retries safe
    existing_filenames = {
        row[0] for row in db.execute(
            text("SELECT stored_filename FROM photos WHERE event_id = :eid"),
            {"eid": event_id},
        )
    }

    mappings = [
        {
            "event_id":          event_id,
            "original_filename": item.original_filename,
            "stored_filename":   item.stored_filename,
            "file_size_bytes":   item.file_size_bytes,
            "uploaded_by":       "owner",
            "approval_status":   "approved",
            "status":            "uploaded",
        }
        for item in body.uploads
        if item.stored_filename not in existing_filenames
    ]

    new_count      = len(mappings)
    skipped_count  = len(body.uploads) - new_count

    if new_count:
        # Single round trip for any number of rows
        db.bulk_insert_mappings(Photo, mappings)

        # Atomic increment + mark event as having unprocessed photos
        # processing_status='queued' makes the Process button appear in the UI
        # even if the browser loses uploadSuccess state (e.g. page refresh)
        db.execute(
            text("""
                UPDATE events
                SET image_count        = COALESCE(image_count, 0) + :n,
                    processing_status  = CASE
                                            WHEN processing_status = 'processing' THEN 'processing'
                                            ELSE 'queued'
                                         END
                WHERE id = :eid
            """),
            {"n": new_count, "eid": event_id},
        )
        db.commit()
        db.refresh(event)

    quota = _effective_quota(event, current_user)
    return {
        "confirmed":          new_count,
        "skipped_duplicates": skipped_count,
        "event_image_count":  event.image_count or 0,
        "photo_quota":        quota,
        "photos_remaining":   max(0, quota - (event.image_count or 0)),
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

    effective_quota = _effective_quota(event, current_user)
    available_slots = effective_quota - (event.image_count or 0)
    if available_slots <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Photo quota reached ({effective_quota} photos).",
        )

    uploaded = []
    failed   = []
    mappings = []

    for file in files:
        if len(mappings) >= available_slots:
            failed.append({"filename": file.filename or "unknown", "reason": "quota_reached"})
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

        mappings.append({
            "event_id":          event_id,
            "original_filename": original_name,
            "stored_filename":   stored_filename,
            "file_size_bytes":   len(content),
            "uploaded_by":       "owner",
            "approval_status":   "approved",
            "status":            "uploaded",
        })
        uploaded.append({"filename": original_name, "stored": stored_filename})

    if mappings:
        db.bulk_insert_mappings(Photo, mappings)
        db.execute(
            text("UPDATE events SET image_count = COALESCE(image_count, 0) + :n WHERE id = :eid"),
            {"n": len(mappings), "eid": event_id},
        )
        db.commit()
        db.refresh(event)

    return {
        "uploaded":          uploaded,
        "failed":            failed,
        "total_uploaded":    len(mappings),
        "event_image_count": event.image_count,
        "photo_quota":       effective_quota,
        "photos_remaining":  max(0, effective_quota - (event.image_count or 0)),
    }