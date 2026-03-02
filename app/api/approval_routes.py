"""
app/api/approval_routes.py
Endpoints for owner to approve/reject guest-uploaded photos.

These routes handle individual photo approvals (one at a time).
For bulk operations see guest_upload_routes.py (bulk-approve / bulk-reject).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database.db import SessionLocal
from app.models.photo import Photo
from app.models.event import Event
from app.models.user import User
from app.core.dependencies import get_current_user, get_db
#from app.workers.tasks import process_images      # ← needed to queue processing
from app.workers.tasks import process_event
from datetime import datetime
from app.core.config import STORAGE_PATH
# ✅ CORRECT — in both approval_routes.py and guest_upload_routes.py
from app.api.guest_upload_utils import delete_guest_preview
import os

router = APIRouter(prefix="/events", tags=["photo_approval"])

# ─── APPROVE PHOTO (guest upload) ──────────────────────────────────────────
@router.put("/{event_id}/photos/{photo_id}/approve")
def approve_photo(
    event_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner approves a guest-uploaded photo.
    Transitions: approval_status 'pending' → 'approved'

    After approval the photo enters the incremental processing pipeline:
    optimize → face detection → clustering → FAISS index rebuild.
    event.image_count is incremented here (photo now officially part of gallery).
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    if photo.uploaded_by != "guest":
        raise HTTPException(
            status_code=400,
            detail="Only guest uploads require approval"
        )

    if photo.approval_status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Photo is already '{photo.approval_status}', cannot approve"
        )

    # Approve
    photo.approval_status = "approved"
    photo.approved_by = current_user.id
    photo.approved_at = datetime.utcnow()

    # ── FIX: Increment image_count — photo is now officially in the gallery ──
    event.image_count = (event.image_count or 0) + 1

    db.commit()
    db.refresh(photo)

    # ── Clean up preview thumbnail (no longer needed after approval) ──
    #delete_guest_preview(photo)

    # ── FIX: Actually queue the photo for processing ──────────────────────────
    # The task is incremental — it only processes photos with
    # status='uploaded' AND approval_status='approved', so already-processed
    # photos are never touched again.
    #process_images.apply_async(args=[event_id], queue="face_processing")
    #process_event.apply_async(args=[event_id], queue="photo_processing")
    process_event.apply_async(args=[event_id], queue="default")

    return {
        "message": "Photo approved and queued for processing",
        "photo": photo.to_dict(include_guest_info=True)
    }


# ─── REJECT PHOTO (guest upload) ──────────────────────────────────────────
@router.put("/{event_id}/photos/{photo_id}/reject")
def reject_photo(
    event_id: int,
    photo_id: int,
    reason: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner rejects a guest-uploaded photo.
    Transitions: approval_status 'pending' → 'rejected'
    Photo is permanently excluded from the processing pipeline.
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    if photo.uploaded_by != "guest":
        raise HTTPException(
            status_code=400,
            detail="Only guest uploads can be rejected"
        )

    if photo.approval_status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Photo is '{photo.approval_status}', not pending"
        )

    photo.approval_status = "rejected"
    photo.approved_by = current_user.id
    photo.approved_at = datetime.utcnow()
    if reason:
        photo.rejection_reason = reason

    db.commit()
    db.refresh(photo)

    # ── Clean up preview thumbnail ──
    #delete_guest_preview(photo)

    return {
        "message": "Photo rejected",
        "photo": photo.to_dict(include_guest_info=True)
    }


# ─── RE-APPROVE REJECTED PHOTO ──────────────────────────────────────────────
@router.put("/{event_id}/photos/{photo_id}/re-approve")
def re_approve_photo(
    event_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner changes their mind and approves a previously rejected photo.
    Transitions: approval_status 'rejected' → 'approved'

    image_count is NOT incremented again here — it was already counted
    when the photo was first approved (or never counted if it went straight
    from pending → rejected, meaning it was never in the gallery count).

    We DO re-trigger processing so the photo goes through the pipeline.
    The task's incremental filter (status='uploaded', approval_status='approved')
    will pick it up correctly since its status was never changed from 'uploaded'.
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    if photo.approval_status != "rejected":
        raise HTTPException(
            status_code=400,
            detail=f"Photo is '{photo.approval_status}', not rejected"
        )

    photo.approval_status = "approved"
    photo.approved_by = current_user.id
    photo.approved_at = datetime.utcnow()
    photo.rejection_reason = None   # Clear the rejection reason

    # If this photo was previously rejected before it was ever counted in the
    # gallery (pending → rejected path), we should add it to image_count now.
    # If it was approved → rejected (unlikely flow), it was already counted.
    # Safe heuristic: only increment if the photo has never been processed
    # (status still 'uploaded' means it was rejected before processing ran).
    if photo.status == "uploaded":
        event.image_count = (event.image_count or 0) + 1

    db.commit()
    db.refresh(photo)

    # ── FIX: Queue photo for processing ──────────────────────────────────────
    #process_images.apply_async(args=[event_id], queue="face_processing")
    #process_event.apply_async(args=[event_id], queue="photo_processing")
    process_event.apply_async(args=[event_id], queue="default")


    return {
        "message": "Photo re-approved and queued for processing",
        "photo": photo.to_dict(include_guest_info=True)
    }


# ─── LIST PENDING PHOTOS (owner review queue) ────────────────────────────────
@router.get("/{event_id}/photos/pending")
def list_pending_photos(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all photos pending owner review (guest uploads only).
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    pending_photos = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.approval_status == "pending"
    ).order_by(Photo.uploaded_at.desc()).all()

    approved_count = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.approval_status == "approved",
        Photo.uploaded_by == "guest"
    ).count()

    rejected_count = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.approval_status == "rejected"
    ).count()

    return {
        "pending": [p.to_dict(include_guest_info=True) for p in pending_photos],
        "total_pending": len(pending_photos),
        "total_approved": approved_count,
        "total_rejected": rejected_count,
    }


# ─── GET SINGLE PHOTO ──────────────────────────────────────────────────────
@router.get("/{event_id}/photos/{photo_id}")
def get_photo(
    event_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get details of a single photo."""
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    return photo.to_dict(include_guest_info=True)


# ─── LIST ALL PHOTOS (with filtering) ──────────────────────────────────────
@router.get("/{event_id}/photos")
def list_photos(
    event_id: int,
    approval_status: str = None,
    uploaded_by: str = None,
    status: str = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all photos with optional filtering.

    Query params:
    - approval_status: 'approved' | 'pending' | 'rejected'
    - uploaded_by: 'owner' | 'guest'
    - status: 'uploaded' | 'optimizing' | 'optimized' | 'processed' | 'failed'
    - skip: pagination offset
    - limit: max results (capped at 100)
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    query = db.query(Photo).filter(Photo.event_id == event_id)

    if approval_status:
        query = query.filter(Photo.approval_status == approval_status)
    if uploaded_by:
        query = query.filter(Photo.uploaded_by == uploaded_by)
    if status:
        query = query.filter(Photo.status == status)

    total = query.count()
    photos = query.order_by(Photo.uploaded_at.desc()).offset(skip).limit(min(limit, 100)).all()

    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "photos": [p.to_dict(include_guest_info=True) for p in photos]
    }
