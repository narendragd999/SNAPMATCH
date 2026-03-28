"""
OTP Schemas for Request/Response Validation
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from enum import Enum


class OTPPurpose(str, Enum):
    REGISTRATION = "registration"
    LOGIN = "login"
    PASSWORD_RESET = "password_reset"


class SendOTPRequest(BaseModel):
    email: EmailStr
    purpose: OTPPurpose = OTPPurpose.REGISTRATION


class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp_code: str = Field(min_length=6, max_length=6)
    purpose: OTPPurpose = OTPPurpose.REGISTRATION
    trust_device: Optional[bool] = False  # Add to trusted devices


class RegisterWithOTPRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    otp_code: str = Field(min_length=6, max_length=6)


class LoginWithOTPRequest(BaseModel):
    email: EmailStr
    password: str
    otp_code: Optional[str] = Field(None, min_length=6, max_length=6)
    device_fingerprint: Optional[str] = None  # For trusted device check
    trust_device: Optional[bool] = False  # Trust this device after OTP


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_fingerprint: Optional[str] = None  # For trusted device check


class TrustedDeviceResponse(BaseModel):
    id: int
    device_name: Optional[str]
    trusted_at: str
    last_used_at: Optional[str]
    is_active: bool


class OTPResponse(BaseModel):
    success: bool
    message: str
    dev_otp: Optional[str] = None  # Only returned in development mode
    otp_required: Optional[bool] = None  # For login: indicates if OTP is needed


class OTPVerificationResponse(BaseModel):
    success: bool
    message: str
    verified: bool
    device_trusted: Optional[bool] = None  # If device was trusted


class OTPConfigResponse(BaseModel):
    otp_required: bool  # True if email provider configured
    dev_mode: bool  # True if no email provider
    otp_length: int
    otp_expiry_minutes: int
    trusted_device: bool  # True if current device is trusted