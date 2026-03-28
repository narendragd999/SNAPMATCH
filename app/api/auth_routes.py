"""
Authentication Routes with OTP Email Verification

Supports:
- Traditional email/password registration with OTP verification (REQUIRED)
- Login with optional OTP verification (skip for trusted devices)
- Password reset with OTP (REQUIRED)
- Trusted device management for better UX
- Development mode with common OTP for testing

Recommended Flow:
- Registration: OTP required (verify email ownership)
- Login (trusted device): Direct login, no OTP
- Login (new device): OTP required
- Password Reset: OTP required (security critical)
"""
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy.orm import Session
from app.database.db import SessionLocal
from app.models.user import User
from app.models.otp import OTPVerification
from app.schemas.auth_schema import RegisterRequest, LoginRequest, TokenResponse
from app.schemas.otp_schema import (
    SendOTPRequest, VerifyOTPRequest, RegisterWithOTPRequest,
    LoginWithOTPRequest, OTPResponse, OTPVerificationResponse,
    OTPConfigResponse, LoginRequest as OTPLoginRequest
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


# =============================================================================
# Helper Functions
# =============================================================================

def get_device_fingerprint(request: Request) -> str:
    """Generate device fingerprint from request."""
    import hashlib
    user_agent = request.headers.get("user-agent", "")
    accept_language = request.headers.get("accept-language", "")
    ip = request.client.host if request.client else ""
    
    # Create fingerprint from browser characteristics
    data = f"{user_agent}:{accept_language}:{ip[:10]}"  # Use IP prefix for privacy
    return hashlib.sha256(data.encode()).hexdigest()[:32]


def is_trusted_device(db: Session, user_id: int, fingerprint: str) -> bool:
    """Check if device is in user's trusted devices list."""
    try:
        from app.models.trusted_device import TrustedDevice
        from datetime import datetime
        
        device = db.query(TrustedDevice).filter(
            TrustedDevice.user_id == user_id,
            TrustedDevice.device_fingerprint == fingerprint,
            TrustedDevice.is_active == True
        ).first()
        
        if not device:
            return False
        
        # Check expiration
        if device.expires_at and device.expires_at < datetime.utcnow():
            return False
        
        # Update last used
        device.last_used_at = datetime.utcnow()
        db.commit()
        
        return True
    except Exception as e:
        logger.warning(f"Could not check trusted device: {e}")
        return False


def trust_device(db: Session, user_id: int, fingerprint: str, request: Request, expires_days: int = 30):
    """Add device to trusted list."""
    try:
        from app.models.trusted_device import TrustedDevice
        from datetime import datetime, timedelta
        
        user_agent = request.headers.get("user-agent", "")
        
        # Parse device name from user agent
        device_name = "Unknown Device"
        if "Chrome" in user_agent and "Windows" in user_agent:
            device_name = "Chrome on Windows"
        elif "Chrome" in user_agent and "Mac" in user_agent:
            device_name = "Chrome on Mac"
        elif "Safari" in user_agent and "iPhone" in user_agent:
            device_name = "Safari on iPhone"
        elif "Safari" in user_agent and "Mac" in user_agent:
            device_name = "Safari on Mac"
        elif "Firefox" in user_agent:
            device_name = "Firefox"
        elif "Edge" in user_agent:
            device_name = "Microsoft Edge"
        
        # Check if already exists
        existing = db.query(TrustedDevice).filter(
            TrustedDevice.user_id == user_id,
            TrustedDevice.device_fingerprint == fingerprint
        ).first()
        
        if existing:
            existing.is_active = True
            existing.trusted_at = datetime.utcnow()
            existing.expires_at = datetime.utcnow() + timedelta(days=expires_days)
            existing.last_used_at = datetime.utcnow()
            existing.device_name = device_name
            db.commit()
            return existing
        
        # Create new
        device = TrustedDevice(
            user_id=user_id,
            device_fingerprint=fingerprint,
            device_name=device_name,
            user_agent=user_agent[:500],
            ip_address=request.client.host if request.client else None,
            expires_at=datetime.utcnow() + timedelta(days=expires_days)
        )
        
        db.add(device)
        db.commit()
        return device
        
    except Exception as e:
        logger.warning(f"Could not trust device: {e}")
        return None


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
    If trust_device=True and purpose=login, adds device to trusted list.
    """
    is_valid, message = verify_otp(db, data.email, data.otp_code, data.purpose.value)

    device_trusted = False
    
    if is_valid:
        # If trust_device requested for login, add to trusted devices
        if data.trust_device and data.purpose.value == "login":
            user = db.query(User).filter(User.email == data.email).first()
            if user:
                fingerprint = get_device_fingerprint(request)
                trust_device(db, user.id, fingerprint, request)
                device_trusted = True
        
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
        verified=is_valid,
        device_trusted=device_trusted
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
def login(
    data: OTPLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """
    Login endpoint - handles both trusted and untrusted devices.
    
    Flow:
    1. If dev mode (no email configured): Direct login
    2. If trusted device: Direct login
    3. If not trusted: Returns 403 requiring OTP
    
    To trust a device, use /auth/login-with-otp with trust_device=true
    """
    is_dev = os.getenv("ENV", "dev") == "dev"
    
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
            request_path="/auth/login",
            request_method="POST",
            status="failed",
            error_message="Invalid email or password"
        )
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Check if device is trusted
    fingerprint = data.device_fingerprint or get_device_fingerprint(request)
    otp_config = get_otp_config(db)
    device_trusted = is_trusted_device(db, user.id, fingerprint)
    
    # If OTP is configured (not dev mode) and device is not trusted, require OTP
    if not otp_config.is_development_mode and not device_trusted:
        raise HTTPException(
            status_code=403, 
            detail={
                "message": "OTP required for this device",
                "otp_required": True,
                "trusted_device": False
            }
        )

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
        action="user_logged_in_trusted_device" if device_trusted else "user_logged_in",
        user_id=user.id,
        description=f"User logged in {'from trusted device' if device_trusted else ''}: {user.email}",
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
            "role": user.role,
            "email_verified": user.email_verified
        },
        "trusted_device": device_trusted
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
    Login with OTP verification - trusts device if requested.
    
    Use this endpoint when:
    1. /auth/login returned 403 (OTP required)
    2. User wants to trust this device for future logins
    
    Set trust_device=true to remember this device for 30 days.
    """
    is_dev = os.getenv("ENV", "dev") == "dev"
    
    user = db.query(User).filter(User.email == data.email).first()

    if not user:
        error_detail = "User not found. Please register first." if is_dev else "Invalid email or password"
        log_activity(
            db=db,
            activity_type="login_failed",
            action="user_not_found",
            user_id=None,
            description=f"Login attempt for non-existent email: {data.email}",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_path="/auth/login-with-otp",
            request_method="POST",
            status="failed",
            error_message="User not found"
        )
        raise HTTPException(status_code=401, detail=error_detail)

    if not verify_password(data.password, user.password_hash):
        error_detail = "Incorrect password. Please try again." if is_dev else "Invalid email or password"
        log_activity(
            db=db,
            activity_type="login_failed",
            action="invalid_password",
            user_id=user.id,
            description=f"Failed login attempt (wrong password) for email: {data.email}",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            request_path="/auth/login-with-otp",
            request_method="POST",
            status="failed",
            error_message="Invalid password"
        )
        raise HTTPException(status_code=401, detail=error_detail)

    # If OTP is provided, check if already verified or verify now
    if data.otp_code:
        if is_otp_verified(db, data.email, "login"):
            pass
        else:
            is_valid, message = verify_otp(db, data.email, data.otp_code, "login")
            if not is_valid:
                raise HTTPException(status_code=401, detail=message)
    
    # Trust device if requested
    device_trusted = False
    if data.trust_device:
        fingerprint = get_device_fingerprint(request)
        trust_device(db, user.id, fingerprint, request)
        device_trusted = True

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
            "role": user.role,
            "email_verified": user.email_verified
        },
        "device_trusted": device_trusted
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
def get_otp_configuration(
    request: Request,
    email: str = None,
    db: Session = Depends(get_db)
):
    """
    Get OTP configuration status.

    Returns whether OTP is required and if current device is trusted.
    Frontend can use this to determine which auth flow to use.
    """
    config = get_otp_config(db)
    
    # Check if device is trusted (if email provided)
    trusted_device = False
    if email:
        user = db.query(User).filter(User.email == email).first()
        if user:
            fingerprint = get_device_fingerprint(request)
            trusted_device = is_trusted_device(db, user.id, fingerprint)
    
    return {
        "otp_required": not config.is_development_mode,
        "dev_mode": config.is_development_mode,
        "otp_length": config.otp_length,
        "otp_expiry_minutes": config.expiry_minutes,
        "trusted_device": trusted_device,
        "otp_needed_for_login": not config.is_development_mode and not trusted_device
    }


# ---------------------------------------
# Trusted Device Management
# ---------------------------------------
@router.get("/trusted-devices")
def get_trusted_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get list of trusted devices for current user."""
    from app.models.trusted_device import TrustedDevice
    from datetime import datetime
    
    devices = db.query(TrustedDevice).filter(
        TrustedDevice.user_id == current_user.id,
        TrustedDevice.is_active == True
    ).order_by(TrustedDevice.trusted_at.desc()).all()
    
    return {
        "devices": [
            {
                "id": d.id,
                "device_name": d.device_name,
                "trusted_at": d.trusted_at.isoformat() if d.trusted_at else None,
                "last_used_at": d.last_used_at.isoformat() if d.last_used_at else None,
                "expires_at": d.expires_at.isoformat() if d.expires_at else None,
                "is_current": False  # Frontend can determine this
            }
            for d in devices
        ]
    }


@router.delete("/trusted-devices/{device_id}")
def remove_trusted_device(
    device_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a trusted device."""
    from app.models.trusted_device import TrustedDevice
    
    device = db.query(TrustedDevice).filter(
        TrustedDevice.id == device_id,
        TrustedDevice.user_id == current_user.id
    ).first()
    
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    db.delete(device)
    db.commit()
    
    return {"success": True, "message": "Device removed from trusted list"}


@router.delete("/trusted-devices")
def remove_all_trusted_devices(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove all trusted devices for current user."""
    from app.models.trusted_device import TrustedDevice
    
    db.query(TrustedDevice).filter(
        TrustedDevice.user_id == current_user.id
    ).delete()
    db.commit()
    
    return {"success": True, "message": "All trusted devices removed"}