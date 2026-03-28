from pydantic import BaseModel, EmailStr, Field
from typing import Optional


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: dict


class OTPConfigResponse(BaseModel):
    otp_required: bool
    dev_mode: bool
    otp_length: int
    otp_expiry_minutes: int
