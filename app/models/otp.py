"""
OTP Model for Email Verification

Stores OTP codes for email verification during registration and login.
Supports both production (unique OTP per user) and development (common OTP) modes.
"""
from sqlalchemy import Column, Integer, String, DateTime, Boolean
from app.database.db import Base
from datetime import datetime


class OTPVerification(Base):
    __tablename__ = "otp_verifications"

    id            = Column(Integer, primary_key=True, index=True)
    email         = Column(String, index=True, nullable=False)
    otp_code      = Column(String(6), nullable=False)
    purpose       = Column(String, default="registration")  # registration, login, password_reset
    is_verified   = Column(Boolean, default=False)
    attempts      = Column(Integer, default=0)  # Track verification attempts
    created_at    = Column(DateTime, default=datetime.utcnow)
    expires_at    = Column(DateTime, nullable=False)

    def is_expired(self) -> bool:
        """Check if the OTP has expired"""
        return datetime.utcnow() > self.expires_at

    def max_attempts_reached(self, max_attempts: int = 5) -> bool:
        """Check if maximum verification attempts reached"""
        return self.attempts >= max_attempts
