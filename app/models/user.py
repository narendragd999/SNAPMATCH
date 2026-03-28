from sqlalchemy import Column, Integer, String, DateTime, Boolean
from app.database.db import Base
from datetime import datetime


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    email         = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role          = Column(String, default="owner")
    plan_type     = Column(String, default="pro")
    created_at    = Column(DateTime, default=datetime.utcnow)

    # ── NEW: billing ──────────────────────────────────────────────────────────
    # Tracks whether this user has consumed their one free event.
    # Once True, creating another event requires payment.
    free_event_used = Column(Boolean, default=False, nullable=False)

    # ── NEW: email verification ─────────────────────────────────────────────────
    # Tracks whether the user's email has been verified via OTP
    email_verified = Column(Boolean, default=False, nullable=False)
