"""
OTP Service Module

Handles OTP generation, verification, and management.
Supports both production (unique OTP per user) and development (common OTP) modes.

Environment Variables:
- OTP_EXPIRY_MINUTES: OTP validity duration in minutes (default: 10)
- OTP_LENGTH: Length of generated OTP (default: 6)
- DEV_COMMON_OTP: Common OTP for development mode (default: "123456")
- OTP_MAX_ATTEMPTS: Maximum verification attempts (default: 5)
"""
import os
import random
import string
import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from typing import Optional, Tuple

from app.models.otp import OTPVerification
from app.services.email_service import send_otp_email, get_email_config

logger = logging.getLogger(__name__)


class OTPConfig:
    """OTP configuration from environment variables"""

    def __init__(self):
        self.expiry_minutes = int(os.getenv("OTP_EXPIRY_MINUTES", "10"))
        self.otp_length = int(os.getenv("OTP_LENGTH", "6"))
        self.dev_common_otp = os.getenv("DEV_COMMON_OTP", "123456")
        self.max_attempts = int(os.getenv("OTP_MAX_ATTEMPTS", "5"))

    @property
    def is_development_mode(self) -> bool:
        """Check if running in development mode"""
        # Development mode ONLY if SMTP is not configured
        # DEV_COMMON_OTP is used as the OTP code in dev mode, NOT to force dev mode
        return get_email_config().is_development_mode


def get_otp_config() -> OTPConfig:
    """Get OTP configuration instance"""
    return OTPConfig()


def generate_otp(length: int = 6) -> str:
    """
    Generate a random numeric OTP.

    Args:
        length: Length of the OTP (default: 6)

    Returns:
        str: Generated OTP code
    """
    return ''.join(random.choices(string.digits, k=length))


def create_otp(
    db: Session,
    email: str,
    purpose: str = "registration",
    config: Optional[OTPConfig] = None
) -> Tuple[str, bool]:
    """
    Create a new OTP for the given email.

    In development mode, returns a common OTP for easy testing.
    In production mode, generates a unique OTP and sends via email.

    Args:
        db: Database session
        email: User's email address
        purpose: Purpose of OTP (registration, login, password_reset)
        config: OTP configuration (optional)

    Returns:
        Tuple[str, bool]: (OTP code, is_development_mode)
    """
    if config is None:
        config = get_otp_config()

    # Invalidate any existing unused OTPs for this email and purpose
    db.query(OTPVerification).filter(
        OTPVerification.email == email,
        OTPVerification.purpose == purpose,
        OTPVerification.is_verified == False
    ).delete()

    # Determine OTP code based on mode
    is_dev_mode = config.is_development_mode

    if is_dev_mode:
        otp_code = config.dev_common_otp
        logger.info(f"DEVELOPMENT MODE: Using common OTP '{otp_code}' for {email}")
    else:
        otp_code = generate_otp(config.otp_length)

    # Calculate expiry time
    expires_at = datetime.utcnow() + timedelta(minutes=config.expiry_minutes)

    # Create OTP record
    otp_record = OTPVerification(
        email=email,
        otp_code=otp_code,
        purpose=purpose,
        is_verified=False,
        attempts=0,
        created_at=datetime.utcnow(),
        expires_at=expires_at
    )

    db.add(otp_record)
    db.commit()
    db.refresh(otp_record)

    # Send email (in production mode, in dev mode it will just log)
    if not is_dev_mode:
        try:
            send_otp_email(email, otp_code, purpose, config.expiry_minutes)
        except Exception as e:
            logger.error(f"Failed to send OTP email: {str(e)}")
            # Don't raise exception, as we want to return the OTP for retry
            # The email service handles development mode logging internally

    return otp_code, is_dev_mode


def verify_otp(
    db: Session,
    email: str,
    otp_code: str,
    purpose: str = "registration",
    config: Optional[OTPConfig] = None
) -> Tuple[bool, str]:
    """
    Verify an OTP for the given email.

    Args:
        db: Database session
        email: User's email address
        otp_code: OTP code to verify
        purpose: Purpose of OTP (registration, login, password_reset)
        config: OTP configuration (optional)

    Returns:
        Tuple[bool, str]: (is_valid, message)
    """
    if config is None:
        config = get_otp_config()

    # Find the most recent unused OTP for this email and purpose
    otp_record = db.query(OTPVerification).filter(
        OTPVerification.email == email,
        OTPVerification.purpose == purpose,
        OTPVerification.is_verified == False
    ).order_by(OTPVerification.created_at.desc()).first()

    if not otp_record:
        return False, "No valid OTP found. Please request a new one."

    # Check if expired
    if otp_record.is_expired():
        return False, "OTP has expired. Please request a new one."

    # Check max attempts
    if otp_record.max_attempts_reached(config.max_attempts):
        return False, f"Maximum attempts ({config.max_attempts}) reached. Please request a new OTP."

    # Increment attempts
    otp_record.attempts += 1
    db.commit()

    # Verify OTP code
    if otp_record.otp_code != otp_code:
        remaining = config.max_attempts - otp_record.attempts
        return False, f"Invalid OTP. {remaining} attempts remaining."

    # Mark as verified
    otp_record.is_verified = True
    db.commit()

    return True, "OTP verified successfully."


def is_otp_verified(
    db: Session,
    email: str,
    purpose: str = "registration"
) -> bool:
    """
    Check if there's a verified OTP for the given email and purpose.

    Args:
        db: Database session
        email: User's email address
        purpose: Purpose of OTP

    Returns:
        bool: True if verified OTP exists and not expired
    """
    otp_record = db.query(OTPVerification).filter(
        OTPVerification.email == email,
        OTPVerification.purpose == purpose,
        OTPVerification.is_verified == True
    ).order_by(OTPVerification.created_at.desc()).first()

    if not otp_record:
        return False

    # Check if expired (verified OTP should still be within validity period)
    if otp_record.is_expired():
        return False

    return True


def cleanup_expired_otps(db: Session) -> int:
    """
    Remove expired OTP records from the database.

    Args:
        db: Database session

    Returns:
        int: Number of records deleted
    """
    result = db.query(OTPVerification).filter(
        OTPVerification.expires_at < datetime.utcnow()
    ).delete()
    db.commit()
    return result