"""
app/models/event_order.py

EventOrder — billing ledger.

One row per Razorpay order.  Created when the user clicks "Pay",
updated when payment is captured (via webhook or verify endpoint).

Lifecycle:
  created  → order created, Razorpay checkout not yet completed
  paid     → payment captured, event activated
  failed   → payment failed / order expired in Razorpay
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime


class EventOrder(Base):
    __tablename__ = "event_orders"

    id = Column(Integer, primary_key=True, index=True)

    # ── Foreign keys ──────────────────────────────────────────────────────────
    user_id  = Column(Integer, ForeignKey("users.id",  ondelete="SET NULL"), nullable=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True)

    # ── Razorpay identifiers ──────────────────────────────────────────────────
    razorpay_order_id   = Column(String, unique=True, index=True, nullable=True)
    razorpay_payment_id = Column(String, nullable=True)
    razorpay_signature  = Column(String, nullable=True)

    # ── What was purchased ────────────────────────────────────────────────────
    amount_paise  = Column(Integer, nullable=False)
    photo_quota   = Column(Integer, nullable=False)
    guest_quota   = Column(Integer, nullable=False, default=0)
    validity_days = Column(Integer, nullable=False, default=30)
    event_name    = Column(String, nullable=True)   # snapshot of event name at time of order

    # ── Status ────────────────────────────────────────────────────────────────
    # created | paid | failed
    status = Column(String, default="created", nullable=False)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at = Column(DateTime, default=datetime.utcnow)
    paid_at    = Column(DateTime, nullable=True)

    # ── Relationship (back-ref) ───────────────────────────────────────────────
    event = relationship("Event", back_populates="orders")
