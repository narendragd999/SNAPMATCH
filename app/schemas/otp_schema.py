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


class RegisterWithOTPRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    otp_code: str = Field(min_length=6, max_length=6)


class LoginWithOTPRequest(BaseModel):
    email: EmailStr
    password: str
    otp_code: Optional[str] = Field(None, min_length=6, max_length=6)


class OTPResponse(BaseModel):
    success: bool
    message: str
    dev_otp: Optional[str] = None  # Only returned in development mode


class OTPVerificationResponse(BaseModel):
    success: bool
    message: str
    verified: bool