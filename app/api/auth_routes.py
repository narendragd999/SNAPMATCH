from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy.orm import Session
from app.database.db import SessionLocal
from app.models.user import User
from app.schemas.auth_schema import RegisterRequest, LoginRequest, TokenResponse
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    create_reset_token,
    verify_token
)
from app.core.dependencies import get_current_user, get_db
from app.services.email_service import send_email
import os

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------- REGISTER ----------------
@router.post("/register", response_model=TokenResponse)
def register(data: RegisterRequest, response: Response, db: Session = Depends(get_db)):

    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

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
        secure=False,   # ← change True to False for localhost
        samesite="lax"
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "plan_type": user.plan_type,            
            "role": user.role        # ← add this
        }
    }


# ---------------- LOGIN ----------------
@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, response: Response, db: Session = Depends(get_db)):

    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=False,   # ← change True to False for localhost
        samesite="lax"
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "plan_type": user.plan_type,
            "role": user.role        # ← add this
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
def logout(response: Response):

    response.delete_cookie("refresh_token")

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
# Forgot Password
# ---------------------------------------
@router.post("/forgot-password")
def forgot_password(email: str, db: Session = Depends(get_db)):

    if not email:
        raise HTTPException(status_code=400, detail="Email required")

    user = db.query(User).filter(User.email == email).first()

    # Always return same response (security)
    if not user:
        return {"message": "If the email exists, a reset link has been sent."}

    token = create_reset_token(email)

    frontend_url = os.getenv("FRONTEND_URL")

    if not frontend_url:
        raise HTTPException(status_code=500, detail="FRONTEND_URL not configured")

    reset_link = f"{frontend_url}/reset-password?token={token}"

    html_content = f"""
    <div style="font-family:Arial,sans-serif">
        <h2>Password Reset Request</h2>
        <p>Click below to reset your password:</p>
        <a href="{reset_link}" 
           style="display:inline-block;padding:12px 20px;
                  background:#3498db;color:white;
                  text-decoration:none;border-radius:6px;">
           Reset Password
        </a>
        <p>This link expires in 30 minutes.</p>
    </div>
    """

    try:
        send_email(
            to_email=email,
            subject="Reset Your SnapFind AI Password",
            html_content=html_content
        )
    except Exception as e:
        print("Email sending failed:", str(e))
        raise HTTPException(status_code=500, detail="Email service unavailable")

    return {"message": "If the email exists, a reset link has been sent."}


# ---------------------------------------
# Reset Password
# ---------------------------------------
@router.post("/reset-password")
def reset_password(token: str, new_password: str, db: Session = Depends(get_db)):

    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new password required")

    payload = verify_token(token)

    if not payload or payload.get("type") != "reset":
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    email = payload.get("sub")


    if not email:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    user.password_hash = hash_password(new_password)
    db.commit()

    return {"message": "Password reset successful"}