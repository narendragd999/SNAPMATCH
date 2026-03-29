"""
app/api/slideshow_routes.py

Live Slideshow Mode API Routes

Endpoints:
  - GET  /slideshow/{public_token}        → Get slideshow config + initial photos
  - GET  /slideshow/{public_token}/photos → Paginated photos for slideshow
  - POST /events/{event_id}/slideshow     → Update slideshow settings (authenticated)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from app.database.db import get_db
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.core.dependencies import get_current_user
from app.services import storage_service

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC ENDPOINTS (no auth required)
# ═══════════════════════════════════════════════════════════════════════════════

class SlideshowPhotoItem:
    """Photo item for slideshow response"""
    def __init__(self, photo: Photo, event_id: int):
        self.id = photo.id
        self.image_name = photo.optimized_filename or photo.stored_filename
        self.uploaded_at = photo.uploaded_at.isoformat() if photo.uploaded_at else None
        self.scene_label = photo.scene_label
        # Generate full URL
        self.url = storage_service.get_file_url(event_id, self.image_name)


class SlideshowConfigResponse:
    """Slideshow configuration response"""
    def __init__(self, event: Event):
        self.event_id = event.id
        self.event_name = event.name
        self.event_token = event.public_token
        self.slideshow = event.get_slideshow_config()
        self.branding = event.get_branding_config()
        self.total_photos = event.image_count


@router.get("/slideshow/{public_token}")
async def get_slideshow_config(
    public_token: str,
    db: Session = Depends(get_db)
):
    """
    Get slideshow configuration and initial photos for an event.
    This is the entry point for the slideshow page.
    Returns PIN info if PIN protection is enabled.
    """
    event = db.query(Event).filter(Event.public_token == public_token).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Check if event is public
    if event.public_status != "active":
        raise HTTPException(status_code=403, detail="Event is not public")

    # Check if slideshow is enabled
    if not event.slideshow_enabled:
        raise HTTPException(status_code=403, detail="Slideshow is not enabled for this event")

    # Check if event is accessible
    if not event.is_accessible:
        raise HTTPException(status_code=403, detail="Event has expired or is not accessible")

    # Get initial photos (first 50)
    photos = db.query(Photo).filter(
        Photo.event_id == event.id,
        Photo.status == "processed",
        Photo.approval_status == "approved"
    ).order_by(Photo.uploaded_at.desc()).limit(50).all()

    photo_items = []
    for photo in photos:
        image_name = photo.optimized_filename or photo.stored_filename
        if image_name:
            photo_items.append({
                "id": photo.id,
                "image_name": image_name,
                "url": storage_service.get_file_url(event.id, image_name),
                "uploaded_at": photo.uploaded_at.isoformat() if photo.uploaded_at else None,
                "scene_label": photo.scene_label,
            })

    return {
        "event_id": event.id,
        "event_name": event.name,
        "event_token": event.public_token,
        "slideshow": event.get_slideshow_config(),
        "branding": event.get_branding_config(),
        "total_photos": event.image_count,
        "photos": photo_items,
        "has_more": event.image_count > 50,
        # PIN protection info (same as public page)
        "pin_enabled": event.pin_enabled,
        "pin_version": event.pin_version,
        "expires_at": event.expires_at.isoformat() if event.expires_at else None,
        "owner_id": event.owner_id,
    }


@router.get("/slideshow/{public_token}/photos")
async def get_slideshow_photos(
    public_token: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    after_id: Optional[int] = Query(None, description="Get photos after this ID (for real-time updates)"),
    db: Session = Depends(get_db)
):
    """
    Get paginated photos for slideshow.
    Use 'after_id' parameter to get only new photos (polling for real-time updates).
    """
    event = db.query(Event).filter(Event.public_token == public_token).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if not event.slideshow_enabled:
        raise HTTPException(status_code=403, detail="Slideshow is not enabled for this event")

    if not event.is_accessible:
        raise HTTPException(status_code=403, detail="Event has expired or is not accessible")

    query = db.query(Photo).filter(
        Photo.event_id == event.id,
        Photo.status == "processed",
        Photo.approval_status == "approved"
    )

    # If after_id is provided, get only photos after that ID (for real-time polling)
    if after_id:
        query = query.filter(Photo.id > after_id).order_by(Photo.id.asc())
        photos = query.limit(page_size).all()
    else:
        # Regular pagination
        offset = (page - 1) * page_size
        photos = query.order_by(Photo.uploaded_at.desc()).offset(offset).limit(page_size).all()

    photo_items = []
    for photo in photos:
        image_name = photo.optimized_filename or photo.stored_filename
        if image_name:
            photo_items.append({
                "id": photo.id,
                "image_name": image_name,
                "url": storage_service.get_file_url(event.id, image_name),
                "uploaded_at": photo.uploaded_at.isoformat() if photo.uploaded_at else None,
                "scene_label": photo.scene_label,
            })

    # Get the max ID for polling
    max_id = None
    if photo_items:
        max_id = max(p["id"] for p in photo_items)

    return {
        "photos": photo_items,
        "page": page,
        "page_size": page_size,
        "total": event.image_count,
        "has_more": len(photos) == page_size and not after_id,
        "last_id": max_id,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# AUTHENTICATED ENDPOINTS (photographer only)
# ═══════════════════════════════════════════════════════════════════════════════

class SlideshowConfigUpdate:
    """Schema for slideshow config update"""
    def __init__(self, data: dict):
        self.enabled = data.get("enabled")
        self.speed = data.get("speed")
        self.transition = data.get("transition")
        self.show_qr = data.get("show_qr")
        self.show_branding = data.get("show_branding")
        self.music_url = data.get("music_url")


@router.get("/events/{event_id}/slideshow")
async def get_event_slideshow_settings(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get slideshow settings for an event (authenticated)"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Check ownership
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this event")

    return {
        "event_id": event.id,
        "event_name": event.name,
        "public_token": event.public_token,
        "slideshow": event.get_slideshow_config(),
        "slideshow_url": f"/slideshow/{event.public_token}",
    }


@router.post("/events/{event_id}/slideshow")
async def update_event_slideshow_settings(
    event_id: int,
    config: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update slideshow settings for an event (authenticated)"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Check ownership
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this event")

    # Update slideshow config
    event.set_slideshow_config(config)
    db.commit()
    db.refresh(event)

    return {
        "success": True,
        "message": "Slideshow settings updated",
        "slideshow": event.get_slideshow_config(),
        "slideshow_url": f"/slideshow/{event.public_token}",
    }


@router.post("/events/{event_id}/slideshow/toggle")
async def toggle_event_slideshow(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Toggle slideshow on/off for an event (authenticated)"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Check ownership
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this event")

    # Toggle slideshow
    event.slideshow_enabled = not event.slideshow_enabled
    db.commit()
    db.refresh(event)

    return {
        "success": True,
        "enabled": event.slideshow_enabled,
        "message": f"Slideshow {'enabled' if event.slideshow_enabled else 'disabled'}",
        "slideshow_url": f"/slideshow/{event.public_token}" if event.slideshow_enabled else None,
    }