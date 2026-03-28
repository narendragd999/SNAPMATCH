"""
Email Service Module - Production Ready with Dynamic Provider Selection

Supports multiple email providers:
1. SMTP (Gmail, Outlook, custom servers) - Universal
2. SendGrid - Transactional emails with high deliverability
3. Brevo (Sendinblue) - Free tier: 300 emails/day
4. Resend - Modern developer-friendly service
5. Amazon SES - Cost-effective for high volume
6. Mailgun - Developer-friendly with good analytics

Provider can be selected from:
1. Database (admin panel) - Takes priority
2. Environment variables - Fallback

Usage:
    from app.services.email_service import send_email, send_otp_email
    
    # Send email (provider automatically selected)
    send_email(to_email, subject, html_content)
"""
import os
import logging
import requests
from typing import Optional, Dict, Any
from abc import ABC, abstractmethod
from datetime import datetime
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# =============================================================================
# Email Configuration
# =============================================================================

class EmailConfig:
    """Email configuration - loads from database first, then environment."""

    def __init__(self, db_config=None):
        self.db_config = db_config
        self._load_config()

    def _load_config(self):
        """Load configuration from database or environment."""
        if self.db_config:
            self._load_from_db()
        else:
            self._load_from_env()

    def _load_from_db(self):
        """Load configuration from database record."""
        self.provider = self.db_config.provider.lower()
        self.from_name = self.db_config.from_name or "SnapMatch"
        self.reply_to = self.db_config.reply_to
        
        # SMTP
        self.smtp_host = self.db_config.smtp_host
        self.smtp_port = self.db_config.smtp_port or 587
        self.smtp_user = self.db_config.smtp_user
        self.smtp_password = self.db_config.smtp_password
        self.smtp_from = self.db_config.smtp_from
        self.smtp_use_tls = self.db_config.smtp_use_tls if self.db_config.smtp_use_tls is not None else True
        
        # SendGrid
        self.sendgrid_api_key = self.db_config.sendgrid_api_key
        self.sendgrid_from = self.db_config.sendgrid_from
        
        # Brevo
        self.brevo_api_key = self.db_config.brevo_api_key
        self.brevo_from = self.db_config.brevo_from
        
        # Resend
        self.resend_api_key = self.db_config.resend_api_key
        self.resend_from = self.db_config.resend_from
        
        # SES
        self.ses_access_key = self.db_config.ses_access_key
        self.ses_secret_key = self.db_config.ses_secret_key
        self.ses_region = self.db_config.ses_region or "us-east-1"
        self.ses_from = self.db_config.ses_from
        
        # Mailgun
        self.mailgun_api_key = self.db_config.mailgun_api_key
        self.mailgun_domain = self.db_config.mailgun_domain
        self.mailgun_from = self.db_config.mailgun_from

    def _load_from_env(self):
        """Load configuration from environment variables (fallback)."""
        self.provider = os.getenv("EMAIL_PROVIDER", "smtp").lower()
        self.from_name = os.getenv("EMAIL_FROM_NAME", "SnapMatch")
        self.reply_to = os.getenv("EMAIL_REPLY_TO", "")
        
        # SMTP
        self.smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = os.getenv("SMTP_USER", "")
        self.smtp_password = os.getenv("SMTP_PASSWORD", "")
        self.smtp_from = os.getenv("SMTP_FROM", self.smtp_user)
        self.smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
        
        # SendGrid
        self.sendgrid_api_key = os.getenv("SENDGRID_API_KEY", "")
        self.sendgrid_from = os.getenv("SENDGRID_FROM_EMAIL", "")
        
        # Brevo
        self.brevo_api_key = os.getenv("BREVO_API_KEY", "")
        self.brevo_from = os.getenv("BREVO_FROM_EMAIL", "")
        
        # Resend
        self.resend_api_key = os.getenv("RESEND_API_KEY", "")
        self.resend_from = os.getenv("RESEND_FROM_EMAIL", "")
        
        # SES
        self.ses_access_key = os.getenv("AWS_ACCESS_KEY_ID", "")
        self.ses_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY", "")
        self.ses_region = os.getenv("AWS_REGION", "us-east-1")
        self.ses_from = os.getenv("SES_FROM_EMAIL", "")
        
        # Mailgun
        self.mailgun_api_key = os.getenv("MAILGUN_API_KEY", "")
        self.mailgun_domain = os.getenv("MAILGUN_DOMAIN", "")
        self.mailgun_from = os.getenv("MAILGUN_FROM_EMAIL", "")

    @property
    def from_email(self) -> str:
        """Get the from email for the current provider."""
        if self.provider == "sendgrid" and self.sendgrid_from:
            return self.sendgrid_from
        elif self.provider == "brevo" and self.brevo_from:
            return self.brevo_from
        elif self.provider == "resend" and self.resend_from:
            return self.resend_from
        elif self.provider == "ses" and self.ses_from:
            return self.ses_from
        elif self.provider == "mailgun" and self.mailgun_from:
            return self.mailgun_from
        elif self.smtp_from:
            return self.smtp_from
        return "noreply@snapmatch.com"

    @property
    def is_configured(self) -> bool:
        """Check if the current provider is properly configured."""
        if self.provider == "sendgrid":
            return bool(self.sendgrid_api_key and self.sendgrid_from)
        elif self.provider == "brevo":
            return bool(self.brevo_api_key and self.brevo_from)
        elif self.provider == "resend":
            return bool(self.resend_api_key and self.resend_from)
        elif self.provider == "ses":
            return bool(self.ses_access_key and self.ses_secret_key and self.ses_from)
        elif self.provider == "mailgun":
            return bool(self.mailgun_api_key and self.mailgun_domain and self.mailgun_from)
        else:  # smtp
            return bool(self.smtp_user and self.smtp_password and self.smtp_host)

    @property
    def is_development_mode(self) -> bool:
        """Check if running in development mode (no email provider configured)."""
        return not self.is_configured


def get_db_email_config(db: Session):
    """Get email configuration from database."""
    from app.models.email_provider_config import EmailProviderConfig
    return db.query(EmailProviderConfig).filter(EmailProviderConfig.is_active == True).first()


def get_all_email_configs(db: Session) -> list:
    """Get all active email configurations sorted by priority."""
    from app.models.email_provider_config import EmailProviderConfig
    configs = db.query(EmailProviderConfig).filter(
        EmailProviderConfig.is_active == True,
        EmailProviderConfig.fallback_enabled == True,
        EmailProviderConfig.is_configured == True
    ).order_by(EmailProviderConfig.priority.asc()).all()
    return configs


def get_email_config(db: Session = None) -> EmailConfig:
    """Get email configuration instance - tries database first, then environment."""
    if db:
        try:
            configs = get_all_email_configs(db)
            if configs:
                return EmailConfig(configs[0])  # Return highest priority
        except Exception as e:
            logger.warning(f"Could not load email config from database: {e}")
    return EmailConfig(None)  # Fall back to environment variables


def get_email_provider(config: EmailConfig):
    """Factory function to get the appropriate email provider."""
    # Provider classes are defined below - using late binding
    providers = {
        "smtp": SMTPProvider,
        "sendgrid": SendGridProvider,
        "brevo": BrevoProvider,
        "resend": ResendProvider,
        "ses": SESProvider,
        "mailgun": MailgunProvider
    }

    provider_class = providers.get(config.provider, SMTPProvider)
    return provider_class(config)


def send_email_with_fallback(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    db: Session = None
) -> Dict[str, Any]:
    """
    Send an email with automatic fallback to other providers if primary fails.
    
    This is the recommended function to use for production emails.
    
    Args:
        to_email: Recipient email address
        subject: Email subject
        html_content: HTML body
        text_content: Plain text body (optional)
        db: Database session (for dynamic config)
    
    Returns:
        Dict with success status, provider used, and any error messages
    """
    errors = []
    
    # Try database-configured providers first (sorted by priority)
    if db:
        try:
            configs = get_all_email_configs(db)
            
            for db_config in configs:
                # Skip if rate limited
                if db_config.is_rate_limited():
                    logger.info(f"Skipping {db_config.provider} - daily limit reached ({db_config.daily_sent_count}/{db_config.daily_limit})")
                    continue
                
                config = EmailConfig(db_config)
                
                try:
                    provider = get_email_provider(config)
                    result = provider.send(
                        to_email=to_email,
                        subject=subject,
                        html_content=html_content,
                        text_content=text_content,
                        from_name=config.from_name
                    )
                    
                    # Update sent count
                    db_config.increment_sent_count()
                    db.commit()
                    
                    logger.info(f"Email sent successfully via {result['provider']} to {to_email}")
                    
                    return {
                        "success": True,
                        "provider": result['provider'],
                        "message_id": result.get('message_id'),
                        "fallback_used": db_config.priority > 1
                    }
                    
                except Exception as e:
                    error_msg = f"{db_config.provider}: {str(e)}"
                    errors.append(error_msg)
                    logger.warning(f"Provider {db_config.provider} failed: {str(e)}")
                    continue
                    
        except Exception as e:
            logger.warning(f"Could not load email configs from database: {e}")
    
    # Fall back to environment variables
    config = EmailConfig(None)
    
    if config.is_configured:
        try:
            provider = get_email_provider(config)
            result = provider.send(
                to_email=to_email,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
                from_name=config.from_name
            )
            
            logger.info(f"Email sent successfully via {result['provider']} (env fallback) to {to_email}")
            
            return {
                "success": True,
                "provider": result['provider'],
                "message_id": result.get('message_id'),
                "fallback_used": True
            }
            
        except Exception as e:
            errors.append(f"env_fallback ({config.provider}): {str(e)}")
    
    # All providers failed
    error_summary = "; ".join(errors)
    logger.error(f"All email providers failed: {error_summary}")
    
    return {
        "success": False,
        "provider": None,
        "error": error_summary,
        "errors": errors
    }


def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    db: Session = None
) -> bool:
    """
    Send an email using the configured provider with automatic fallback.

    Args:
        to_email: Recipient email address
        subject: Email subject
        html_content: HTML body
        text_content: Plain text body (optional)
        db: Database session (for dynamic config)

    Returns:
        bool: True if email was sent successfully

    Raises:
        Exception: If all email providers fail
    """
    # Try database-configured providers first
    if db:
        try:
            configs = get_all_email_configs(db)
            
            if configs:
                errors = []
                
                for db_config in configs:
                    # Skip if rate limited
                    if db_config.is_rate_limited():
                        logger.info(f"Skipping {db_config.provider} - daily limit reached")
                        continue
                    
                    config = EmailConfig(db_config)
                    
                    try:
                        provider = get_email_provider(config)
                        result = provider.send(
                            to_email=to_email,
                            subject=subject,
                            html_content=html_content,
                            text_content=text_content,
                            from_name=config.from_name
                        )
                        
                        # Update sent count
                        db_config.increment_sent_count()
                        db.commit()
                        
                        logger.info(f"Email sent successfully via {result['provider']} to {to_email}")
                        return True
                        
                    except Exception as e:
                        errors.append(f"{db_config.provider}: {str(e)}")
                        logger.warning(f"Provider {db_config.provider} failed, trying fallback: {str(e)}")
                        continue
                
                # All configured providers failed, log errors
                if errors:
                    logger.error(f"All database providers failed: {'; '.join(errors)}")
                    
        except Exception as e:
            logger.warning(f"Could not load email config from database: {e}")
    
    # Fall back to environment variables
    config = EmailConfig(None)

    # Development mode: Log instead of sending
    if not config.is_configured:
        logger.info("=" * 60)
        logger.info("DEVELOPMENT MODE: Email not sent (no provider configured)")
        logger.info(f"To: {to_email}")
        logger.info(f"Subject: {subject}")
        logger.info("-" * 60)
        logger.info(html_content[:500] + "..." if len(html_content) > 500 else html_content)
        logger.info("=" * 60)
        return True

    # Try environment-configured provider
    try:
        provider = get_email_provider(config)
        result = provider.send(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            from_name=config.from_name
        )

        logger.info(f"Email sent successfully via {result['provider']} (env) to {to_email}")
        return result["success"]

    except Exception as e:
        logger.error(f"Failed to send email via all providers: {str(e)}")
        raise


# =============================================================================
# Email Provider Implementations
# =============================================================================

class EmailProvider(ABC):
    """Abstract base class for email providers."""

    @abstractmethod
    def send(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None, from_name: str = None) -> Dict[str, Any]:
        """Send an email and return result with status."""
        pass
    
    @abstractmethod
    def test_connection(self) -> Dict[str, Any]:
        """Test the email provider connection."""
        pass


class SMTPProvider(EmailProvider):
    """SMTP email provider (Gmail, Outlook, custom servers)."""

    def __init__(self, config: EmailConfig):
        self.config = config

    def send(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None, from_name: str = None) -> Dict[str, Any]:
        import smtplib
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        try:
            msg = MIMEMultipart("alternative")
            msg["From"] = f"{from_name or self.config.from_name} <{self.config.smtp_from}>"
            msg["To"] = to_email
            msg["Subject"] = subject
            
            if self.config.reply_to:
                msg["Reply-To"] = self.config.reply_to

            if text_content:
                msg.attach(MIMEText(text_content, "plain"))
            msg.attach(MIMEText(html_content, "html"))

            if self.config.smtp_use_tls:
                server = smtplib.SMTP(self.config.smtp_host, self.config.smtp_port)
                server.starttls()
            else:
                server = smtplib.SMTP_SSL(self.config.smtp_host, self.config.smtp_port)

            server.login(self.config.smtp_user, self.config.smtp_password)
            server.sendmail(self.config.smtp_from, to_email, msg.as_string())
            server.quit()

            return {"success": True, "provider": "smtp", "message_id": None}

        except smtplib.SMTPAuthenticationError as e:
            raise Exception(f"SMTP authentication failed: {str(e)}")
        except smtplib.SMTPException as e:
            raise Exception(f"SMTP error: {str(e)}")
        except Exception as e:
            raise Exception(f"Failed to send email: {str(e)}")

    def test_connection(self) -> Dict[str, Any]:
        import smtplib
        try:
            server = smtplib.SMTP(self.config.smtp_host, self.config.smtp_port)
            if self.config.smtp_use_tls:
                server.starttls()
            server.login(self.config.smtp_user, self.config.smtp_password)
            server.quit()
            return {"success": True, "message": "SMTP connection successful"}
        except Exception as e:
            return {"success": False, "message": str(e)}


class SendGridProvider(EmailProvider):
    """SendGrid email provider - Industry standard for transactional emails."""

    def __init__(self, config: EmailConfig):
        self.config = config

    def send(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None, from_name: str = None) -> Dict[str, Any]:
        try:
            import sendgrid
            from sendgrid.helpers.mail import Mail, Email, To, Content

            sg = sendgrid.SendGridAPIClient(api_key=self.config.sendgrid_api_key)

            mail = Mail(
                from_email=Email(self.config.sendgrid_from, from_name or self.config.from_name),
                to_emails=To(to_email),
                subject=subject,
                html_content=Content("text/html", html_content)
            )

            if text_content:
                mail.add_content(Content("text/plain", text_content))

            response = sg.send(mail)

            return {
                "success": response.status_code in [200, 201, 202],
                "provider": "sendgrid",
                "message_id": response.headers.get("X-Message-Id"),
                "status_code": response.status_code
            }

        except ImportError:
            raise Exception("SendGrid package not installed. Run: pip install sendgrid")
        except Exception as e:
            raise Exception(f"SendGrid error: {str(e)}")

    def test_connection(self) -> Dict[str, Any]:
        try:
            import sendgrid
            sg = sendgrid.SendGridAPIClient(api_key=self.config.sendgrid_api_key)
            # SendGrid doesn't have a direct test endpoint, so we validate the API key format
            if self.config.sendgrid_api_key and self.config.sendgrid_api_key.startswith('SG.'):
                return {"success": True, "message": "SendGrid API key format is valid"}
            return {"success": False, "message": "Invalid SendGrid API key format"}
        except Exception as e:
            return {"success": False, "message": str(e)}


class BrevoProvider(EmailProvider):
    """Brevo (formerly Sendinblue) - Free tier: 300 emails/day."""

    def __init__(self, config: EmailConfig):
        self.config = config

    def send(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None, from_name: str = None) -> Dict[str, Any]:
        try:
            url = "https://api.brevo.com/v3/smtp/email"

            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "api-key": self.config.brevo_api_key
            }

            data = {
                "sender": {
                    "name": from_name or self.config.from_name,
                    "email": self.config.brevo_from
                },
                "to": [{"email": to_email}],
                "subject": subject,
                "htmlContent": html_content
            }

            if text_content:
                data["textContent"] = text_content

            response = requests.post(url, headers=headers, json=data, timeout=30)

            if response.status_code in [200, 201]:
                result = response.json()
                return {
                    "success": True,
                    "provider": "brevo",
                    "message_id": result.get("messageId")
                }
            else:
                error_msg = response.text
                try:
                    error_data = response.json()
                    error_msg = error_data.get("message", error_msg)
                except:
                    pass
                raise Exception(f"Brevo API error: {error_msg}")

        except requests.exceptions.RequestException as e:
            raise Exception(f"Brevo connection error: {str(e)}")

    def test_connection(self) -> Dict[str, Any]:
        try:
            url = "https://api.brevo.com/v3/account"
            headers = {
                "Accept": "application/json",
                "api-key": self.config.brevo_api_key
            }
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code == 200:
                return {"success": True, "message": "Brevo connection successful"}
            return {"success": False, "message": f"Brevo API error: {response.status_code}"}
        except Exception as e:
            return {"success": False, "message": str(e)}


class ResendProvider(EmailProvider):
    """Resend - Modern, developer-friendly email service."""

    def __init__(self, config: EmailConfig):
        self.config = config

    def send(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None, from_name: str = None) -> Dict[str, Any]:
        try:
            url = "https://api.resend.com/emails"

            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.config.resend_api_key}"
            }

            data = {
                "from": f"{from_name or self.config.from_name} <{self.config.resend_from}>",
                "to": [to_email],
                "subject": subject,
                "html": html_content
            }

            if text_content:
                data["text"] = text_content

            response = requests.post(url, headers=headers, json=data, timeout=30)

            if response.status_code in [200, 201]:
                result = response.json()
                return {
                    "success": True,
                    "provider": "resend",
                    "message_id": result.get("id")
                }
            else:
                error_msg = response.text
                try:
                    error_data = response.json()
                    error_msg = error_data.get("message", error_msg)
                except:
                    pass
                raise Exception(f"Resend API error: {error_msg}")

        except requests.exceptions.RequestException as e:
            raise Exception(f"Resend connection error: {str(e)}")

    def test_connection(self) -> Dict[str, Any]:
        try:
            # Resend doesn't have a dedicated test endpoint, validate API key
            if self.config.resend_api_key and self.config.resend_api_key.startswith('re_'):
                return {"success": True, "message": "Resend API key format is valid"}
            return {"success": False, "message": "Invalid Resend API key format (should start with 're_)'"}
        except Exception as e:
            return {"success": False, "message": str(e)}


class SESProvider(EmailProvider):
    """Amazon SES - Cost-effective for high volume."""

    def __init__(self, config: EmailConfig):
        self.config = config

    def send(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None, from_name: str = None) -> Dict[str, Any]:
        try:
            import boto3
            from botocore.exceptions import ClientError

            client = boto3.client(
                'ses',
                region_name=self.config.ses_region,
                aws_access_key_id=self.config.ses_access_key,
                aws_secret_access_key=self.config.ses_secret_key
            )

            body = {'Html': {'Data': html_content, 'Charset': 'UTF-8'}}
            if text_content:
                body['Text'] = {'Data': text_content, 'Charset': 'UTF-8'}

            response = client.send_email(
                Source=f"{from_name or self.config.from_name} <{self.config.ses_from}>",
                Destination={'ToAddresses': [to_email]},
                Message={
                    'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                    'Body': body
                }
            )

            return {
                "success": True,
                "provider": "ses",
                "message_id": response.get('MessageId')
            }

        except ImportError:
            raise Exception("Boto3 package not installed. Run: pip install boto3")
        except ClientError as e:
            raise Exception(f"SES error: {e.response['Error']['Message']}")
        except Exception as e:
            raise Exception(f"SES error: {str(e)}")

    def test_connection(self) -> Dict[str, Any]:
        try:
            import boto3
            client = boto3.client(
                'ses',
                region_name=self.config.ses_region,
                aws_access_key_id=self.config.ses_access_key,
                aws_secret_access_key=self.config.ses_secret_key
            )
            client.get_send_quota()
            return {"success": True, "message": "SES connection successful"}
        except Exception as e:
            return {"success": False, "message": str(e)}


class MailgunProvider(EmailProvider):
    """Mailgun - Developer-friendly with good analytics."""

    def __init__(self, config: EmailConfig):
        self.config = config

    def send(self, to_email: str, subject: str, html_content: str, text_content: Optional[str] = None, from_name: str = None) -> Dict[str, Any]:
        try:
            url = f"https://api.mailgun.net/v3/{self.config.mailgun_domain}/messages"

            data = {
                "from": f"{from_name or self.config.from_name} <{self.config.mailgun_from}>",
                "to": to_email,
                "subject": subject,
                "html": html_content
            }

            if text_content:
                data["text"] = text_content

            response = requests.post(
                url,
                auth=("api", self.config.mailgun_api_key),
                data=data,
                timeout=30
            )

            if response.status_code == 200:
                result = response.json()
                return {
                    "success": True,
                    "provider": "mailgun",
                    "message_id": result.get("id")
                }
            else:
                raise Exception(f"Mailgun API error: {response.text}")

        except requests.exceptions.RequestException as e:
            raise Exception(f"Mailgun connection error: {str(e)}")

    def test_connection(self) -> Dict[str, Any]:
        try:
            url = f"https://api.mailgun.net/v3/{self.config.mailgun_domain}"
            response = requests.get(
                url,
                auth=("api", self.config.mailgun_api_key),
                timeout=10
            )
            if response.status_code == 200:
                return {"success": True, "message": "Mailgun connection successful"}
            return {"success": False, "message": f"Mailgun API error: {response.status_code}"}
        except Exception as e:
            return {"success": False, "message": str(e)}


# =============================================================================
# Main Email Service Functions
# =============================================================================

def get_email_provider(config: EmailConfig) -> EmailProvider:
    """Factory function to get the appropriate email provider."""
    providers = {
        "smtp": SMTPProvider,
        "sendgrid": SendGridProvider,
        "brevo": BrevoProvider,
        "resend": ResendProvider,
        "ses": SESProvider,
        "mailgun": MailgunProvider
    }

    provider_class = providers.get(config.provider, SMTPProvider)
    return provider_class(config)


def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    db: Session = None
) -> bool:
    """
    Send an email using the configured provider.

    Args:
        to_email: Recipient email address
        subject: Email subject
        html_content: HTML body
        text_content: Plain text body (optional)
        db: Database session (for dynamic config)

    Returns:
        bool: True if email was sent successfully

    Raises:
        Exception: If email sending fails
    """
    config = get_email_config(db)

    # Development mode: Log instead of sending
    if not config.is_configured:
        logger.info("=" * 60)
        logger.info("DEVELOPMENT MODE: Email not sent (no provider configured)")
        logger.info(f"To: {to_email}")
        logger.info(f"Subject: {subject}")
        logger.info("-" * 60)
        logger.info(html_content[:500] + "..." if len(html_content) > 500 else html_content)
        logger.info("=" * 60)
        return True

    # Production mode: Send via configured provider
    try:
        provider = get_email_provider(config)
        result = provider.send(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            from_name=config.from_name
        )

        logger.info(f"Email sent successfully via {result['provider']} to {to_email}")
        return result["success"]

    except Exception as e:
        logger.error(f"Failed to send email: {str(e)}")
        raise


def send_otp_email(
    to_email: str,
    otp_code: str,
    purpose: str = "verification",
    expiry_minutes: int = 10,
    db: Session = None
) -> bool:
    """
    Send an OTP verification email.

    Args:
        to_email: Recipient email address
        otp_code: The OTP code to send
        purpose: Purpose (registration, login, password_reset)
        expiry_minutes: OTP expiry time
        db: Database session (optional)

    Returns:
        bool: True if email was sent successfully
    """
    purpose_text = {
        "registration": "complete your registration",
        "login": "verify your login",
        "password_reset": "reset your password"
    }.get(purpose, "verify your email")

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #09090b; }}
            .container {{ max-width: 500px; margin: 0 auto; background: #18181b; border-radius: 16px; overflow: hidden; border: 1px solid #27272a; }}
            .header {{ background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 30px; text-align: center; }}
            .header h1 {{ color: white; margin: 0; font-size: 24px; }}
            .content {{ padding: 30px; text-align: center; }}
            .otp-code {{ font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6; margin: 20px 0; padding: 20px; background: #09090b; border-radius: 12px; border: 2px dashed #3b82f6; }}
            .info {{ color: #a1a1aa; font-size: 14px; margin-top: 20px; }}
            .warning {{ color: #f97316; font-size: 12px; margin-top: 15px; }}
            .footer {{ padding: 20px; text-align: center; color: #71717a; font-size: 12px; border-top: 1px solid #27272a; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>SnapMatch</h1>
            </div>
            <div class="content">
                <p style="color: #e4e4e7; font-size: 16px; margin-bottom: 10px;">
                    Hello!
                </p>
                <p style="color: #a1a1aa; font-size: 14px;">
                    Use the following verification code to {purpose_text}:
                </p>
                <div class="otp-code">{otp_code}</div>
                <p class="info">
                    This code will expire in <strong>{expiry_minutes} minutes</strong>.
                </p>
                <p class="warning">
                    If you didn't request this code, please ignore this email.
                </p>
            </div>
            <div class="footer">
                <p>© {datetime.now().year} SnapMatch. All rights reserved.</p>
                <p>This is an automated message, please do not reply.</p>
            </div>
        </div>
    </body>
    </html>
    """

    text_content = f"""
    SnapMatch Verification Code

    Your verification code is: {otp_code}

    This code will expire in {expiry_minutes} minutes.

    If you didn't request this code, please ignore this email.

    © {datetime.now().year} SnapMatch. All rights reserved.
    """

    subject = f"SnapMatch - Your {purpose.replace('_', ' ').title()} Verification Code"

    return send_email(to_email, subject, html_content, text_content, db)


def test_email_provider(config: EmailConfig) -> Dict[str, Any]:
    """
    Test an email provider connection.

    Args:
        config: Email configuration to test

    Returns:
        Dict with success status and message
    """
    try:
        provider = get_email_provider(config)
        return provider.test_connection()
    except Exception as e:
        return {"success": False, "message": str(e)}


# =============================================================================
# Provider Comparison Helper
# =============================================================================

def get_provider_comparison() -> Dict[str, Any]:
    """Get a comparison of available email providers for documentation."""
    return {
        "providers": {
            "smtp": {
                "name": "SMTP (Gmail/Outlook)",
                "best_for": "Development, small scale",
                "pros": ["Free", "Easy setup", "Works with existing email"],
                "cons": ["Daily limits", "Deliverability issues", "No analytics"],
                "limits": "500/day (Gmail free), 2000/day (Google Workspace)",
                "setup_difficulty": "Easy"
            },
            "sendgrid": {
                "name": "SendGrid (Twilio)",
                "best_for": "Production, transactional emails",
                "pros": ["High deliverability", "Analytics", "Templates", "Webhooks"],
                "cons": ["Cost at scale", "Domain verification required"],
                "limits": "100/day free, then pay-as-you-go",
                "pricing": "Starts at $14.95/month for 50k emails",
                "setup_difficulty": "Medium"
            },
            "brevo": {
                "name": "Brevo (Sendinblue)",
                "best_for": "Budget-conscious, startups",
                "pros": ["Generous free tier", "Marketing features", "SMS support"],
                "cons": ["Branding on free tier", "Support limits"],
                "limits": "300/day free forever",
                "pricing": "Starts at $25/month for 20k emails",
                "setup_difficulty": "Easy"
            },
            "resend": {
                "name": "Resend",
                "best_for": "Developers, modern apps",
                "pros": ["Simple API", "Great DX", "Fast delivery", "React Email support"],
                "cons": ["Newer service", "Less features than SendGrid"],
                "limits": "3,000/month free",
                "pricing": "Starts at $20/month for 50k emails",
                "setup_difficulty": "Easy"
            },
            "ses": {
                "name": "Amazon SES",
                "best_for": "High volume, AWS users",
                "pros": ["Very cheap", "Scalable", "AWS integration"],
                "cons": ["Requires AWS account", "Domain verification", "Initial sandbox mode"],
                "limits": "Unlimited",
                "pricing": "$0.10 per 1000 emails",
                "setup_difficulty": "Hard"
            },
            "mailgun": {
                "name": "Mailgun (Sinch)",
                "best_for": "Developers, analytics-focused",
                "pros": ["Great API", "Detailed analytics", "Good deliverability"],
                "cons": ["Domain verification required", "Pricing tiers"],
                "limits": "5000/month free (first 3 months)",
                "pricing": "Starts at $15/month for 50k emails",
                "setup_difficulty": "Medium"
            }
        },
        "recommendations": {
            "development": "smtp or brevo (free tier)",
            "small_production": "brevo (300/day free) or resend",
            "medium_production": "sendgrid or resend",
            "high_volume": "amazon ses"
        }
    }