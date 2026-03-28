"""
app/models/user_activity_log.py

User Activity Log Model — Track user activities for audit and analytics.

Tracks:
  - User logins
  - Event creations
  - Payment attempts
  - Admin actions
  - Other important activities
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Index
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime


class UserActivityLog(Base):
    """Log of user activities for audit trail and analytics."""
    __tablename__ = "user_activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    
    # User who performed the action (nullable if action is anonymous/failed auth)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # ── Activity Details ───────────────────────────────────────────────
    activity_type = Column(String(50), nullable=False, index=True)  # login, logout, event_create, payment, etc.
    action        = Column(String(100), nullable=False)  # specific action taken
    description   = Column(Text, nullable=True)          # detailed description
    
    # ── Related Entities ───────────────────────────────────────────────
    event_id      = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True)
    order_id      = Column(Integer, ForeignKey("event_orders.id", ondelete="SET NULL"), nullable=True)
    
    # ── Request Context ────────────────────────────────────────────────
    ip_address    = Column(String(45), nullable=True)    # IPv6 compatible
    user_agent    = Column(String(500), nullable=True)   # Browser info
    request_path  = Column(String(500), nullable=True)   # API endpoint called
    request_method = Column(String(10), nullable=True)   # GET, POST, etc.
    
    # ── Status ──────────────────────────────────────────────────────────
    status        = Column(String(20), default="success", nullable=False)  # success, failed, error
    error_message = Column(Text, nullable=True)
    
    # ── Additional Data ─────────────────────────────────────────────────
    metadata_json = Column(Text, nullable=True)  # JSON string for additional data
    
    # ── Timestamp ──────────────────────────────────────────────────────
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    
    # Relationship
    user = relationship("User", backref="activity_logs")
    event = relationship("Event", backref="activity_logs")
    
    # Indexes for common queries
    __table_args__ = (
        Index('ix_user_activity_logs_user_created', 'user_id', 'created_at'),
        Index('ix_user_activity_logs_type_created', 'activity_type', 'created_at'),
    )


# ── Activity Type Constants ────────────────────────────────────────────────────

class ActivityType:
    """Constants for activity types."""
    
    # Authentication
    LOGIN           = "login"
    LOGOUT          = "logout"
    LOGIN_FAILED    = "login_failed"
    PASSWORD_RESET  = "password_reset"
    
    # OTP Verification
    OTP_SENT        = "otp_sent"
    OTP_VERIFIED    = "otp_verified"
    OTP_FAILED      = "otp_failed"
    
    # Event Management
    EVENT_CREATE    = "event_create"
    EVENT_UPDATE    = "event_update"
    EVENT_DELETE    = "event_delete"
    EVENT_VIEW      = "event_view"
    
    # Photo Management
    PHOTO_UPLOAD    = "photo_upload"
    PHOTO_DELETE    = "photo_delete"
    PHOTO_DOWNLOAD  = "photo_download"
    
    # Face Search
    FACE_SEARCH     = "face_search"
    FACE_MATCH      = "face_match"
    
    # Guest Uploads
    GUEST_UPLOAD    = "guest_upload"
    GUEST_APPROVE   = "guest_approve"
    GUEST_REJECT    = "guest_reject"
    
    # Payments
    PAYMENT_INITIATE = "payment_initiate"
    PAYMENT_SUCCESS  = "payment_success"
    PAYMENT_FAILED   = "payment_failed"
    PAYMENT_REFUND   = "payment_refund"
    
    # Free Events
    FREE_EVENT_CREATE = "free_event_create"
    
    # Admin Actions
    ADMIN_USER_CREATE  = "admin_user_create"
    ADMIN_USER_UPDATE  = "admin_user_update"
    ADMIN_USER_DELETE  = "admin_user_delete"
    ADMIN_EVENT_DELETE = "admin_event_delete"
    ADMIN_CONFIG_CHANGE = "admin_config_change"
    ADMIN_CLEANUP_RUN  = "admin_cleanup_run"
    
    # Public Access
    PUBLIC_PAGE_VIEW   = "public_page_view"
    PUBLIC_SELFIE_UPLOAD = "public_selfie_upload"