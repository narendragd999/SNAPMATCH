"""
Authentication Routes with OTP Email Verification

Supports:
- Traditional email/password registration with OTP verification
- Login with optional OTP verification
- Password reset with OTP
- Development mode with common OTP for testing
"""
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy.orm import Session
from app.database.db import SessionLocal
from app.models.user import User
from app.models.otp import OTPVerification
from app.schemas.auth_schema import RegisterRequest, LoginRequest, TokenResponse
from app.schemas.otp_schema import (
    SendOTPRequest, VerifyOTPRequest, RegisterWithOTPRequest,
    LoginWithOTPRequest, OTPResponse, OTPVerificationResponse
)
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    create_reset_token,
    verify_token
)
from app.core.dependencies import get_current_user, get_db
from app.core.config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from app.services.email_service import send_email
from app.services.otp_service import (
    create_otp, verify_otp, get_otp_config, is_otp_verified
)
from app.api.analytics_routes import log_activity
import os
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------- SEND OTP ----------------
@router.post("/send-otp", response_model=OTPResponse)
def send_otp_endpoint(
    data: SendOTPRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Send OTP to email for verification.

    In development mode (SMTP not configured), returns a common OTP for testing.
    In production mode, sends a unique OTP to the user's email.
    """
    # For registration: check if email already exists
    if data.purpose == "registration":
        if db.query(User).filter(User.email == data.email).first():
            raise HTTPException(status_code=400, detail="Email already registered")

    # For login/password_reset: check if user exists
    if data.purpose in ["login", "password_reset"]:
        user = db.query(User).filter(User.email == data.email).first()
        if not user:
            # Don't reveal if email exists or not for security
            return OTPResponse(
                success=True,
                message="If the email exists, an OTP has been sent."
            )

    # Create and send OTP
    otp_code, is_dev_mode = create_otp(db, data.email, data.purpose.value)

    # Log activity
    log_activity(
        db=db,
        activity_type="otp_sent",
        action=f"otp_sent_for_{data.purpose.value}",
        user_id=None,
        description=f"OTP sent to {data.email} for {data.purpose.value}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/send-otp",
        request_method="POST",
    )

    return OTPResponse(
        success=True,
        message="OTP sent successfully. Please check your email." if not is_dev_mode else "Development mode: Use the common OTP.",
        dev_otp=otp_code if is_dev_mode else None
    )


# ---------------- VERIFY OTP ----------------
@router.post("/verify-otp", response_model=OTPVerificationResponse)
def verify_otp_endpoint(
    data: VerifyOTPRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Verify OTP code.

    Returns success/failure status with remaining attempts if failed.
    """
    is_valid, message = verify_otp(db, data.email, data.otp_code, data.purpose.value)

    if is_valid:
        log_activity(
            db=db,
            activity_type="otp_verified",
            action=f"otp_verified_for_{data.purpose.value}",
            user_id=None,
            description=f"OTP verified for {data.email}",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_path="/auth/verify-otp",
            request_method="POST",
        )

    return OTPVerificationResponse(
        success=is_valid,
        message=message,
        verified=is_valid
    )


# ---------------- REGISTER WITH OTP ----------------
@router.post("/register", response_model=TokenResponse)
def register(data: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Register a new user.

    For development/testing, allows direct registration without OTP if SMTP is not configured.
    For production, OTP verification is recommended via /auth/send-otp first.
    """
    # Check if email already exists
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        plan_type="free"
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,   # Change to True for production
        samesite="lax"
    )

    # Log activity
    log_activity(
        db=db,
        activity_type="login",
        action="user_registered",
        user_id=user.id,
        description=f"New user registered with email: {user.email}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/register",
        request_method="POST",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "plan_type": user.plan_type,
            "role": user.role
        }
    }


# ---------------- REGISTER WITH OTP VERIFICATION ----------------
@router.post("/register-with-otp", response_model=TokenResponse)
def register_with_otp(
    data: RegisterWithOTPRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Register a new user with OTP verification.

    Requires:
    1. Email and password
    2. Valid OTP code (obtained via /auth/send-otp)

    This is the recommended registration flow for production.
    """
    # Check if email already exists
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Check if OTP was already verified (frontend calls verify-otp first)
    # OR verify it now if not already verified
    if is_otp_verified(db, data.email, "registration"):
        # OTP was already verified by frontend call to /auth/verify-otp
        pass
    else:
        # Try to verify the OTP now
        is_valid, message = verify_otp(db, data.email, data.otp_code, "registration")
        if not is_valid:
            raise HTTPException(status_code=400, detail=message)

    # Create user
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        plan_type="free",
        email_verified=True  # Mark email as verified since OTP was verified
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,
        samesite="lax"
    )

    # Log activity
    log_activity(
        db=db,
        activity_type="login",
        action="user_registered_with_otp",
        user_id=user.id,
        description=f"New user registered with OTP verification: {user.email}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/register-with-otp",
        request_method="POST",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "plan_type": user.plan_type,
            "role": user.role,
            "email_verified": True
        }
    }


# ---------------- LOGIN ----------------
@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):

    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(data.password, user.password_hash):
        # Log failed login attempt
        log_activity(
            db=db,
            activity_type="login_failed",
            action="invalid_credentials",
            user_id=user.id if user else None,
            description=f"Failed login attempt for email: {data.email}",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_path="/auth/login",
            request_method="POST",
            status="failed",
            error_message="Invalid email or password"
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,   # Change to True for production
        samesite="lax"
    )

    # Log successful login
    log_activity(
        db=db,
        activity_type="login",
        action="user_logged_in",
        user_id=user.id,
        description=f"User logged in: {user.email}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/login",
        request_method="POST",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "plan_type": user.plan_type,
            "role": user.role
        }
    }


# ---------------- LOGIN WITH OTP ----------------
@router.post("/login-with-otp", response_model=TokenResponse)
def login_with_otp(
    data: LoginWithOTPRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Login with optional OTP verification.

    If OTP is provided, verifies OTP before allowing login.
    This adds an extra layer of security for sensitive operations.
    """
    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(data.password, user.password_hash):
        log_activity(
            db=db,
            activity_type="login_failed",
            action="invalid_credentials",
            user_id=user.id if user else None,
            description=f"Failed login attempt for email: {data.email}",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_path="/auth/login-with-otp",
            request_method="POST",
            status="failed",
            error_message="Invalid email or password"
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # If OTP is provided, verify it
    if data.otp_code:
        is_valid, message = verify_otp(db, data.email, data.otp_code, "login")
        if not is_valid:
            raise HTTPException(status_code=401, detail=message)

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,
        samesite="lax"
    )

    log_activity(
        db=db,
        activity_type="login",
        action="user_logged_in_with_otp" if data.otp_code else "user_logged_in",
        user_id=user.id,
        description=f"User logged in {'with OTP' if data.otp_code else ''}: {user.email}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/login-with-otp",
        request_method="POST",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "plan_type": user.plan_type,
            "role": user.role
        }
    }


# ---------------- REFRESH ----------------
@router.post("/refresh")
def refresh_token(request: Request):

    token = request.cookies.get("refresh_token")

    if not token:
        raise HTTPException(status_code=401)

    payload = verify_token(token)

    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401)

    user_id = int(payload.get("sub"))

    new_access_token = create_access_token(user_id)

    return {"access_token": new_access_token}


# ---------------- LOGOUT ----------------
@router.post("/logout")
def logout(request: Request, response: Response, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):

    response.delete_cookie("refresh_token")

    # Log logout
    log_activity(
        db=db,
        activity_type="logout",
        action="user_logged_out",
        user_id=current_user.id,
        description=f"User logged out: {current_user.email}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/logout",
        request_method="POST",
    )

    return {"message": "Logged out successfully"}


# ---------------- ME ----------------
@router.get("/me")
def me(current_user: User = Depends(get_current_user)):

    return {
        "id": current_user.id,
        "email": current_user.email,
        "plan_type": current_user.plan_type
    }


# ---------------------------------------
# Forgot Password - Send OTP
# ---------------------------------------
@router.post("/forgot-password", response_model=OTPResponse)
def forgot_password(
    email: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Initiate password reset by sending OTP to email.

    In development mode, returns a common OTP for testing.
    """
    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    user = db.query(User).filter(User.email == email).first()

    # Always return same response (security)
    if not user:
        return OTPResponse(
            success=True,
            message="If the email exists, an OTP has been sent."
        )

    # Create and send OTP for password reset
    otp_code, is_dev_mode = create_otp(db, email, "password_reset")

    log_activity(
        db=db,
        activity_type="password_reset",
        action="reset_otp_sent",
        user_id=user.id,
        description=f"Password reset OTP sent to: {email}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/forgot-password",
        request_method="POST",
    )

    return OTPResponse(
        success=True,
        message="If the email exists, an OTP has been sent.",
        dev_otp=otp_code if is_dev_mode else None
    )


# ---------------------------------------
# Reset Password with OTP
# ---------------------------------------
@router.post("/reset-password")
def reset_password(
    email: str,
    otp_code: str,
    new_password: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Reset password using OTP verification.

    Requires:
    - Email address
    - Valid OTP code (obtained via /auth/forgot-password)
    - New password
    """
    if not email or not otp_code or not new_password:
        raise HTTPException(status_code=400, detail="Email, OTP, and new password are required")

    # Verify OTP
    is_valid, message = verify_otp(db, email, otp_code, "password_reset")

    if not is_valid:
        raise HTTPException(status_code=400, detail=message)

    # Find user
    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    # Update password
    user.password_hash = hash_password(new_password)
    db.commit()

    log_activity(
        db=db,
        activity_type="password_reset",
        action="password_reset_completed",
        user_id=user.id,
        description=f"Password reset completed for: {email}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_path="/auth/reset-password",
        request_method="POST",
    )

    return {"message": "Password reset successful"}


# ---------------------------------------
# Check OTP Configuration (for frontend)
# ---------------------------------------
@router.get("/otp-config")
def get_otp_configuration():
    """
    Get OTP configuration status.

    Returns whether OTP is required and if development mode is active.
    Frontend can use this to determine which auth flow to use.
    """
    config = get_otp_config()
    return {
        "otp_required": not config.is_development_mode,
        "dev_mode": config.is_development_mode,
        "otp_length": config.otp_length,
        "otp_expiry_minutes": config.expiry_minutes
    }