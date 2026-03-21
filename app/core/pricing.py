"""
app/core/pricing.py

Pay-per-event pricing engine.
All monetary values are in PAISE (INR × 100) internally.

Single source of truth: app/core/pricing_config.json
  - Python reads it at import time (this file)
  - TypeScript reads it at build time (pricing.ts)
  - Never hardcode limits in either file — edit pricing_config.json only.

Two event types:
  - Free:          limits from pricing_config.json free_tier (DB overrides via PlatformSetting)
  - Pay-per-event: quota/validity chosen by owner at purchase, stored on event.*
"""

from __future__ import annotations
import os
import json
from typing import TypedDict

# ── Load config from single source of truth ───────────────────────────────────
_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "pricing_config.json")

with open(_CONFIG_PATH) as _f:
    _CFG = json.load(_f)

# ── Free tier ─────────────────────────────────────────────────────────────────
FREE_TIER_DEFAULTS: dict[str, int] = {
    "free_photo_quota":   _CFG["free_tier"]["photo_quota"],
    "free_guest_quota":   _CFG["free_tier"]["guest_quota"],
    "free_validity_days": _CFG["free_tier"]["validity_days"],
}

FREE_TIER_CONFIG: dict = {
    "photo_quota":   FREE_TIER_DEFAULTS["free_photo_quota"],
    "guest_quota":   FREE_TIER_DEFAULTS["free_guest_quota"],
    "validity_days": FREE_TIER_DEFAULTS["free_validity_days"],
    "is_free_tier":  True,
    "amount_paise":  0,
}

# ── Paid tier limits ──────────────────────────────────────────────────────────
MIN_PHOTO_QUOTA = _CFG["paid_tier"]["min_photo_quota"]
MAX_PHOTO_QUOTA = _CFG["paid_tier"]["max_photo_quota"]
MIN_GUEST_QUOTA = _CFG["paid_tier"]["min_guest_quota"]
MAX_GUEST_QUOTA = _CFG["paid_tier"]["max_guest_quota"]

# ── Pricing constants ─────────────────────────────────────────────────────────
BASE_EVENT_FEE_PAISE = _CFG["paid_tier"]["base_event_fee_paise"]

PHOTO_TIERS: list[tuple[int | None, int]] = [
    (t["bucket"], t["rate_paise"]) for t in _CFG["photo_tiers"]
]

GUEST_TIERS: list[tuple[int | None, int]] = [
    (t["bucket"], t["rate_paise"]) for t in _CFG["guest_tiers"]
]

VALIDITY_ADDON_PAISE: dict[int, int] = {
    v["days"]: v["addon_paise"] for v in _CFG["validity_options"]
}

VALID_VALIDITY_DAYS = tuple(VALIDITY_ADDON_PAISE.keys())


# ── Live free tier (reads DB overrides) ───────────────────────────────────────
def get_free_tier_config(db) -> dict:
    """
    Live free tier config — reads from PlatformSetting table.
    Falls back to pricing_config.json values if a key hasn't been set yet.
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