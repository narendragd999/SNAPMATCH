import os
import uuid
import shutil
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.user import User
from app.core.dependencies import get_current_user
from app.core.plans import PLANS
from app.workers.tasks import process_images
from app.core.config import STORAGE_PATH

router = APIRouter(prefix="/upload", tags=["upload"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("/{event_id}")
def upload_images(
    event_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.expires_at and event.expires_at < datetime.utcnow():
        raise HTTPException(status_code=403, detail="Event expired")

    plan = PLANS.get(current_user.plan_type, PLANS["free"])
    max_images = plan["max_images_per_event"]

    if event.image_count + len(files) > max_images:
        raise HTTPException(
            status_code=403,
            detail=f"Max {max_images} images allowed"
        )

    event_folder = os.path.join(STORAGE_PATH, str(event_id))
    os.makedirs(event_folder, exist_ok=True)
    
    uploaded = 0
    
    for file in files:

        if not file.filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            raise HTTPException(status_code=400, detail="Invalid file type")

        raw_filename = f"raw_{uuid.uuid4()}"
        raw_path = os.path.join(event_folder, raw_filename)

        with open(raw_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        uploaded += 1

    event.image_count += uploaded
    event.processing_status = "queued"
    event.processing_progress = 0
    event.processing_started_at = None
    event.processing_completed_at = None
    db.commit()

    # 🔥 Trigger Celery (heavy work happens there)
    process_images.delay(event_id)

    return {
        "message": "Images uploaded successfully",
        "uploaded": uploaded,
        "event_image_count": event.image_count
    }