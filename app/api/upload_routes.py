"""
app/api/upload_routes.py

Owner photo upload — writes raw file to object store via storage_service.
All existing behaviour preserved; only disk I/O replaced with storage_service calls.
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
from app.core.plans import PLANS
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

    plan_config = PLANS.get(current_user.plan_type, PLANS["free"])
    max_images  = plan_config["max_images_per_event"]
    if event.image_count >= max_images:
        raise HTTPException(
            status_code=400,
            detail=f"Plan limit reached ({max_images} images per event)",
        )

    uploaded  = []
    failed    = []
    new_count = 0

    for file in files:
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

        # Store raw file via storage_service
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
        "uploaded": uploaded,
        "failed":   failed,
        "total_uploaded": new_count,
        "event_image_count": event.image_count,
    }
