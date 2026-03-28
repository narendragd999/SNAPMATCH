"""
Admin Email Provider Configuration Routes

Allows admin to:
- View all email provider configurations
- Configure multiple providers with priority (for fallback)
- Set daily limits and track usage
- Test provider connections
- Send test emails

Fallback Flow:
1. Primary provider (priority 1) is tried first
2. If it fails or hits daily limit, fallback to priority 2
3. Continue until all providers exhausted
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime, date

from app.database.db import get_db
from app.models.email_provider_config import EmailProviderConfig
from app.core.dependencies import get_current_admin_user
from app.services.email_service import (
    test_email_provider,
    send_email,
    get_provider_comparison,
    EmailConfig
)
from app.api.analytics_routes import log_activity
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/email", tags=["admin-email"])


# =============================================================================
# Schemas
# =============================================================================

class EmailProviderUpdate(BaseModel):
    provider: str
    from_name: Optional[str] = "SnapMatch"
    reply_to: Optional[str] = None
    priority: Optional[int] = 1
    fallback_enabled: Optional[bool] = True
    daily_limit: Optional[int] = None
    
    # SMTP
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_use_tls: Optional[bool] = True
    
    # SendGrid
    sendgrid_api_key: Optional[str] = None
    sendgrid_from: Optional[str] = None
    
    # Brevo
    brevo_api_key: Optional[str] = None
    brevo_from: Optional[str] = None
    
    # Resend
    resend_api_key: Optional[str] = None
    resend_from: Optional[str] = None
    
    # SES
    ses_access_key: Optional[str] = None
    ses_secret_key: Optional[str] = None
    ses_region: Optional[str] = "us-east-1"
    ses_from: Optional[str] = None
    
    # Mailgun
    mailgun_api_key: Optional[str] = None
    mailgun_domain: Optional[str] = None
    mailgun_from: Optional[str] = None


class ProviderStatus(BaseModel):
    id: int
    provider: str
    priority: int
    fallback_enabled: bool
    is_configured: bool
    is_rate_limited: bool
    daily_sent_count: int
    daily_limit: Optional[int]
    remaining_today: Optional[int]
    last_test_status: Optional[str]


class TestEmailRequest(BaseModel):
    to_email: EmailStr


class PriorityUpdate(BaseModel):
    priority: int


# =============================================================================
# Default Daily Limits
# =============================================================================
PROVIDER_DAILY_LIMITS = {
    "smtp": 500,       # Gmail free: 500/day
    "sendgrid": 100,   # Free tier: 100/day
    "brevo": 300,      # Free tier: 300/day
    "resend": 100,     # Free tier: 3000/month ≈ 100/day
    "ses": 1000,       # Sandbox: 200/day, Production: much higher
    "mailgun": 5000    # Free tier first 3 months
}


# =============================================================================
# Routes
# =============================================================================

@router.get("/providers")
def get_available_providers():
    """Get list of available email providers with comparison and default limits."""
    comparison = get_provider_comparison()
    # Add default limits to the response
    for provider_key in comparison.get("providers", {}):
        comparison["providers"][provider_key]["default_daily_limit"] = PROVIDER_DAILY_LIMITS.get(provider_key)
    return comparison


@router.get("/providers/all")
def get_all_configured_providers(
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Get all configured email providers with their status and usage."""
    configs = db.query(EmailProviderConfig).order_by(
        EmailProviderConfig.priority.asc()
    ).all()
    
    result = []
    for config in configs:
        # Reset counter if new day
        if config.last_sent_date and config.last_sent_date.date() < date.today():
            config.daily_sent_count = 0
        
        remaining = None
        if config.daily_limit:
            remaining = max(0, config.daily_limit - (config.daily_sent_count or 0))
        
        result.append({
            "id": config.id,
            "provider": config.provider,
            "priority": config.priority or 1,
            "fallback_enabled": config.fallback_enabled,
            "is_active": config.is_active,
            "is_configured": config.is_configured,
            "is_rate_limited": config.is_rate_limited() if hasattr(config, 'is_rate_limited') else False,
            "daily_sent_count": config.daily_sent_count or 0,
            "daily_limit": config.daily_limit,
            "remaining_today": remaining,
            "from_email": _get_from_email(config),
            "last_test_at": config.last_test_at.isoformat() if config.last_test_at else None,
            "last_test_status": config.last_test_status,
            "updated_at": config.updated_at.isoformat() if config.updated_at else None
        })
    
    return {"providers": result}


@router.get("/status")
def get_email_system_status(
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Get overall email system status including total capacity."""
    configs = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.is_active == True,
        EmailProviderConfig.is_configured == True
    ).all()
    
    total_capacity = 0
    total_remaining = 0
    primary_provider = None
    
    for config in configs:
        if config.daily_limit:
            total_capacity += config.daily_limit
            remaining = max(0, config.daily_limit - (config.daily_sent_count or 0))
            total_remaining += remaining
        
        if config.priority == 1:
            primary_provider = config.provider
    
    return {
        "total_providers": len(configs),
        "primary_provider": primary_provider,
        "total_daily_capacity": total_capacity,
        "total_remaining_today": total_remaining,
        "providers": [
            {
                "provider": c.provider,
                "priority": c.priority,
                "remaining": max(0, c.daily_limit - (c.daily_sent_count or 0)) if c.daily_limit else None
            }
            for c in configs
        ]
    }


@router.post("/providers")
def add_provider_config(
    data: EmailProviderUpdate,
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Add a new email provider configuration."""
    valid_providers = ["smtp", "sendgrid", "brevo", "resend", "ses", "mailgun"]
    if data.provider not in valid_providers:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {data.provider}")
    
    # Check if this provider type already exists
    existing = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.provider == data.provider
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Provider '{data.provider}' already configured. Use PUT to update."
        )
    
    # Create new config
    config = EmailProviderConfig(
        provider=data.provider,
        priority=data.priority or 1,
        fallback_enabled=data.fallback_enabled if data.fallback_enabled is not None else True,
        daily_limit=data.daily_limit or PROVIDER_DAILY_LIMITS.get(data.provider),
        from_name=data.from_name or "SnapMatch",
        reply_to=data.reply_to,
        is_active=True
    )
    
    # Set provider-specific fields
    _update_provider_fields(config, data)
    
    # Check if configured
    email_config = EmailConfig(config)
    config.is_configured = email_config.is_configured
    
    db.add(config)
    db.commit()
    db.refresh(config)
    
    log_activity(
        db=db, activity_type="admin_config_change", action="email_provider_added",
        user_id=admin_user.id, description=f"Added email provider: {data.provider}",
        request_path="/admin/email/providers", request_method="POST"
    )
    
    return {
        "success": True,
        "message": f"Provider '{data.provider}' added successfully",
        "id": config.id,
        "is_configured": config.is_configured
    }


@router.put("/providers/{provider_id}")
def update_provider_config(
    provider_id: int,
    data: EmailProviderUpdate,
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Update an existing email provider configuration."""
    config = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.id == provider_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Provider configuration not found")
    
    # Update fields
    if data.priority is not None:
        config.priority = data.priority
    if data.fallback_enabled is not None:
        config.fallback_enabled = data.fallback_enabled
    if data.daily_limit is not None:
        config.daily_limit = data.daily_limit
    if data.from_name:
        config.from_name = data.from_name
    if data.reply_to is not None:
        config.reply_to = data.reply_to
    
    _update_provider_fields(config, data)
    
    # Check if configured
    email_config = EmailConfig(config)
    config.is_configured = email_config.is_configured
    config.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(config)
    
    log_activity(
        db=db, activity_type="admin_config_change", action="email_provider_updated",
        user_id=admin_user.id, description=f"Updated email provider: {config.provider}",
        request_path=f"/admin/email/providers/{provider_id}", request_method="PUT"
    )
    
    return {
        "success": True,
        "message": f"Provider '{config.provider}' updated",
        "is_configured": config.is_configured
    }


@router.put("/providers/{provider_id}/priority")
def update_provider_priority(
    provider_id: int,
    data: PriorityUpdate,
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Update provider priority (for fallback order)."""
    config = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.id == provider_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    old_priority = config.priority
    config.priority = data.priority
    config.updated_at = datetime.utcnow()
    db.commit()
    
    return {
        "success": True,
        "message": f"Priority updated from {old_priority} to {data.priority}",
        "provider": config.provider,
        "new_priority": data.priority
    }


@router.delete("/providers/{provider_id}")
def delete_provider_config(
    provider_id: int,
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Delete an email provider configuration."""
    config = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.id == provider_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    provider_name = config.provider
    db.delete(config)
    db.commit()
    
    log_activity(
        db=db, activity_type="admin_config_change", action="email_provider_deleted",
        user_id=admin_user.id, description=f"Deleted email provider: {provider_name}",
        request_path=f"/admin/email/providers/{provider_id}", request_method="DELETE"
    )
    
    return {"success": True, "message": f"Provider '{provider_name}' deleted"}


@router.post("/test/{provider_id}")
def test_provider_connection(
    provider_id: int,
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Test a specific email provider connection."""
    config = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.id == provider_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    email_config = EmailConfig(config)
    result = test_email_provider(email_config)
    
    # Update test status
    config.last_test_at = datetime.utcnow()
    config.last_test_status = "success" if result["success"] else "failed"
    config.last_test_error = None if result["success"] else result.get("message")
    db.commit()
    
    return result


@router.post("/test-send")
def send_test_email(
    data: TestEmailRequest,
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Send a test email using the configured providers (with fallback)."""
    configs = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.is_active == True,
        EmailProviderConfig.is_configured == True
    ).order_by(EmailProviderConfig.priority.asc()).first()
    
    if not configs:
        raise HTTPException(status_code=400, detail="No email providers configured")
    
    try:
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #3b82f6;">SnapMatch Email Test</h2>
            <p>This is a test email to verify your email provider configuration.</p>
            <p><strong>Primary Provider:</strong> {configs.provider}</p>
            <p><strong>Sent at:</strong> {datetime.utcnow().isoformat()}</p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <p style="color: #666; font-size: 12px;">
                If you received this email, your email configuration is working correctly!
            </p>
        </div>
        """

        send_email(
            to_email=data.to_email,
            subject="SnapMatch - Email Configuration Test",
            html_content=html_content,
            db=db
        )

        log_activity(
            db=db, activity_type="admin_config_change", action="test_email_sent",
            user_id=admin_user.id, description=f"Test email sent to {data.to_email}",
            request_path="/admin/email/test-send", request_method="POST"
        )

        return {
            "success": True,
            "message": f"Test email sent to {data.to_email}"
        }

    except Exception as e:
        logger.error(f"Failed to send test email: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send test email: {str(e)}")


@router.post("/reset-usage/{provider_id}")
def reset_provider_usage(
    provider_id: int,
    db: Session = Depends(get_db),
    admin_user = Depends(get_current_admin_user)
):
    """Reset daily usage counter for a provider."""
    config = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.id == provider_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Provider not found")
    
    config.daily_sent_count = 0
    config.last_sent_date = None
    db.commit()
    
    return {
        "success": True,
        "message": f"Usage reset for {config.provider}"
    }


@router.get("/setup-guide/{provider}")
def get_setup_guide(provider: str):
    """Get setup guide for a specific provider."""
    guides = {
        "smtp": {
            "provider": "SMTP",
            "description": "Use your existing email account (Gmail, Outlook, etc.)",
            "steps": [
                "1. Enable 2-Factor Authentication on your email account",
                "2. Generate an App Password (Google Account > Security > App passwords)",
                "3. Enter your SMTP details:",
                "   - Host: smtp.gmail.com (for Gmail)",
                "   - Port: 587",
                "   - User: your-email@gmail.com",
                "   - Password: your-app-password (not your regular password)",
                "   - From: your-email@gmail.com",
                "4. Click 'Test Connection' to verify",
                "5. Click 'Save' to apply changes"
            ],
            "limits": "500 emails/day (Gmail free), 2000/day (Google Workspace)",
            "daily_limit": 500,
            "tips": [
                "Use App Password, not your regular password",
                "Gmail requires TLS enabled",
                "Check spam folder if emails don't arrive"
            ]
        },
        "sendgrid": {
            "provider": "SendGrid",
            "description": "Industry standard for transactional emails",
            "steps": [
                "1. Create account at sendgrid.com",
                "2. Verify your sender domain (optional but recommended)",
                "3. Generate API key: Settings > API Keys > Create API Key",
                "4. Give 'Mail Send' permissions",
                "5. Copy the API key (starts with SG.)",
                "6. Enter in admin panel and save"
            ],
            "limits": "100 emails/day free",
            "daily_limit": 100,
            "tips": [
                "Verify your domain for better deliverability",
                "Set up SPF, DKIM, DMARC records",
                "Use templates for consistent branding"
            ]
        },
        "brevo": {
            "provider": "Brevo (Sendinblue)",
            "description": "Generous free tier - 300 emails/day forever",
            "steps": [
                "1. Create account at brevo.com",
                "2. Verify your email address",
                "3. Go to SMTP & API > API Keys",
                "4. Create new API key",
                "5. Copy the API key (starts with xkeysib-)",
                "6. Enter in admin panel and save"
            ],
            "limits": "300 emails/day free forever",
            "daily_limit": 300,
            "tips": [
                "Best value for startups",
                "Includes marketing features",
                "Supports SMS as well"
            ]
        },
        "resend": {
            "provider": "Resend",
            "description": "Modern, developer-friendly email service",
            "steps": [
                "1. Create account at resend.com",
                "2. Verify your domain (required)",
                "3. Go to API Keys > Create API Key",
                "4. Copy the API key (starts with re_)",
                "5. Enter in admin panel and save"
            ],
            "limits": "3,000 emails/month free",
            "daily_limit": 100,
            "tips": [
                "Best developer experience",
                "Great React Email integration",
                "Fast and reliable"
            ]
        },
        "ses": {
            "provider": "Amazon SES",
            "description": "Most cost-effective for high volume",
            "steps": [
                "1. Create AWS account",
                "2. Go to SES console",
                "3. Verify your domain",
                "4. Request production access (move out of sandbox)",
                "5. Create IAM user with SES permissions",
                "6. Get Access Key ID and Secret Access Key",
                "7. Enter in admin panel and save"
            ],
            "limits": "Unlimited (pay per use)",
            "daily_limit": 1000,
            "pricing": "$0.10 per 1,000 emails",
            "tips": [
                "Start in sandbox mode for testing",
                "Request production access before going live",
                "Set up SNS notifications for bounces"
            ]
        },
        "mailgun": {
            "provider": "Mailgun",
            "description": "Developer-friendly with detailed analytics",
            "steps": [
                "1. Create account at mailgun.com",
                "2. Add and verify your domain",
                "3. Go to Domain Settings > API Keys",
                "4. Copy the Private API key",
                "5. Enter in admin panel with your domain and save"
            ],
            "limits": "5,000 emails/month free (first 3 months)",
            "daily_limit": 5000,
            "tips": [
                "Great analytics and tracking",
                "Good for developers",
                "Set up webhooks for event tracking"
            ]
        }
    }

    if provider not in guides:
        raise HTTPException(status_code=404, detail="Provider guide not found")

    return guides[provider]


# =============================================================================
# Helper Functions
# =============================================================================

def _get_from_email(config: EmailProviderConfig) -> str:
    """Get the from email for a provider config."""
    from_email = {
        "smtp": config.smtp_from,
        "sendgrid": config.sendgrid_from,
        "brevo": config.brevo_from,
        "resend": config.resend_from,
        "ses": config.ses_from,
        "mailgun": config.mailgun_from
    }.get(config.provider, "")
    return from_email or ""  # Return empty string if None


def _update_provider_fields(config: EmailProviderConfig, data: EmailProviderUpdate):
    """Update provider-specific fields on config."""
    # SMTP
    if data.smtp_host:
        config.smtp_host = data.smtp_host
    if data.smtp_port:
        config.smtp_port = data.smtp_port
    if data.smtp_user:
        config.smtp_user = data.smtp_user
    if data.smtp_password:
        config.smtp_password = data.smtp_password
    if data.smtp_from:
        config.smtp_from = data.smtp_from
    if data.smtp_use_tls is not None:
        config.smtp_use_tls = data.smtp_use_tls

    # SendGrid
    if data.sendgrid_api_key is not None:
        config.sendgrid_api_key = data.sendgrid_api_key
    if data.sendgrid_from:
        config.sendgrid_from = data.sendgrid_from

    # Brevo
    if data.brevo_api_key is not None:
        config.brevo_api_key = data.brevo_api_key
    if data.brevo_from:
        config.brevo_from = data.brevo_from

    # Resend
    if data.resend_api_key is not None:
        config.resend_api_key = data.resend_api_key
    if data.resend_from:
        config.resend_from = data.resend_from

    # SES
    if data.ses_access_key is not None:
        config.ses_access_key = data.ses_access_key
    if data.ses_secret_key is not None:
        config.ses_secret_key = data.ses_secret_key
    if data.ses_region:
        config.ses_region = data.ses_region
    if data.ses_from:
        config.ses_from = data.ses_from

    # Mailgun
    if data.mailgun_api_key is not None:
        config.mailgun_api_key = data.mailgun_api_key
    if data.mailgun_domain:
        config.mailgun_domain = data.mailgun_domain
    if data.mailgun_from:
        config.mailgun_from = data.mailgun_from
