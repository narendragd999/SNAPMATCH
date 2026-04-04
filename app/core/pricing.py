"""
app/core/pricing.py

Pay-per-event pricing engine.
All monetary values are in PAISE (INR × 100) internally.

Single source of truth: pricing_config DB table (app/models/pricing_config.py)
  - Admin updates via PUT /api/pricing/config
  - Backend reads DB via get_pricing_config(db) / calculate_price(..., db=db)
  - Frontend fetches via GET /pricing/config  — no JSON files, no static imports

Two event types:
  - Free:          limits from pricing_config table (get_free_tier_config)
  - Pay-per-event: quota/validity chosen by owner at purchase, stored on event.*
"""

from __future__ import annotations
from typing import TypedDict


# ── Hardcoded fallbacks ───────────────────────────────────────────────────────
# Used ONLY when DB table is empty on first boot (before migration seeds the row).
# These match the migration seed values exactly so the first-boot experience
# is identical to the post-migration experience.

_DEFAULTS = {
    "free_photo_quota":      500,
    "free_guest_quota":      100,
    "free_validity_days":    7,
    "min_photo_quota":       50,
    "max_photo_quota":       10000,
    "min_guest_quota":       0,
    "max_guest_quota":       1000,
    "base_event_fee_paise":  9900,
    "photo_tiers": [
        {"bucket": 500,  "rate_paise": 20},
        {"bucket": 500,  "rate_paise": 15},
        {"bucket": 2000, "rate_paise": 10},
        {"bucket": None, "rate_paise": 7},
    ],
    "guest_tiers": [
        {"bucket": 50,   "rate_paise": 10},
        {"bucket": 150,  "rate_paise": 8},
        {"bucket": 300,  "rate_paise": 6},
        {"bucket": None, "rate_paise": 4},
    ],
    "validity_options": [
        {"days": 30,  "addon_paise": 0,     "included": True},
        {"days": 90,  "addon_paise": 4900,  "included": False},
        {"days": 365, "addon_paise": 14900, "included": False},
    ],
}


def _get_active(db):
    """
    Return the active PricingConfig row.
    Auto-seeds one default row if the table is empty (first boot before migration).
    """
    from app.models.pricing_config import PricingConfig

    row = (
        db.query(PricingConfig)
        .filter(PricingConfig.is_active == True)
        .order_by(PricingConfig.id.desc())
        .first()
    )

    if not row:
        row = PricingConfig(**{k: v for k, v in _DEFAULTS.items()})
        db.add(row)
        db.commit()
        db.refresh(row)

    return row


# ── Public helpers ────────────────────────────────────────────────────────────

def get_free_tier_config(db) -> dict:
    """Returns free tier quotas from DB. Used by billing_routes.create_free_event."""
    row = _get_active(db)
    return {
        "photo_quota":   row.free_photo_quota,
        "guest_quota":   row.free_guest_quota,
        "validity_days": row.free_validity_days,
        "is_free_tier":  True,
        "amount_paise":  0,
    }


def get_full_config(db) -> dict:
    """
    Full config dict served by GET /pricing/config to the frontend.
    Also used by GET /billing/price-config for backward compat.
    """
    row = _get_active(db)
    return {
        "id": row.id,
        "free_tier": {
            "photo_quota":   row.free_photo_quota,
            "guest_quota":   row.free_guest_quota,
            "validity_days": row.free_validity_days,
        },
        "paid_tier": {
            "min_photo_quota":      row.min_photo_quota,
            "max_photo_quota":      row.max_photo_quota,
            "min_guest_quota":      row.min_guest_quota,
            "max_guest_quota":      row.max_guest_quota,
            "base_event_fee_paise": row.base_event_fee_paise,
        },
        "photo_tiers":      row.photo_tiers,
        "guest_tiers":      row.guest_tiers,
        "validity_options": row.validity_options,
        "updated_at":       row.updated_at.isoformat() if row.updated_at else None,
    }


# ── Backward-compat module-level constants ────────────────────────────────────
# All existing code that imports these names at module level continues to work.
# Values come from _DEFAULTS (not DB) — good enough for validation decorators
# on Pydantic models which run at import time before a DB session exists.
# For live values at request time, always use calculate_price(..., db=db).

FREE_TIER_DEFAULTS = {
    "free_photo_quota":   _DEFAULTS["free_photo_quota"],
    "free_guest_quota":   _DEFAULTS["free_guest_quota"],
    "free_validity_days": _DEFAULTS["free_validity_days"],
}

FREE_TIER_CONFIG = {
    "photo_quota":   _DEFAULTS["free_photo_quota"],
    "guest_quota":   _DEFAULTS["free_guest_quota"],
    "validity_days": _DEFAULTS["free_validity_days"],
    "is_free_tier":  True,
    "amount_paise":  0,
}

MIN_PHOTO_QUOTA      = _DEFAULTS["min_photo_quota"]
MAX_PHOTO_QUOTA      = _DEFAULTS["max_photo_quota"]
MIN_GUEST_QUOTA      = _DEFAULTS["min_guest_quota"]
MAX_GUEST_QUOTA      = _DEFAULTS["max_guest_quota"]
BASE_EVENT_FEE_PAISE = _DEFAULTS["base_event_fee_paise"]

PHOTO_TIERS: list[tuple[int | None, int]] = [
    (t["bucket"], t["rate_paise"]) for t in _DEFAULTS["photo_tiers"]
]
GUEST_TIERS: list[tuple[int | None, int]] = [
    (t["bucket"], t["rate_paise"]) for t in _DEFAULTS["guest_tiers"]
]
VALIDITY_ADDON_PAISE: dict[int, int] = {
    v["days"]: v["addon_paise"] for v in _DEFAULTS["validity_options"]
}
VALID_VALIDITY_DAYS = tuple(VALIDITY_ADDON_PAISE.keys())


# ── TypedDicts ────────────────────────────────────────────────────────────────

class PhotoBreakdown(TypedDict):
    tier_label: str
    units:      int
    rate_paise: int
    subtotal:   int


class PriceBreakdown(TypedDict):
    base_fee_paise:       int
    photo_tiers:          list[PhotoBreakdown]
    photo_total_paise:    int
    guest_tiers:          list[PhotoBreakdown]
    guest_total_paise:    int
    validity_addon_paise: int
    total_paise:          int
    total_inr:            float
    photo_quota:          int
    guest_quota:          int
    validity_days:        int


# ── Core calculation ──────────────────────────────────────────────────────────

def _tiered_cost(quantity: int, tiers: list[dict]) -> tuple[int, list[PhotoBreakdown]]:
    remaining   = quantity
    total_paise = 0
    breakdown   = []
    used_so_far = 0
    for t in tiers:
        if remaining <= 0:
            break
        bucket   = t["bucket"]
        rate     = t["rate_paise"]
        units    = remaining if bucket is None else min(remaining, bucket)
        subtotal = units * rate
        total_paise += subtotal
        breakdown.append(PhotoBreakdown(
            tier_label=f"{used_so_far + 1}–{used_so_far + units}",
            units=units, rate_paise=rate, subtotal=subtotal,
        ))
        remaining   -= units
        used_so_far += units
    return total_paise, breakdown


def calculate_price(
    photo_quota:   int,
    guest_quota:   int = 0,
    validity_days: int = 30,
    db=None,
) -> PriceBreakdown:
    """
    Calculate event price.

    Pass db= to use live DB config (always do this in request handlers).
    Omit db= for callers that run outside a request context (tests, scripts).
    """
    if db is not None:
        row              = _get_active(db)
        photo_tiers_data = row.photo_tiers
        guest_tiers_data = row.guest_tiers
        validity_opts    = {v["days"]: v["addon_paise"] for v in row.validity_options}
        base_fee         = row.base_event_fee_paise
        min_p, max_p     = row.min_photo_quota, row.max_photo_quota
        min_g, max_g     = row.min_guest_quota,  row.max_guest_quota
    else:
        photo_tiers_data = _DEFAULTS["photo_tiers"]
        guest_tiers_data = _DEFAULTS["guest_tiers"]
        validity_opts    = VALIDITY_ADDON_PAISE
        base_fee         = BASE_EVENT_FEE_PAISE
        min_p, max_p     = MIN_PHOTO_QUOTA, MAX_PHOTO_QUOTA
        min_g, max_g     = MIN_GUEST_QUOTA, MAX_GUEST_QUOTA

    if not (min_p <= photo_quota <= max_p):
        raise ValueError(f"photo_quota must be {min_p}–{max_p}")
    if not (min_g <= guest_quota <= max_g):
        raise ValueError(f"guest_quota must be {min_g}–{max_g}")
    if validity_days not in validity_opts:
        raise ValueError(f"validity_days must be one of {list(validity_opts.keys())}")

    photo_total, photo_tiers = _tiered_cost(photo_quota, photo_tiers_data)
    guest_total, guest_tiers = _tiered_cost(guest_quota, guest_tiers_data)
    validity_addon            = validity_opts[validity_days]
    total_paise               = base_fee + photo_total + guest_total + validity_addon

    return PriceBreakdown(
        base_fee_paise=base_fee,
        photo_tiers=photo_tiers,   photo_total_paise=photo_total,
        guest_tiers=guest_tiers,   guest_total_paise=guest_total,
        validity_addon_paise=validity_addon,
        total_paise=total_paise,   total_inr=round(total_paise / 100, 2),
        photo_quota=photo_quota,   guest_quota=guest_quota,
        validity_days=validity_days,
    )


def format_inr(paise: int) -> str:
    return f"₹{paise / 100:.2f}"


def get_rate_at_quota(photo_quota: int, db=None) -> int:
    tiers = _get_active(db).photo_tiers if db is not None else _DEFAULTS["photo_tiers"]
    used  = 0
    for t in tiers:
        if t["bucket"] is None:
            return t["rate_paise"]
        if photo_quota <= used + t["bucket"]:
            return t["rate_paise"]
        used += t["bucket"]
    return tiers[-1]["rate_paise"]
