"""
Email Service Module

Handles email sending with configurable SMTP settings.
Supports Gmail SMTP for development and can be easily configured for other providers.

Environment Variables:
- SMTP_HOST: SMTP server hostname (default: smtp.gmail.com)
- SMTP_PORT: SMTP server port (default: 587)
- SMTP_USER: SMTP authentication username
- SMTP_PASSWORD: SMTP authentication password (App Password for Gmail)
- SMTP_FROM: Sender email address
- SMTP_USE_TLS: Whether to use TLS (default: true)

For Gmail:
1. Enable 2-Factor Authentication
2. Generate an App Password: Google Account > Security > App passwords
3. Use the App Password as SMTP_PASSWORD

Development Mode:
- If SMTP credentials are not configured, emails will be logged to console
"""
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class EmailConfig:
    """Email configuration from environment variables"""

    def __init__(self):
        self.smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.smtp_user = os.getenv("SMTP_USER", "")
        self.smtp_password = os.getenv("SMTP_PASSWORD", "")
        self.smtp_from = os.getenv("SMTP_FROM", self.smtp_user)
        self.smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

    @property
    def is_configured(self) -> bool:
        """Check if SMTP is properly configured"""
        return bool(self.smtp_user and self.smtp_password)

    @property
    def is_development_mode(self) -> bool:
        """Check if running in development mode (no real SMTP)"""
        return not self.is_configured


def get_email_config() -> EmailConfig:
    """Get email configuration instance"""
    return EmailConfig()


def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None
) -> bool:
    """
    Send an email to the specified recipient.

    Args:
        to_email: Recipient email address
        subject: Email subject
        html_content: HTML body of the email
        text_content: Plain text body (optional, will use HTML if not provided)

    Returns:
        bool: True if email was sent successfully, False otherwise

    Raises:
        Exception: If email sending fails in production mode
    """
    config = get_email_config()

    # Development mode: Log email instead of sending
    if config.is_development_mode:
        logger.info("=" * 60)
        logger.info("DEVELOPMENT MODE: Email not sent (SMTP not configured)")
        logger.info(f"To: {to_email}")
        logger.info(f"Subject: {subject}")
        logger.info("-" * 60)
        logger.info(html_content)
        logger.info("=" * 60)
        return True

    # Production mode: Send actual email
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = config.smtp_from
        msg["To"] = to_email
        msg["Subject"] = subject

        # Add text part if provided
        if text_content:
            msg.attach(MIMEText(text_content, "plain"))

        # Add HTML part
        msg.attach(MIMEText(html_content, "html"))

        # Connect and send
        if config.smtp_use_tls:
            server = smtplib.SMTP(config.smtp_host, config.smtp_port)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(config.smtp_host, config.smtp_port)

        server.login(config.smtp_user, config.smtp_password)
        server.sendmail(config.smtp_from, to_email, msg.as_string())
        server.quit()

        logger.info(f"Email sent successfully to {to_email}")
        return True

    except smtplib.SMTPAuthenticationError:
        logger.error("SMTP Authentication failed. Check your SMTP credentials.")
        raise Exception("Email authentication failed")
    except smtplib.SMTPException as e:
        logger.error(f"SMTP error occurred: {str(e)}")
        raise Exception(f"Failed to send email: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error sending email: {str(e)}")
        raise Exception(f"Failed to send email: {str(e)}")


def send_otp_email(
    to_email: str,
    otp_code: str,
    purpose: str = "verification",
    expiry_minutes: int = 10
) -> bool:
    """
    Send an OTP verification email.

    Args:
        to_email: Recipient email address
        otp_code: The OTP code to send
        purpose: Purpose of the OTP (registration, login, password_reset)
        expiry_minutes: OTP expiry time in minutes

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
                <p>© {2024} SnapMatch. All rights reserved.</p>
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

    © SnapMatch. All rights reserved.
    """

    subject = f"SnapMatch - Your {purpose.replace('_', ' ').title()} Verification Code"

    return send_email(to_email, subject, html_content, text_content)