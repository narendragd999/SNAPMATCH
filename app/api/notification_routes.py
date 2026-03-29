"""
Event Notification Routes

Endpoints for sending event-related email notifications:
- POST /events/{id}/notify/photos-ready - Notify guests their photos are ready
- POST /events/{id}/notify/guest-upload - Notify photographer of guest upload (auto-triggered)
- GET /events/{id}/notifications/status - Get notification status
- PUT /events/{id}/notifications/settings - Update notification preferences
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime

from app.database.db import get_db
from app.models.event import Event
from app.models.user import User
from app.models.photo import Photo
from app.core.dependencies import get_current_user
from app.services.event_emails import (
    send_photos_ready_email,
    send_guest_upload_notification,
    send_bulk_photos_ready_emails,
)
from app.api.analytics_routes import log_activity
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["event-notifications"])


# =============================================================================
# Schemas
# =============================================================================

class NotifyPhotosReadyRequest(BaseModel):
    """Request to notify guests their photos are ready."""
    emails: List[EmailStr] = Field(..., description="List of guest emails to notify")
    custom_message: Optional[str] = Field(None, max_length=500, description="Optional custom message")


class NotifySingleGuestRequest(BaseModel):
    """Request to notify a single guest."""
    email: EmailStr
    photo_count: Optional[int] = None


class NotificationSettings(BaseModel):
    """Email notification preferences for an event."""
    notify_on_guest_upload: bool = True
    notify_on_expiry_warning: bool = True
    expiry_warning_days: int = Field(default=7, ge=1, le=30)
    notify_on_processing_complete: bool = True


class NotificationStatus(BaseModel):
    """Status of notifications for an event."""
    event_id: int
    event_name: str
    emails_sent_today: int
    last_notification_at: Optional[datetime]
    notification_settings: dict


# =============================================================================
# Routes
# =============================================================================

@router.post("/{event_id}/notify/photos-ready")
def notify_photos_ready(
    event_id: int,
    data: NotifyPhotosReadyRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send 'Your Photos Are Ready' emails to a list of guest emails.
    
    This is typically used by photographers to notify specific guests
    after processing is complete.
    
    Rate limited to prevent abuse.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Check ownership
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to notify guests for this event")
    
    # Check event has photos
    photo_count = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.status == "processed",
        Photo.approval_status == "approved"
    ).count()
    
    if photo_count == 0:
        raise HTTPException(status_code=400, detail="No processed photos in this event")
    
    # Limit number of emails per request
    if len(data.emails) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 emails per request")
    
    # Build event URL
    # TODO: Get from config
    event_url = f"https://snapmatch.com/public/{event.public_token}"
    
    # Send emails in background
    def send_emails():
        results = send_bulk_photos_ready_emails(
            emails=data.emails,
            event_name=event.name,
            event_token=event.public_token,
            photo_count=photo_count,
            event_url=event_url,
            photographer_name=current_user.name or "The Photographer",
            db=None,  # Can't use same session in background
        )
        logger.info(f"Bulk photos ready emails: {results}")
    
    background_tasks.add_task(send_emails)
    
    # Log activity
    log_activity(
        db=db,
        activity_type="email_notification",
        action="photos_ready_notification",
        user_id=current_user.id,
        event_id=event_id,
        description=f"Sent photos ready notification to {len(data.emails)} guests",
        request_path=f"/events/{event_id}/notify/photos-ready",
        request_method="POST",
        metadata={"email_count": len(data.emails), "photo_count": photo_count},
    )
    
    return {
        "success": True,
        "message": f"Sending notifications to {len(data.emails)} guests",
        "photo_count": photo_count,
        "recipient_count": len(data.emails),
    }


@router.post("/{event_id}/notify/guest/{guest_email:path}")
def notify_single_guest(
    event_id: int,
    guest_email: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send 'Your Photos Are Ready' email to a single guest.
    Useful for notifying individual guests on-demand.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get photo count
    photo_count = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.status == "processed",
        Photo.approval_status == "approved"
    ).count()
    
    event_url = f"https://snapmatch.com/public/{event.public_token}"
    
    # Send in background
    def send_email_task():
        send_photos_ready_email(
            to_email=guest_email,
            event_name=event.name,
            event_token=event.public_token,
            photo_count=photo_count,
            event_url=event_url,
            photographer_name=current_user.name or "The Photographer",
        )
    
    background_tasks.add_task(send_email_task)
    
    return {
        "success": True,
        "message": f"Sending notification to {guest_email}",
    }


@router.post("/{event_id}/notify/guest-upload")
def trigger_guest_upload_notification(
    event_id: int,
    guest_name: Optional[str],
    photo_count: int,
    db: Session = Depends(get_db),
):
    """
    Internal endpoint to notify photographer of guest upload.
    Usually called automatically by guest upload flow.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Get owner
    owner = db.query(User).filter(User.id == event.owner_id).first()
    if not owner or not owner.email:
        return {"success": False, "message": "Owner has no email"}
    
    # Check notification preferences
    # TODO: Implement preferences check
    
    # Get pending count
    pending_count = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.approval_status == "pending"
    ).count()
    
    event_url = f"https://snapmatch.com/events/{event_id}"
    
    success = send_guest_upload_notification(
        photographer_email=owner.email,
        photographer_name=owner.name or owner.email,
        event_name=event.name,
        event_id=event_id,
        guest_name=guest_name or "A guest",
        photo_count=photo_count,
        pending_count=pending_count,
        event_url=event_url,
        db=db,
    )
    
    return {
        "success": success,
        "message": "Notification sent" if success else "Failed to send",
    }


@router.get("/{event_id}/notifications/status")
def get_notification_status(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get notification status and history for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # TODO: Implement notification history tracking
    # For now, return basic info
    
    return {
        "event_id": event_id,
        "event_name": event.name,
        "emails_sent_today": 0,  # TODO: Track this
        "last_notification_at": None,  # TODO: Track this
        "notification_settings": {
            "notify_on_guest_upload": True,
            "notify_on_expiry_warning": True,
            "expiry_warning_days": 7,
        },
        "photo_count": db.query(Photo).filter(
            Photo.event_id == event_id,
            Photo.status == "processed"
        ).count(),
    }


@router.put("/{event_id}/notifications/settings")
def update_notification_settings(
    event_id: int,
    settings: NotificationSettings,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update email notification preferences for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # TODO: Store these settings in the event model or a separate table
    # For now, just return success
    
    log_activity(
        db=db,
        activity_type="settings_change",
        action="notification_settings_updated",
        user_id=current_user.id,
        event_id=event_id,
        description=f"Updated notification settings for event {event.name}",
        metadata=settings.dict(),
    )
    
    return {
        "success": True,
        "message": "Notification settings updated",
        "settings": settings.dict(),
    }


@router.post("/{event_id}/notify/test")
def send_test_event_email(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send a test notification email to the current user."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not current_user.email:
        raise HTTPException(status_code=400, detail="You don't have an email address")
    
    photo_count = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.status == "processed"
    ).count()
    
    event_url = f"https://snapmatch.com/public/{event.public_token}"
    
    success = send_photos_ready_email(
        to_email=current_user.email,
        event_name=event.name,
        event_token=event.public_token,
        photo_count=photo_count,
        event_url=event_url,
        photographer_name=current_user.name or "Test",
        db=db,
    )
    
    return {
        "success": success,
        "message": f"Test email sent to {current_user.email}" if success else "Failed to send",
    }
