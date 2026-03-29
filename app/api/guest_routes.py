"""
app/api/guest_routes.py

Integrated Guest Management & Email Notification API Endpoints.

This module combines:
1. Guest CRUD operations (create, read, update, delete)
2. CSV import/export functionality
3. Email notification triggers
4. Statistics and engagement tracking

IMPORTANT: All operations are graceful - if no guests exist, the system continues normally.
No errors are thrown, no notifications are sent, and everything works smoothly.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, cast, Integer
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.guest import Guest
from app.models.user import User
from app.core.dependencies import get_current_user
from app.api.analytics_routes import log_activity
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr
import csv
import io
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["guests"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic Schemas
# ═══════════════════════════════════════════════════════════════════════════════

class GuestCreate(BaseModel):
    """Schema for creating a new guest."""
    name: Optional[str] = None
    email: EmailStr
    phone: Optional[str] = None
    notes: Optional[str] = None


class GuestUpdate(BaseModel):
    """Schema for updating a guest."""
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class GuestBulkCreate(BaseModel):
    """Schema for bulk creating guests."""
    guests: List[GuestCreate]


class SendNotificationsRequest(BaseModel):
    """Schema for sending notifications to guests."""
    guest_ids: Optional[List[int]] = None  # If None, send to all unsent
    photo_count: Optional[int] = 0
    event_url: Optional[str] = None


class NotificationPreferences(BaseModel):
    """Schema for event notification preferences."""
    notify_on_guest_upload: Optional[bool] = True
    notify_on_expiry_warning: Optional[bool] = True
    expiry_warning_days: Optional[int] = 7
    notify_on_processing_complete: Optional[bool] = True
    auto_notify_guests: Optional[bool] = False  # Auto-notify when processing done


# ═══════════════════════════════════════════════════════════════════════════════
# Email Template Helper
# ═══════════════════════════════════════════════════════════════════════════════

def get_email_styles() -> str:
    """Get base CSS styles for email templates."""
    return """
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #09090b; }
        .container { max-width: 600px; margin: 0 auto; background: #18181b; border-radius: 16px; overflow: hidden; border: 1px solid #27272a; }
        .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 28px; }
        .content { padding: 30px; }
        .content h2 { color: #f4f4f5; font-size: 20px; margin-bottom: 15px; }
        .content p { color: #a1a1aa; font-size: 14px; line-height: 1.6; margin-bottom: 15px; }
        .stats { display: flex; justify-content: center; gap: 30px; margin: 25px 0; }
        .stat-box { background: #09090b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; text-align: center; min-width: 100px; }
        .stat-number { font-size: 28px; font-weight: bold; color: #3b82f6; }
        .stat-label { font-size: 12px; color: #71717a; margin-top: 5px; }
        .button { display: inline-block; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 20px 0; }
        .footer { padding: 25px; text-align: center; color: #71717a; font-size: 12px; border-top: 1px solid #27272a; }
        .highlight { color: #3b82f6; font-weight: 600; }
    """


def render_email_template(title: str, subtitle: str, content: str, button_text: str = None, button_url: str = None) -> str:
    """Render a base email template with common structure."""
    button_html = ""
    if button_text and button_url:
        button_html = f'<a href="{button_url}" class="button">{button_text}</a>'
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{title}</title>
        <style>{get_email_styles()}</style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>📸 SnapMatch</h1>
                <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0 0; font-size: 14px;">{subtitle}</p>
            </div>
            <div class="content">
                {content}
                {button_html}
            </div>
            <div class="footer">
                <p>© {datetime.now().year} SnapMatch. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """


def send_photos_ready_email(
    to_email: str,
    event_name: str,
    photo_count: int,
    event_url: str,
    photographer_name: str = "the photographer",
    db: Session = None,
) -> bool:
    """
    Send a 'Your Photos Are Ready' email to a guest.
    
    This function is graceful - if email sending fails, it logs the error
    but doesn't raise an exception, ensuring the system continues smoothly.
    """
    try:
        from app.services.email_service import send_email
        
        subject = f"📸 Your {photo_count} photos from {event_name} are ready!"
        
        content = f"""
            <h2>Great news, your photos are ready! 🎉</h2>
            <p>
                <strong>{photographer_name}</strong> has uploaded photos from 
                <span class="highlight">{event_name}</span> and our AI has found 
                <span class="highlight">{photo_count} photos</span> that might feature you!
            </p>
            
            <div class="stats">
                <div class="stat-box">
                    <div class="stat-number">{photo_count}</div>
                    <div class="stat-label">Your Photos</div>
                </div>
            </div>
            
            <p style="color: #71717a; font-size: 13px;">
                Simply upload a selfie and our AI will instantly find all your photos from the event.
                No more scrolling through hundreds of images!
            </p>
        """
        
        html_content = render_email_template(
            title="Your Photos Are Ready",
            subtitle="AI-powered photo finding",
            content=content,
            button_text="Find My Photos →",
            button_url=event_url,
        )
        
        text_content = f"""
        Your Photos from {event_name} Are Ready!
        
        Great news! {photographer_name} has uploaded photos from {event_name} and our AI has found {photo_count} photos that might feature you!
        
        Find your photos: {event_url}
        
        © {datetime.now().year} SnapMatch
        """
        
        return send_email(to_email, subject, html_content, text_content, db)
        
    except Exception as e:
        logger.error(f"Failed to send photos ready email to {to_email}: {e}")
        return False


def send_bulk_photos_ready_emails(
    emails: List[str],
    event_name: str,
    photo_count: int,
    event_url: str,
    photographer_name: str,
    db: Session = None,
) -> dict:
    """
    Send photos ready emails to multiple guests.
    
    Returns results with success/failure counts. Gracefully handles failures.
    """
    results = {"sent": 0, "failed": 0, "errors": []}
    
    for email in emails:
        try:
            success = send_photos_ready_email(
                to_email=email,
                event_name=event_name,
                photo_count=photo_count,
                event_url=event_url,
                photographer_name=photographer_name,
                db=db,
            )
            if success:
                results["sent"] += 1
            else:
                results["failed"] += 1
        except Exception as e:
            results["failed"] += 1
            results["errors"].append(f"{email}: {str(e)}")
    
    logger.info(f"Bulk email sent: {results['sent']} success, {results['failed']} failed")
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# Guest CRUD Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{event_id}/guests")
def get_guests(
    event_id: int,
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
    filter_sent: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get paginated list of guests for an event.
    
    Returns empty list gracefully if no guests exist.
    """
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Build query - gracefully handles empty table
    query = db.query(Guest).filter(Guest.event_id == event_id)
    
    # Apply filters
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                Guest.name.ilike(search_term),
                Guest.email.ilike(search_term)
            )
        )
    
    if filter_sent is not None:
        query = query.filter(Guest.email_sent == filter_sent)
    
    # Get total count before pagination
    total = query.count()
    
    # Apply pagination
    page_size = min(max(page_size, 1), 200)
    page = max(page, 1)
    offset = (page - 1) * page_size
    
    guests = query.order_by(Guest.created_at.desc()).offset(offset).limit(page_size).all()
    
    # Calculate statistics - returns zeros if no guests
    stats = db.query(
        func.count(Guest.id).label('total'),
        func.sum(cast(Guest.email_sent, Integer)).label('sent'),
        func.sum(cast(Guest.email_opened, Integer)).label('opened'),
        func.sum(cast(Guest.visited_event, Integer)).label('visited'),
    ).filter(Guest.event_id == event_id).first()
    
    return {
        "event_id": event_id,
        "guests": [g.to_dict() for g in guests],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
        },
        "statistics": {
            "total_guests": stats.total or 0,
            "emails_sent": stats.sent or 0,
            "emails_opened": stats.opened or 0,
            "guests_visited": stats.visited or 0,
            "pending_notifications": (stats.total or 0) - (stats.sent or 0),
        }
    }


@router.post("/{event_id}/guests")
def create_guest(
    event_id: int,
    guest_data: GuestCreate,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new guest for an event."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Check for duplicate email in this event
    existing = db.query(Guest).filter(
        Guest.event_id == event_id,
        Guest.email == guest_data.email.lower()
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Guest with email {guest_data.email} already exists"
        )
    
    # Create guest
    guest = Guest(
        event_id=event_id,
        name=guest_data.name,
        email=guest_data.email.lower(),
        phone=guest_data.phone,
        notes=guest_data.notes,
        source="manual",
    )
    
    db.add(guest)
    db.commit()
    db.refresh(guest)
    
    # Log activity (optional - wrapped in try/except to not break if logging fails)
    try:
        if request:
            log_activity(
                db=db,
                activity_type="guest_create",
                action="guest_created",
                user_id=current_user.id,
                event_id=event_id,
                description=f"Added guest: {guest.email}",
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent") if request else None,
                request_path=f"/events/{event_id}/guests",
                request_method="POST",
            )
    except Exception as e:
        logger.warning(f"Failed to log activity: {e}")
    
    return {"success": True, "guest": guest.to_dict()}


@router.post("/{event_id}/guests/bulk")
def bulk_create_guests(
    event_id: int,
    guests_data: GuestBulkCreate,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk create guests for an event."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    created = []
    failed = []
    existing_emails = set(
        g.email.lower() for g in db.query(Guest.email).filter(
            Guest.event_id == event_id
        ).all()
    )
    
    for guest_data in guests_data.guests:
        email_lower = guest_data.email.lower()
        
        if email_lower in existing_emails:
            failed.append({"email": guest_data.email, "reason": "Email already exists"})
            continue
        
        guest = Guest(
            event_id=event_id,
            name=guest_data.name,
            email=email_lower,
            phone=guest_data.phone,
            notes=guest_data.notes,
            source="bulk_import",
        )
        db.add(guest)
        created.append(email_lower)
        existing_emails.add(email_lower)
    
    db.commit()
    
    return {
        "success": True,
        "created_count": len(created),
        "failed_count": len(failed),
        "created": created,
        "failed": failed,
    }


@router.put("/{event_id}/guests/{guest_id}")
def update_guest(
    event_id: int,
    guest_id: int,
    guest_data: GuestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a guest's information."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Find guest
    guest = db.query(Guest).filter(Guest.id == guest_id, Guest.event_id == event_id).first()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    
    # Check email uniqueness if email is being updated
    if guest_data.email and guest_data.email.lower() != guest.email:
        existing = db.query(Guest).filter(
            Guest.event_id == event_id,
            Guest.email == guest_data.email.lower(),
            Guest.id != guest_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Email {guest_data.email} already in use")
    
    # Update fields
    if guest_data.name is not None:
        guest.name = guest_data.name
    if guest_data.email is not None:
        guest.email = guest_data.email.lower()
    if guest_data.phone is not None:
        guest.phone = guest_data.phone
    if guest_data.notes is not None:
        guest.notes = guest_data.notes
    
    db.commit()
    db.refresh(guest)
    
    return {"success": True, "guest": guest.to_dict()}


@router.delete("/{event_id}/guests/{guest_id}")
def delete_guest(
    event_id: int,
    guest_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a guest from an event."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Find and delete guest
    guest = db.query(Guest).filter(Guest.id == guest_id, Guest.event_id == event_id).first()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    
    guest_email = guest.email
    db.delete(guest)
    db.commit()
    
    return {"success": True, "message": f"Guest {guest_email} deleted"}


@router.delete("/{event_id}/guests")
def delete_guests_bulk(
    event_id: int,
    guest_ids: List[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk delete guests from an event."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    deleted = db.query(Guest).filter(
        Guest.event_id == event_id,
        Guest.id.in_(guest_ids)
    ).delete(synchronize_session=False)
    
    db.commit()
    
    return {"success": True, "deleted_count": deleted}


# ═══════════════════════════════════════════════════════════════════════════════
# CSV Import/Export Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/{event_id}/guests/import-csv")
async def import_guests_csv(
    event_id: int,
    file: UploadFile = File(...),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Import guests from CSV file.
    
    Expected CSV format:
    - Headers: name, email, phone, notes
    - Email is required, other fields optional
    """
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Validate file type
    if not file.filename or not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")
    
    # Read and parse CSV
    content = await file.read()
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        try:
            text = content.decode('latin-1')
        except:
            raise HTTPException(status_code=400, detail="Could not decode file")
    
    reader = csv.DictReader(io.StringIO(text))
    
    # Get existing emails
    existing_emails = set(
        g.email.lower() for g in db.query(Guest.email).filter(
            Guest.event_id == event_id
        ).all()
    )
    
    created = []
    failed = []
    line_num = 1
    
    for row in reader:
        line_num += 1
        
        # Get email (required) - check multiple possible column names
        email = (row.get('email', '') or row.get('Email', '') or row.get('EMAIL', '')).strip()
        if not email:
            failed.append({"line": line_num, "reason": "Missing email"})
            continue
        
        email_lower = email.lower()
        
        # Check for duplicate
        if email_lower in existing_emails:
            failed.append({"line": line_num, "email": email, "reason": "Email already exists"})
            continue
        
        # Get other fields
        name = (row.get('name', '') or row.get('Name', '') or row.get('NAME', '')).strip() or None
        phone = (row.get('phone', '') or row.get('Phone', '') or row.get('PHONE', '')).strip() or None
        notes = (row.get('notes', '') or row.get('Notes', '') or row.get('NOTES', '')).strip() or None
        
        # Create guest
        guest = Guest(
            event_id=event_id,
            name=name,
            email=email_lower,
            phone=phone,
            notes=notes,
            source="csv_import",
        )
        db.add(guest)
        created.append(email_lower)
        existing_emails.add(email_lower)
    
    db.commit()
    
    return {
        "success": True,
        "imported_count": len(created),
        "failed_count": len(failed),
        "imported": created[:10],  # Return first 10 for preview
        "failed": failed[:10],
    }


@router.get("/{event_id}/guests/export-csv")
def export_guests_csv(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export guests to CSV file."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get all guests (may be empty)
    guests = db.query(Guest).filter(Guest.event_id == event_id).order_by(Guest.created_at.desc()).all()
    
    # Generate CSV
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write header
    writer.writerow(['name', 'email', 'phone', 'notes', 'email_sent', 'email_opened', 'visited_event', 'created_at'])
    
    # Write rows
    for g in guests:
        writer.writerow([
            g.name or '',
            g.email,
            g.phone or '',
            g.notes or '',
            'yes' if g.email_sent else 'no',
            'yes' if g.email_opened else 'no',
            'yes' if g.visited_event else 'no',
            g.created_at.isoformat() if g.created_at else '',
        ])
    
    output.seek(0)
    
    # Return as streaming response
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8')),
        media_type='text/csv',
        headers={'Content-Disposition': f'attachment; filename="{event.name}_guests.csv"'}
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Notification Endpoints - CORE INTEGRATION
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/{event_id}/guests/send-notifications")
def send_notifications(
    event_id: int,
    data: SendNotificationsRequest,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send 'Photos Ready' notification emails to guests.
    
    GRACEFUL: If no guests exist, returns success with 0 sent.
    Does NOT throw errors or break the system.
    """
    try:
        # Verify ownership
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found")
        if event.owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")
        
        # Get guests to notify - gracefully handles empty list
        if data.guest_ids:
            guests = db.query(Guest).filter(
                Guest.event_id == event_id,
                Guest.id.in_(data.guest_ids)
            ).all()
        else:
            # Send to all guests who haven't received notification
            guests = db.query(Guest).filter(
                Guest.event_id == event_id,
                Guest.email_sent == False
            ).all()
        
        # GRACEFUL: No guests to notify is perfectly fine
        if not guests:
            return {
                "success": True,
                "sent_count": 0,
                "failed_count": 0,
                "message": "No guests to notify"
            }
        
        # Build event URL
        event_url = data.event_url
        if not event_url:
            # Try to construct from request
            if request:
                base_url = str(request.base_url).rstrip('/')
                event_url = f"{base_url}/public/{event.public_token}"
            else:
                event_url = f"https://snapmatch.com/public/{event.public_token}"
        
        # Get photographer name
        photographer_name = getattr(current_user, 'name', None) or current_user.email
        
        # Send emails
        emails = [g.email for g in guests]
        photo_count = data.photo_count or event.image_count or 0
        
        results = send_bulk_photos_ready_emails(
            emails=emails,
            event_name=event.name,
            photo_count=photo_count,
            event_url=event_url,
            photographer_name=photographer_name,
            db=db,
        )
        
        # Update guest records for successful sends
        for guest in guests:
            if results['sent'] > 0:
                guest.mark_email_sent()
        
        # Update event notification tracking
        if results['sent'] > 0:
            event.record_notification_sent()
        
        db.commit()
        
        return {
            "success": True,
            "sent_count": results['sent'],
            "failed_count": results['failed'],
            "errors": results.get('errors', [])[:5],
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending notifications: {e}")
        # Return graceful error instead of crashing
        return {
            "success": False,
            "sent_count": 0,
            "failed_count": 0,
            "message": f"Failed to send notifications: {str(e)}",
            "error": str(e)
        }


@router.post("/{event_id}/guests/resend/{guest_id}")
def resend_notification(
    event_id: int,
    guest_id: int,
    event_url: str = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resend notification to a specific guest."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Find guest
    guest = db.query(Guest).filter(Guest.id == guest_id, Guest.event_id == event_id).first()
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    
    # Build event URL
    if not event_url and request:
        base_url = str(request.base_url).rstrip('/')
        event_url = f"{base_url}/public/{event.public_token}"
    elif not event_url:
        event_url = f"https://snapmatch.com/public/{event.public_token}"
    
    # Get photographer name
    photographer_name = getattr(current_user, 'name', None) or current_user.email
    
    # Send email
    success = send_photos_ready_email(
        to_email=guest.email,
        event_name=event.name,
        photo_count=event.image_count or 0,
        event_url=event_url,
        photographer_name=photographer_name,
        db=db,
    )
    
    if success:
        guest.mark_email_sent()
        db.commit()
        return {"success": True, "message": f"Notification sent to {guest.email}"}
    else:
        return {"success": False, "message": f"Failed to send notification to {guest.email}"}


@router.post("/{event_id}/notify-processing-complete")
def notify_guests_processing_complete(
    event_id: int,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Automatically notify guests when processing is complete.
    
    Called after face processing finishes. GRACEFUL: Only sends if:
    1. Event has guests configured
    2. Event has auto_notify_guests enabled (or notify_on_processing_complete)
    3. Guests haven't been notified yet
    
    If any condition fails, returns success without errors.
    """
    # Get event
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        return {"success": True, "sent_count": 0, "message": "Event not found (no action needed)"}
    
    # Check if owner matches (or skip this check for system calls)
    if current_user and event.owner_id != current_user.id:
        return {"success": True, "sent_count": 0, "message": "Not authorized (no action needed)"}
    
    # GRACEFUL: Check if notifications are enabled
    if not getattr(event, 'notify_on_processing_complete', True):
        return {"success": True, "sent_count": 0, "message": "Processing notifications disabled"}
    
    # GRACEFUL: Check if there are any guests
    guests_to_notify = db.query(Guest).filter(
        Guest.event_id == event_id,
        Guest.email_sent == False
    ).all()
    
    if not guests_to_notify:
        return {"success": True, "sent_count": 0, "message": "No guests to notify"}
    
    # Build event URL
    event_url = None
    if request:
        base_url = str(request.base_url).rstrip('/')
        event_url = f"{base_url}/public/{event.public_token}"
    else:
        event_url = f"https://snapmatch.com/public/{event.public_token}"
    
    # Get owner info
    owner = db.query(User).filter(User.id == event.owner_id).first()
    photographer_name = getattr(owner, 'name', None) or (owner.email if owner else "the photographer")
    
    # Send notifications
    emails = [g.email for g in guests_to_notify]
    
    results = send_bulk_photos_ready_emails(
        emails=emails,
        event_name=event.name,
        photo_count=event.image_count or 0,
        event_url=event_url,
        photographer_name=photographer_name,
        db=db,
    )
    
    # Update guest records
    for guest in guests_to_notify:
        if results['sent'] > 0:
            guest.mark_email_sent()
    
    if results['sent'] > 0:
        event.record_notification_sent()
    
    db.commit()
    
    return {
        "success": True,
        "sent_count": results['sent'],
        "failed_count": results['failed'],
        "message": f"Notified {results['sent']} guests"
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Statistics & Guest Count Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{event_id}/guests/statistics")
def get_guest_statistics(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get detailed statistics about guest engagement."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get statistics - returns zeros if no guests
    stats = db.query(
        func.count(Guest.id).label('total'),
        func.sum(cast(Guest.email_sent, Integer)).label('sent'),
        func.sum(cast(Guest.email_opened, Integer)).label('opened'),
        func.sum(cast(Guest.visited_event, Integer)).label('visited'),
        func.sum(cast(Guest.downloaded_photos, Integer)).label('downloaded'),
    ).filter(Guest.event_id == event_id).first()
    
    # Calculate rates (handle division by zero)
    total = stats.total or 0
    sent = stats.sent or 0
    opened = stats.opened or 0
    visited = stats.visited or 0
    downloaded = stats.downloaded or 0
    
    return {
        "event_id": event_id,
        "event_name": event.name,
        "statistics": {
            "total_guests": total,
            "emails_sent": sent,
            "emails_opened": opened,
            "guests_visited": visited,
            "photos_downloaded": downloaded,
            "pending_notifications": total - sent,
        },
        "rates": {
            "notification_rate": round((sent / total * 100), 1) if total > 0 else 0,
            "open_rate": round((opened / sent * 100), 1) if sent > 0 else 0,
            "visit_rate": round((visited / sent * 100), 1) if sent > 0 else 0,
            "download_rate": round((downloaded / visited * 100), 1) if visited > 0 else 0,
        }
    }


@router.get("/{event_id}/guests/count")
def get_guest_count(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get simple guest count - used by event detail endpoint."""
    # Verify ownership
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    total = db.query(func.count(Guest.id)).filter(Guest.event_id == event_id).scalar() or 0
    pending = db.query(func.count(Guest.id)).filter(
        Guest.event_id == event_id,
        Guest.email_sent == False
    ).scalar() or 0
    
    return {
        "total_guests": total,
        "pending_notifications": pending,
        "has_guests": total > 0,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Notification Preferences Endpoint
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{event_id}/notification-settings")
def get_notification_settings(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get notification settings for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    return {
        "event_id": event_id,
        "settings": event.get_notification_config() if hasattr(event, 'get_notification_config') else {
            "notify_on_guest_upload": True,
            "notify_on_expiry_warning": True,
            "expiry_warning_days": 7,
            "notify_on_processing_complete": True,
        }
    }


@router.put("/{event_id}/notification-settings")
def update_notification_settings(
    event_id: int,
    settings: NotificationPreferences,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update notification settings for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Update settings if method exists
    if hasattr(event, 'set_notification_config'):
        event.set_notification_config(settings.dict())
    else:
        # Direct attribute update as fallback
        if hasattr(event, 'notify_on_guest_upload'):
            event.notify_on_guest_upload = settings.notify_on_guest_upload
        if hasattr(event, 'notify_on_expiry_warning'):
            event.notify_on_expiry_warning = settings.notify_on_expiry_warning
        if hasattr(event, 'expiry_warning_days'):
            event.expiry_warning_days = settings.expiry_warning_days
        if hasattr(event, 'notify_on_processing_complete'):
            event.notify_on_processing_complete = settings.notify_on_processing_complete
    
    db.commit()
    
    return {"success": True, "message": "Notification settings updated"}