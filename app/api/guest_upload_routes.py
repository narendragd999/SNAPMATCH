"""
app/api/guest_upload_routes.py
Guest upload approval/rejection workflow using unified Photo model
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.user import User
from app.models.photo import Photo
from app.core.dependencies import get_current_user, get_db
#from app.workers.tasks import process_images
from app.workers.tasks import process_event
# ✅ CORRECT — in both approval_routes.py and guest_upload_routes.py
from app.api.guest_upload_utils import delete_guest_preview
from typing import Optional, List
from datetime import datetime
import os
from app.core.config import STORAGE_PATH
from app.services import storage_service  # add this import at the top if not present


router = APIRouter(prefix="/events", tags=["guest_uploads"])


def _photo_dict(photo: Photo, include_guest_info=False):
    """Convert Photo to dict for API responses"""

    # ✅ FIXED — use storage_service to build correct URLs for all backends
    if photo.guest_preview_filename:
        preview_url = storage_service.get_guest_preview_url(
            photo.event_id, photo.guest_preview_filename
        )
    elif photo.optimized_filename:
        # Use optimized thumbnail if available
        base = photo.optimized_filename.rsplit(".", 1)[0]
        thumb_name = f"{base}.webp"
        preview_url = storage_service.get_thumbnail_url(photo.event_id, thumb_name)
    else:
        # Fallback to raw stored file
        preview_url = storage_service.get_file_url(photo.event_id, photo.stored_filename)

    data = {
        "id":                photo.id,
        "event_id":          photo.event_id,
        "original_filename": photo.original_filename,
        "stored_filename":   photo.stored_filename,
        "thumbnail_url":     preview_url,
        "status":            photo.approval_status,
        "approval_status":   photo.approval_status,
        "uploaded_by":       photo.uploaded_by,
        "faces_detected":    photo.faces_detected,
        "uploaded_at":       photo.uploaded_at.isoformat() if photo.uploaded_at else None,
        "approved_at":       photo.approved_at.isoformat() if photo.approved_at else None,
    }

    if include_guest_info and photo.uploaded_by == "guest":
        data.update({
            "contributor_name": photo.guest_name,
            "guest_name":       photo.guest_name,
            "guest_email":      photo.guest_email,
            "message":          photo.guest_message,
            "guest_message":    photo.guest_message,
            "guest_ip":         photo.guest_ip,
        })

    return data


# ─── LIST GUEST UPLOADS (Owner Review Queue) ────────────────────────────
@router.get("/{event_id}/guest-uploads")
def list_guest_uploads(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get all guest uploads for owner review, grouped by approval status.
    Returns pending photos that need owner decision.
    """
    # Verify event ownership
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Get all guest uploads grouped by approval status
    pending = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest",
        Photo.approval_status == "pending"
    ).order_by(Photo.uploaded_at.desc()).all()
    
    approved = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest",
        Photo.approval_status == "approved"
    ).order_by(Photo.approved_at.desc()).all()
    
    rejected = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest",
        Photo.approval_status == "rejected"
    ).order_by(Photo.approved_at.desc()).all()
    
    return {
        "event_id": event_id,
        "pending": [_photo_dict(p, include_guest_info=True) for p in pending],
        "approved": [_photo_dict(p, include_guest_info=True) for p in approved],
        "rejected": [_photo_dict(p, include_guest_info=True) for p in rejected],
        "summary": {
            "total_pending": len(pending),
            "total_approved": len(approved),
            "total_rejected": len(rejected),
        }
    }


# ─── GET SINGLE GUEST UPLOAD ──────────────────────────────────────────────
@router.post("/{event_id}/guest-uploads/bulk-approve")
def bulk_approve_guest_uploads(
    event_id: int,
    photo_ids: Optional[List[int]] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner approves multiple guest photos at once.

    photo_ids (optional JSON body list):
      - Omitted or null → approves ALL pending guest photos for the event.
        This is what the "Approve All" button sends (no body).
      - Provided        → approves only the specified photo IDs.
    """
    # Verify event ownership
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Build query — filter to specific IDs only when caller provides them
    query = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest",
        Photo.approval_status == "pending",
    )
    if photo_ids:
        query = query.filter(Photo.id.in_(photo_ids))

    photos = query.all()

    if not photos:
        raise HTTPException(status_code=404, detail="No pending guest photos found")
    
    # Approve all
    now = datetime.utcnow()
    for photo in photos:
        photo.approval_status = "approved"
        # Increment guest quota counter
        if photo.uploaded_by == "guest":
            event = db.query(Event).filter(Event.id == event_id).first()
            if event:
                event.guest_uploads_used = (event.guest_uploads_used or 0) + 1
        photo.approved_by = current_user.id
        photo.approved_at = now
        #delete_guest_preview(photo)     # ← ADD THIS

    # Increment event.image_count by number of newly approved photos
    event.image_count = (event.image_count or 0) + len(photos)

    db.commit()

    # Single process_images job covers all newly approved photos in one run
    #process_images.apply_async(args=[event_id], queue="face_processing")
    #process_event.apply_async(args=[event_id], queue="photo_processing")
    process_event.apply_async(args=[event_id], queue="default")


    return {
        "success": True,
        "message": f"Approved {len(photos)} guest photos and queued for processing",
        "approved_count": len(photos),
        "photos": [_photo_dict(p, include_guest_info=True) for p in photos]
    }


# ─── BULK REJECT (Multiple at once) ────────────────────────────────────────
@router.post("/{event_id}/guest-uploads/bulk-reject")
def bulk_reject_guest_uploads(
    event_id: int,
    photo_ids: Optional[List[int]] = None,
    reason: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner rejects multiple guest photos at once.

    photo_ids (optional JSON body list):
      - Omitted or null → rejects ALL pending guest photos for the event.
        This is what the "Reject All" button sends (no body).
      - Provided        → rejects only the specified photo IDs.
    reason (optional): stored on each rejected photo for context.
    """
    # Verify event ownership
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Build query — filter to specific IDs only when caller provides them
    query = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest",
        Photo.approval_status == "pending",
    )
    if photo_ids:
        query = query.filter(Photo.id.in_(photo_ids))

    photos = query.all()

    if not photos:
        raise HTTPException(status_code=404, detail="No pending guest photos found")
    
    # Reject all
    now = datetime.utcnow()
    for photo in photos:
        photo.approval_status = "rejected"
        photo.approved_by = current_user.id
        photo.approved_at = now
        #delete_guest_preview(photo)     # ← ADD THIS
        if reason:
            photo.rejection_reason = reason
    
    db.commit()
    
    return {
        "success": True,
        "message": f"Rejected {len(photos)} guest photos",
        "rejected_count": len(photos),
        "photos": [_photo_dict(p, include_guest_info=True) for p in photos]
    }
@router.get("/{event_id}/guest-uploads/{photo_id}")
def get_guest_upload(
    event_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get details of a single guest-uploaded photo"""
    # Verify event ownership
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest"
    ).first()
    
    if not photo:
        raise HTTPException(status_code=404, detail="Guest upload not found")
    
    return _photo_dict(photo, include_guest_info=True)


# ─── APPROVE GUEST UPLOAD ──────────────────────────────────────────────────
# ─── APPROVE GUEST UPLOAD ──────────────────────────────────────────────────
@router.post("/{event_id}/guest-uploads/{photo_id}/approve")
def approve_guest_upload(
    event_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner approves a guest-uploaded photo.
    Handles both: pending → approved  AND  rejected → approved (re-review)
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest"
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Guest upload not found")

    # Block only if already approved
    if photo.approval_status == "approved":
        raise HTTPException(status_code=400, detail="Photo is already approved")

    was_rejected = photo.approval_status == "rejected"

    photo.approval_status  = "approved"
    photo.approved_by      = current_user.id
    photo.approved_at      = datetime.utcnow()
    photo.rejection_reason = None  # clear any previous rejection reason

    # Only increment image_count if not re-approving a rejected photo
    # (rejected photos were never counted in image_count)
    if not was_rejected:
        event.image_count = (event.image_count or 0) + 1

    db.commit()
    db.refresh(photo)
    #delete_guest_preview(photo)

    #process_images.apply_async(args=[event_id], queue="face_processing")
    #process_event.apply_async(args=[event_id], queue="photo_processing")
    process_event.apply_async(args=[event_id], queue="default")


    return {
        "success": True,
        "message": "Guest photo approved and queued for processing",
        "photo": _photo_dict(photo, include_guest_info=True)
    }


# ─── REJECT GUEST UPLOAD ───────────────────────────────────────────────────
# ─── REJECT GUEST UPLOAD ───────────────────────────────────────────────────
@router.post("/{event_id}/guest-uploads/{photo_id}/reject")
def reject_guest_upload(
    event_id: int,
    photo_id: int,
    reason: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner rejects a guest-uploaded photo.
    Handles both: pending → rejected  AND  approved → rejected (re-review)
    """
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest"
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Guest upload not found")

    # Block only if already rejected
    if photo.approval_status == "rejected":
        raise HTTPException(status_code=400, detail="Photo is already rejected")

    was_approved = photo.approval_status == "approved"

    photo.approval_status = "rejected"
    photo.approved_by     = current_user.id
    photo.approved_at     = datetime.utcnow()
    if reason:
        photo.rejection_reason = reason

    # Decrement image_count only if it was previously approved (was in gallery)
    if was_approved:
        event.image_count = max(0, (event.image_count or 1) - 1)

    db.commit()
    db.refresh(photo)
    #delete_guest_preview(photo)

    return {
        "success": True,
        "message": "Guest photo rejected",
        "photo": _photo_dict(photo, include_guest_info=True)
    }


# ─── RE-APPROVE A REJECTED PHOTO ───────────────────────────────────────────
@router.post("/{event_id}/guest-uploads/{photo_id}/re-approve")
def re_approve_guest_upload(
    event_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner changes their mind and approves a previously rejected photo.
    Photo transitions from rejected → approved.
    """
    # Verify event ownership
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Get guest upload (must be rejected)
    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest"
    ).first()
    
    if not photo:
        raise HTTPException(status_code=404, detail="Guest upload not found")
    
    if photo.approval_status != "rejected":
        raise HTTPException(
            status_code=400,
            detail=f"Photo is {photo.approval_status}, not rejected"
        )
    
    # Re-approve
    photo.approval_status = "approved"
    # Increment guest quota counter
    if photo.uploaded_by == "guest":
        event = db.query(Event).filter(Event.id == event_id).first()
        if event:
            event.guest_uploads_used = (event.guest_uploads_used or 0) + 1
    photo.approved_by = current_user.id
    photo.approved_at = datetime.utcnow()
    photo.rejection_reason = None  # Clear rejection reason
    
    db.commit()
    db.refresh(photo)

    # Re-trigger processing — photo needs to go through the pipeline
    # (it was rejected before processing completed, so status is still 'uploaded')
    # Note: image_count is NOT incremented again — it was counted at first approval
    #process_images.apply_async(args=[event_id], queue="face_processing")
    #process_event.apply_async(args=[event_id], queue="photo_processing")
    process_event.apply_async(args=[event_id], queue="default")


    return {
        "success": True,
        "message": "Guest photo re-approved - queued for processing",
        "photo": _photo_dict(photo, include_guest_info=True)
    }


# ─── BULK APPROVE (Multiple at once) ───────────────────────────────────────