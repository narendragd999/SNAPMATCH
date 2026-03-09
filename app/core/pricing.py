"""
app/core/pricing.py

Pay-per-event pricing engine.
All monetary values are in PAISE (INR × 100) internally.

Two event types only:
  - Free:          quota/validity admin-configurable via PlatformSetting DB table
  - Pay-per-event: quota/validity chosen by owner at purchase, stored on event.*

To change free tier limits without a deploy → update via admin panel.
Hardcoded values in FREE_TIER_DEFAULTS are only used as DB fallbacks on first run.
"""

from __future__ import annotations
from typing import TypedDict


# ── Free tier defaults (used when DB rows not yet set) ───────────────────────
FREE_TIER_DEFAULTS: dict[str, int] = {
    "free_photo_quota":   500,
    "free_guest_quota":   20,
    "free_validity_days": 7,
}

# Static dict for code that can't pass a DB session (e.g. Pydantic validators).
# Reflects the defaults above — will be stale if admin changes values in DB.
# Always prefer get_free_tier_config(db) when a DB session is available.
FREE_TIER_CONFIG: dict = {
    "photo_quota":   FREE_TIER_DEFAULTS["free_photo_quota"],
    "guest_quota":   FREE_TIER_DEFAULTS["free_guest_quota"],
    "validity_days": FREE_TIER_DEFAULTS["free_validity_days"],
    "is_free_tier":  True,
    "amount_paise":  0,
}


def get_free_tier_config(db) -> dict:
    """
    Live free tier config — reads from PlatformSetting table.
    Falls back to FREE_TIER_DEFAULTS if a key hasn't been set yet.
    Use this wherever a free event is created so admin changes take effect
    immediately without a redeploy.
    """
    from app.models.platform_settings import PlatformSetting

    def _get(key: str) -> int:
        row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
        return int(row.value) if row else FREE_TIER_DEFAULTS[key]

    return {
        "photo_quota":   _get("free_photo_quota"),
        "guest_quota":   _get("free_guest_quota"),
        "validity_days": _get("free_validity_days"),
        "is_free_tier":  True,
        "amount_paise":  0,
    }


# ── Paid event limits ─────────────────────────────────────────────────────────
MIN_PHOTO_QUOTA = 50
MAX_PHOTO_QUOTA = 10_000
MIN_GUEST_QUOTA = 0
MAX_GUEST_QUOTA = 1_000

# ── Pricing constants ─────────────────────────────────────────────────────────
BASE_EVENT_FEE_PAISE = 4_900   # ₹49

PHOTO_TIERS: list[tuple[int | None, int]] = [
    (200,  50),
    (300,  40),
    (500,  30),
    (1000, 25),
    (3000, 20),
    (None, 15),
]

GUEST_TIERS: list[tuple[int | None, int]] = [
    (50,   10),
    (150,   8),
    (300,   6),
    (None,  4),
]

VALIDITY_ADDON_PAISE: dict[int, int] = {
    30:  0,
    90:  9_900,
    365: 29_900,
}

VALID_VALIDITY_DAYS = (30, 90, 365)


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
def _tiered_cost(quantity: int, tiers: list[tuple[int | None, int]]) -> tuple[int, list[PhotoBreakdown]]:
    remaining   = quantity
    total_paise = 0
    breakdown   = []
    used_so_far = 0
    for bucket_size, rate in tiers:
        if remaining <= 0:
            break
        units        = remaining if bucket_size is None else min(remaining, bucket_size)
        subtotal     = units * rate
        total_paise += subtotal
        breakdown.append(PhotoBreakdown(
            tier_label=f"{used_so_far + 1}–{used_so_far + units}",
            units=units, rate_paise=rate, subtotal=subtotal,
        ))
        remaining   -= units
        used_so_far += units
    return total_paise, breakdown


def calculate_price(photo_quota: int, guest_quota: int = 0, validity_days: int = 30) -> PriceBreakdown:
    if not (MIN_PHOTO_QUOTA <= photo_quota <= MAX_PHOTO_QUOTA):
        raise ValueError(f"photo_quota must be {MIN_PHOTO_QUOTA}–{MAX_PHOTO_QUOTA}")
    if not (MIN_GUEST_QUOTA <= guest_quota <= MAX_GUEST_QUOTA):
        raise ValueError(f"guest_quota must be {MIN_GUEST_QUOTA}–{MAX_GUEST_QUOTA}")
    if validity_days not in VALIDITY_ADDON_PAISE:
        raise ValueError(f"validity_days must be one of {list(VALIDITY_ADDON_PAISE.keys())}")

    photo_total, photo_tiers = _tiered_cost(photo_quota, PHOTO_TIERS)
    guest_total, guest_tiers = _tiered_cost(guest_quota, GUEST_TIERS)
    validity_addon            = VALIDITY_ADDON_PAISE[validity_days]
    total_paise               = BASE_EVENT_FEE_PAISE + photo_total + guest_total + validity_addon

    return PriceBreakdown(
        base_fee_paise=BASE_EVENT_FEE_PAISE,
        photo_tiers=photo_tiers, photo_total_paise=photo_total,
        guest_tiers=guest_tiers, guest_total_paise=guest_total,
        validity_addon_paise=validity_addon,
        total_paise=total_paise, total_inr=round(total_paise / 100, 2),
        photo_quota=photo_quota, guest_quota=guest_quota, validity_days=validity_days,
    )


def format_inr(paise: int) -> str:
    return f"₹{paise / 100:.2f}"


def get_rate_at_quota(photo_quota: int) -> int:
    used = 0
    for bucket_size, rate in PHOTO_TIERS:
        if bucket_size is None:
            return rate
        if photo_quota <= used + bucket_size:
            return rate
        used += bucket_size
    return PHOTO_TIERS[-1][1]