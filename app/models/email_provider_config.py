"""
Email Provider Configuration Model

Stores email provider settings in the database for dynamic selection.
Admin can switch between providers without redeploying.
Supports fallback providers when primary fails (e.g., rate limits).
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from app.database.db import Base
from datetime import datetime


class EmailProviderConfig(Base):
    """Email provider configuration stored in database."""
    __tablename__ = "email_provider_config"

    id            = Column(Integer, primary_key=True, index=True)
    
    # Provider type: smtp, sendgrid, brevo, resend, ses, mailgun
    provider      = Column(String(20), nullable=False, default="smtp")
    
    # Priority: Lower number = higher priority (1 = primary, 2 = first fallback, etc.)
    priority      = Column(Integer, default=1)
    
    # Enable this provider as a fallback option
    fallback_enabled = Column(Boolean, default=True)
    
    # -- SMTP Configuration --
    smtp_host     = Column(String(255), nullable=True)
    smtp_port     = Column(Integer, nullable=True, default=587)
    smtp_user     = Column(String(255), nullable=True)
    smtp_password = Column(String(255), nullable=True)
    smtp_from     = Column(String(255), nullable=True)
    smtp_use_tls  = Column(Boolean, default=True)
    
    # -- SendGrid Configuration --
    sendgrid_api_key  = Column(String(255), nullable=True)
    sendgrid_from     = Column(String(255), nullable=True)
    
    # -- Brevo (Sendinblue) Configuration --
    brevo_api_key = Column(String(255), nullable=True)
    brevo_from    = Column(String(255), nullable=True)
    
    # -- Resend Configuration --
    resend_api_key = Column(String(255), nullable=True)
    resend_from    = Column(String(255), nullable=True)
    
    # -- Amazon SES Configuration --
    ses_access_key    = Column(String(255), nullable=True)
    ses_secret_key    = Column(String(255), nullable=True)
    ses_region        = Column(String(50), nullable=True, default="us-east-1")
    ses_from          = Column(String(255), nullable=True)
    
    # -- Mailgun Configuration --
    mailgun_api_key = Column(String(255), nullable=True)
    mailgun_domain  = Column(String(255), nullable=True)
    mailgun_from    = Column(String(255), nullable=True)
    
    # -- Common Settings --
    from_name     = Column(String(100), nullable=True, default="SnapMatch")
    reply_to      = Column(String(255), nullable=True)
    
    # -- Status --
    is_active     = Column(Boolean, default=True)
    is_configured = Column(Boolean, default=False)
    last_test_at  = Column(DateTime, nullable=True)
    last_test_status = Column(String(20), nullable=True)
    last_test_error  = Column(Text, nullable=True)
    
    # -- Rate Limit Tracking --
    daily_sent_count = Column(Integer, default=0)
    daily_limit      = Column(Integer, nullable=True)  # Provider's daily limit
    last_sent_date   = Column(DateTime, nullable=True)  # Track daily resets
    
    # -- Timestamps --
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def get_config_for_provider(self) -> dict:
        """Get configuration for the current provider."""
        if self.provider == "smtp":
            return {
                "host": self.smtp_host,
                "port": self.smtp_port,
                "user": self.smtp_user,
                "password": self.smtp_password,
                "from_email": self.smtp_from,
                "use_tls": self.smtp_use_tls
            }
        elif self.provider == "sendgrid":
            return {
                "api_key": self.sendgrid_api_key,
                "from_email": self.sendgrid_from
            }
        elif self.provider == "brevo":
            return {
                "api_key": self.brevo_api_key,
                "from_email": self.brevo_from
            }
        elif self.provider == "resend":
            return {
                "api_key": self.resend_api_key,
                "from_email": self.resend_from
            }
        elif self.provider == "ses":
            return {
                "access_key": self.ses_access_key,
                "secret_key": self.ses_secret_key,
                "region": self.ses_region,
                "from_email": self.ses_from
            }
        elif self.provider == "mailgun":
            return {
                "api_key": self.mailgun_api_key,
                "domain": self.mailgun_domain,
                "from_email": self.mailgun_from
            }
        return {}
    
    def is_rate_limited(self) -> bool:
        """Check if this provider has hit its daily limit."""
        if not self.daily_limit:
            return False
        
        # Reset counter if it's a new day
        from datetime import date
        if self.last_sent_date and self.last_sent_date.date() < date.today():
            self.daily_sent_count = 0
            return False
        
        return self.daily_sent_count >= self.daily_limit
    
    def increment_sent_count(self):
        """Increment the daily sent counter."""
        from datetime import date
        today = datetime.utcnow()
        
        # Reset if new day
        if not self.last_sent_date or self.last_sent_date.date() < today.date():
            self.daily_sent_count = 0
        
        self.daily_sent_count = (self.daily_sent_count or 0) + 1
        self.last_sent_date = today