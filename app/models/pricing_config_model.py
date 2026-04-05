"""
app/models/pricing_config.py

Dedicated pricing configuration table.
One row per config version — only the latest row (highest id) is active.
Admin updates create a new row (full audit trail) or update in-place.

All monetary values stored in PAISE (INR × 100).
Tiers stored as JSONB for flexibility without schema changes.
"""
from sqlalchemy import Column, Integer, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.database.db import Base


class PricingConfig(Base):
    __tablename__ = "pricing_config"

    id         = Column(Integer, primary_key=True, index=True)

    # ── Free tier ──────────────────────────────────────────────────────────────
    free_photo_quota   = Column(Integer, nullable=False, default=50)
    free_guest_quota   = Column(Integer, nullable=False, default=10)
    free_validity_days = Column(Integer, nullable=False, default=7)

    # ── Paid tier limits ───────────────────────────────────────────────────────
    min_photo_quota    = Column(Integer, nullable=False, default=50)
    max_photo_quota    = Column(Integer, nullable=False, default=10000)
    min_guest_quota    = Column(Integer, nullable=False, default=0)
    max_guest_quota    = Column(Integer, nullable=False, default=1000)

    # ── Base fee ───────────────────────────────────────────────────────────────
    base_event_fee_paise = Column(Integer, nullable=False, default=9900)

    # ── Tiered rates (JSONB) ───────────────────────────────────────────────────
    # Format: [{"bucket": 500, "rate_paise": 20}, ..., {"bucket": null, "rate_paise": 7}]
    photo_tiers = Column(JSON, nullable=False, default=lambda: [
        {"bucket": 500,  "rate_paise": 20},
        {"bucket": 500,  "rate_paise": 15},
        {"bucket": 2000, "rate_paise": 10},
        {"bucket": None, "rate_paise": 7},
    ])

    guest_tiers = Column(JSON, nullable=False, default=lambda: [
        {"bucket": 50,   "rate_paise": 10},
        {"bucket": 150,  "rate_paise": 8},
        {"bucket": 300,  "rate_paise": 6},
        {"bucket": None, "rate_paise": 4},
    ])

    # ── Validity options (JSONB) ───────────────────────────────────────────────
    # Format: [{"days": 30, "addon_paise": 0, "included": true}, ...]
    validity_options = Column(JSON, nullable=False, default=lambda: [
        {"days": 30,  "addon_paise": 0,     "included": True},
        {"days": 90,  "addon_paise": 4900,  "included": False},
        {"days": 365, "addon_paise": 14900, "included": False},
    ])

    # ── Meta ───────────────────────────────────────────────────────────────────
    is_active  = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
