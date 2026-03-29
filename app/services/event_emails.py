"""
Event Email Notification Service

Email templates and triggers for event-related notifications:
1. Photos Ready - Notify guests when their photos are ready
2. Guest Upload - Notify photographer when guests upload photos
3. Event Expiry Warning - Notify photographer before event expires
4. Welcome Email - New user/photographer welcome

Usage:
    from app.services.event_emails import (
        send_photos_ready_email,
        send_guest_upload_notification,
        send_event_expiry_warning,
    )
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session

from app.services.email_service import send_email, EmailConfig, get_email_config
from app.models.event import Event
from app.models.user import User
from app.models.photo import Photo

logger = logging.getLogger(__name__)


# =============================================================================
# Email Templates
# =============================================================================

def get_base_styles() -> str:
    """Get base CSS styles for email templates."""
    return """
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #09090b; }
        .container { max-width: 600px; margin: 0 auto; background: #18181b; border-radius: 16px; overflow: hidden; border: 1px solid #27272a; }
        .header { background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 28px; }
        .logo { width: 60px; height: 60px; margin-bottom: 10px; }
        .content { padding: 30px; }
        .content h2 { color: #f4f4f5; font-size: 20px; margin-bottom: 15px; }
        .content p { color: #a1a1aa; font-size: 14px; line-height: 1.6; margin-bottom: 15px; }
        .stats { display: flex; justify-content: center; gap: 30px; margin: 25px 0; }
        .stat-box { background: #09090b; border: 1px solid #27272a; border-radius: 12px; padding: 20px; text-align: center; min-width: 100px; }
        .stat-number { font-size: 28px; font-weight: bold; color: #3b82f6; }
        .stat-label { font-size: 12px; color: #71717a; margin-top: 5px; }
        .button { display: inline-block; background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 20px 0; }
        .button:hover { opacity: 0.9; }
        .footer { padding: 25px; text-align: center; color: #71717a; font-size: 12px; border-top: 1px solid #27272a; }
        .footer a { color: #3b82f6; text-decoration: none; }
        .divider { border-top: 1px solid #27272a; margin: 25px 0; }
        .highlight { color: #3b82f6; font-weight: 600; }
        .warning { background: #f59e0b15; border: 1px solid #f59e0b30; border-radius: 8px; padding: 15px; margin: 20px 0; }
        .warning-text { color: #f59e0b; font-size: 13px; margin: 0; }
        .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 20px 0; }
        .photo-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; }
    """


def render_email_template(
    title: str,
    subtitle: str,
    content: str,
    button_text: str = None,
    button_url: str = None,
    footer_text: str = None,
    event_name: str = None,
    photographer_name: str = None,
) -> str:
    """Render a base email template with common structure."""
    
    button_html = ""
    if button_text and button_url:
        button_html = f'<a href="{button_url}" class="button">{button_text}</a>'
    
    event_info = ""
    if event_name:
        event_info = f'<p style="color: #71717a; font-size: 12px; margin-top: 20px;">Event: <strong style="color: #a1a1aa;">{event_name}</strong></p>'
    
    footer_html = footer_text or f"""
        <p>© {datetime.now().year} SnapMatch. All rights reserved.</p>
        <p style="margin-top: 10px;">
            <a href="https://snapmatch.com">SnapMatch</a> · 
            <a href="https://snapmatch.com/help">Help</a> · 
            <a href="https://snapmatch.com/unsubscribe">Unsubscribe</a>
        </p>
    """
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{title}</title>
        <style>{get_base_styles()}</style>
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
                {event_info}
            </div>
            <div class="footer">
                {footer_html}
            </div>
        </div>
    </body>
    </html>
    """


# =============================================================================
# Photos Ready Email
# =============================================================================

def send_photos_ready_email(
    to_email: str,
    event_name: str,
    event_token: str,
    photo_count: int,
    event_url: str,
    photographer_name: str = "the photographer",
    db: Session = None,
) -> bool:
    """
    Send a 'Your Photos Are Ready' email to a guest.
    
    This is typically triggered when:
    - Photographer manually triggers notification
    - Or after processing completes for a batch
    
    Args:
        to_email: Guest's email address
        event_name: Name of the event
        event_token: Public token for the event
        photo_count: Number of photos found
        event_url: Full URL to the event page
        photographer_name: Name of the photographer/organizer
        db: Database session for email config
    
    Returns:
        bool: True if email sent successfully
    """
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
        
        <div class="divider"></div>
        
        <p style="color: #71717a; font-size: 13px;">
            <strong>How it works:</strong><br>
            1. Click the button below to visit the event page<br>
            2. Upload or take a selfie<br>
            3. AI finds all your photos instantly<br>
            4. Download your favorites or all at once!
        </p>
    """
    
    html_content = render_email_template(
        title="Your Photos Are Ready",
        subtitle="AI-powered photo finding",
        content=content,
        button_text="Find My Photos →",
        button_url=event_url,
        event_name=event_name,
    )
    
    text_content = f"""
    Your Photos from {event_name} Are Ready!
    
    Great news! {photographer_name} has uploaded photos from {event_name} and our AI has found {photo_count} photos that might feature you!
    
    Find your photos: {event_url}
    
    How it works:
    1. Visit the event page
    2. Upload a selfie
    3. AI finds your photos instantly
    4. Download your favorites!
    
    © {datetime.now().year} SnapMatch
    """
    
    try:
        return send_email(to_email, subject, html_content, text_content, db)
    except Exception as e:
        logger.error(f"Failed to send photos ready email to {to_email}: {e}")
        return False


# =============================================================================
# Guest Upload Notification
# =============================================================================

def send_guest_upload_notification(
    photographer_email: str,
    photographer_name: str,
    event_name: str,
    event_id: int,
    guest_name: str,
    photo_count: int,
    pending_count: int,
    event_url: str,
    db: Session = None,
) -> bool:
    """
    Notify photographer when a guest uploads photos.
    
    Args:
        photographer_email: Photographer's email
        photographer_name: Photographer's name
        event_name: Name of the event
        event_id: Event ID for moderation link
        guest_name: Name of the guest who uploaded
        photo_count: Number of photos uploaded
        pending_count: Total pending moderation count
        event_url: URL to event management page
        db: Database session
    
    Returns:
        bool: True if sent successfully
    """
    subject = f"📥 {photo_count} new photos uploaded by {guest_name or 'a guest'}"
    
    guest_display = guest_name if guest_name else "A guest"
    moderation_text = ""
    if pending_count > 0:
        moderation_text = f"""
        <div class="warning">
            <p class="warning-text">⚠️ You have <strong>{pending_count} photo(s)</strong> pending moderation. 
            Review and approve them to make them visible to guests.</p>
        </div>
        """
    
    content = f"""
        <h2>New Guest Upload! 📥</h2>
        <p>
            <strong>{guest_display}</strong> has uploaded <span class="highlight">{photo_count} photo(s)</span> 
            to your event <span class="highlight">{event_name}</span>.
        </p>
        
        {moderation_text}
        
        <div class="stats">
            <div class="stat-box">
                <div class="stat-number">{photo_count}</div>
                <div class="stat-label">New Photos</div>
            </div>
            <div class="stat-box">
                <div class="stat-number">{pending_count}</div>
                <div class="stat-label">Pending Review</div>
            </div>
        </div>
        
        <p style="color: #71717a; font-size: 13px;">
            Guest uploads require your approval before they appear in the public gallery.
            Visit your event dashboard to review and moderate.
        </p>
    """
    
    html_content = render_email_template(
        title="New Guest Upload",
        subtitle=f"{event_name}",
        content=content,
        button_text="Review Photos →",
        button_url=event_url,
        event_name=event_name,
    )
    
    text_content = f"""
    New Guest Upload for {event_name}
    
    {guest_display} has uploaded {photo_count} photo(s) to your event.
    
    Pending moderation: {pending_count} photo(s)
    
    Review and approve: {event_url}
    
    © {datetime.now().year} SnapMatch
    """
    
    try:
        return send_email(photographer_email, subject, html_content, text_content, db)
    except Exception as e:
        logger.error(f"Failed to send guest upload notification to {photographer_email}: {e}")
        return False


# =============================================================================
# Event Expiry Warning
# =============================================================================

def send_event_expiry_warning(
    photographer_email: str,
    photographer_name: str,
    event_name: str,
    event_token: str,
    days_remaining: int,
    event_url: str,
    extend_url: str,
    db: Session = None,
) -> bool:
    """
    Warn photographer about upcoming event expiry.
    
    Args:
        photographer_email: Photographer's email
        photographer_name: Photographer's name
        event_name: Name of the event
        event_token: Event token
        days_remaining: Days until expiry
        event_url: URL to event page
        extend_url: URL to extend event
        db: Database session
    
    Returns:
        bool: True if sent successfully
    """
    urgency = "⚠️" if days_remaining <= 3 else "📅"
    subject = f"{urgency} Your event '{event_name}' expires in {days_remaining} days"
    
    if days_remaining <= 1:
        warning_html = """
        <div class="warning" style="background: #ef444415; border-color: #ef444430;">
            <p class="warning-text" style="color: #ef4444;">🚨 Your event is expiring very soon! 
            Take action now to prevent your guests from losing access.</p>
        </div>
        """
    else:
        warning_html = f"""
        <div class="warning">
            <p class="warning-text">⚠️ Your event will expire in <strong>{days_remaining} days</strong>. 
            After expiry, guests won't be able to access their photos.</p>
        </div>
        """
    
    content = f"""
        <h2>Event Expiry Reminder</h2>
        <p>
            Hi <strong>{photographer_name}</strong>,
        </p>
        <p>
            Your event <span class="highlight">{event_name}</span> will expire in 
            <span class="highlight">{days_remaining} day(s)</span>.
        </p>
        
        {warning_html}
        
        <p style="color: #71717a; font-size: 13px;">
            <strong>What happens when an event expires?</strong><br>
            • Guests can no longer access the event page<br>
            • Photos remain in your account for 30 days<br>
            • You can extend the event anytime before expiry
        </p>
        
        <div class="divider"></div>
        
        <p style="color: #71717a; font-size: 13px;">
            Don't let your guests miss out on their memories. Extend your event or 
            remind them to download their photos before it's too late!
        </p>
    """
    
    html_content = render_email_template(
        title="Event Expiring Soon",
        subtitle="Action required",
        content=content,
        button_text="Extend Event →",
        button_url=extend_url,
        event_name=event_name,
    )
    
    text_content = f"""
    Your Event '{event_name}' Expires in {days_remaining} Days
    
    Hi {photographer_name},
    
    Your event will expire in {days_remaining} day(s). After expiry, guests won't be able to access their photos.
    
    Extend your event: {extend_url}
    View event: {event_url}
    
    © {datetime.now().year} SnapMatch
    """
    
    try:
        return send_email(photographer_email, subject, html_content, text_content, db)
    except Exception as e:
        logger.error(f"Failed to send expiry warning to {photographer_email}: {e}")
        return False


# =============================================================================
# Welcome Email for New Photographers
# =============================================================================

def send_welcome_email(
    to_email: str,
    user_name: str,
    dashboard_url: str,
    db: Session = None,
) -> bool:
    """
    Send welcome email to new photographer/organizer.
    
    Args:
        to_email: User's email
        user_name: User's name
        dashboard_url: URL to dashboard
        db: Database session
    
    Returns:
        bool: True if sent successfully
    """
    subject = "📸 Welcome to SnapMatch - Let's Get Started!"
    
    content = f"""
        <h2>Welcome to SnapMatch! 🎉</h2>
        <p>
            Hi <strong>{user_name}</strong>,
        </p>
        <p>
            Welcome to SnapMatch, the AI-powered photo delivery platform that helps you 
            deliver photos to your clients and guests effortlessly.
        </p>
        
        <div class="stats">
            <div class="stat-box">
                <div class="stat-number">🤖</div>
                <div class="stat-label">AI Face Recognition</div>
            </div>
            <div class="stat-box">
                <div class="stat-number">⚡</div>
                <div class="stat-label">Instant Delivery</div>
            </div>
            <div class="stat-box">
                <div class="stat-number">🎨</div>
                <div class="stat-label">Custom Branding</div>
            </div>
        </div>
        
        <h3 style="color: #f4f4f5; font-size: 16px;">Quick Start Guide:</h3>
        <p style="color: #a1a1aa; font-size: 13px;">
            <strong>1. Create an Event</strong><br>
            Set up your event with a name, date, and upload your photos.<br><br>
            
            <strong>2. Customize Branding</strong><br>
            Add your logo, colors, and customize the guest experience.<br><br>
            
            <strong>3. Share with Guests</strong><br>
            Get a unique link to share with your guests - they just upload a selfie!<br><br>
            
            <strong>4. AI Does the Magic</strong><br>
            Our AI finds all photos featuring each guest automatically.
        </p>
        
        <div class="divider"></div>
        
        <p style="color: #71717a; font-size: 13px;">
            Questions? Check out our <a href="https://snapmatch.com/help" style="color: #3b82f6;">Help Center</a> 
            or reply to this email.
        </p>
    """
    
    html_content = render_email_template(
        title="Welcome to SnapMatch",
        subtitle="AI-powered photo delivery",
        content=content,
        button_text="Create Your First Event →",
        button_url=dashboard_url,
    )
    
    text_content = f"""
    Welcome to SnapMatch!
    
    Hi {user_name},
    
    Welcome to SnapMatch, the AI-powered photo delivery platform.
    
    Quick Start:
    1. Create an Event
    2. Customize Branding
    3. Share with Guests
    4. AI finds their photos automatically!
    
    Get started: {dashboard_url}
    
    © {datetime.now().year} SnapMatch
    """
    
    try:
        return send_email(to_email, subject, html_content, text_content, db)
    except Exception as e:
        logger.error(f"Failed to send welcome email to {to_email}: {e}")
        return False


# =============================================================================
# Batch Email Operations
# =============================================================================

def send_bulk_photos_ready_emails(
    emails: List[str],
    event_name: str,
    event_token: str,
    photo_count: int,
    event_url: str,
    photographer_name: str,
    db: Session = None,
) -> dict:
    """
    Send photos ready emails to multiple guests.
    
    Args:
        emails: List of email addresses
        event_name: Name of the event
        event_token: Event token
        photo_count: Number of photos
        event_url: Event URL
        photographer_name: Photographer name
        db: Database session
    
    Returns:
        dict: Results with success and failure counts
    """
    results = {"sent": 0, "failed": 0, "errors": []}
    
    for email in emails:
        try:
            success = send_photos_ready_email(
                to_email=email,
                event_name=event_name,
                event_token=event_token,
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


# =============================================================================
# Scheduled Task Helpers
# =============================================================================

def check_and_send_expiry_warnings(db: Session, days_threshold: int = 7) -> dict:
    """
    Check all events and send expiry warnings.
    Should be run as a scheduled task (e.g., daily).
    
    Args:
        db: Database session
        days_threshold: Send warning if expiry is within this many days
    
    Returns:
        dict: Statistics about emails sent
    """
    from datetime import date
    
    results = {"checked": 0, "warnings_sent": 0, "errors": []}
    
    # Find events expiring within threshold
    now = datetime.utcnow()
    expiry_threshold = now + timedelta(days=days_threshold)
    
    events = db.query(Event).filter(
        Event.expires_at.isnot(None),
        Event.expires_at > now,
        Event.expires_at <= expiry_threshold,
        Event.public_status == "active",
    ).all()
    
    for event in events:
        results["checked"] += 1
        
        # Get owner
        owner = db.query(User).filter(User.id == event.owner_id).first()
        if not owner or not owner.email:
            continue
        
        days_remaining = (event.expires_at - now).days
        
        # Check if we already sent a warning recently (avoid spamming)
        # For now, we send once per day at most
        # TODO: Add last_expiry_warning_at tracking
        
        try:
            success = send_event_expiry_warning(
                photographer_email=owner.email,
                photographer_name=getattr(owner, 'name', None) or owner.email,
                event_name=event.name,
                event_token=event.public_token,
                days_remaining=max(1, days_remaining),
                event_url=f"https://snapmatch.com/public/{event.public_token}",
                extend_url=f"https://snapmatch.com/events/{event.id}",
                db=db,
            )
            if success:
                results["warnings_sent"] += 1
        except Exception as e:
            results["errors"].append(f"Event {event.id}: {str(e)}")
    
    logger.info(f"Expiry check complete: {results}")
    return results