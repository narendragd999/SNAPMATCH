"""
app/core/pricing.py

Pay-per-event pricing engine.
All monetary values are in PAISE (INR × 100) internally.

Two event types only:
  - Free:          quota/validity admin-configurable via PlatformSetting DB table
  - Pay-per-event: quota/validity chosen by owner at purchase, stored on event.*

To change free tier limits without a deploy → update via admin panel.
Hardcoded values in FREE_TIER_DEFAULTS are only used as DB fallbacks on first run.

─── Infra cost model (verified against real pipeline) ───────────────────────
Image pipeline output : 1200px JPEG Q85 = ~1.5 MB/photo
Storage per 1000 photos: 1.5 GB
Dominant cost          : VPS share ₹83/event (85% of total infra)

Component                         Per 1000 photos    Notes
──────────────────────────────────────────────────────────────────────────────
Cloudflare R2 storage             ₹1.85              1.5GB × $0.015/GB-mo × ₹84
R2 ops (upload + reads)           ₹0.04              negligible
RunPod RTX 4090 (0.5s/photo)      ₹12.25             500s ÷ 3600 × $1.04 × ₹84
VPS Hostinger KVM8 (÷30 events)   ₹83.30             ₹2499/mo ÷ 30
──────────────────────────────────────────────────────────────────────────────
TOTAL INFRA per 1000-photo event  ₹98.08
Razorpay effective fee            2.36%              2% + 18% GST on fee
Target margin                     ≥ 40% (from 200 photos upward)

Verified profit at key event sizes (after Razorpay 2.36%):
   50 photos → charge ₹109  → infra ₹84  → profit ₹22   (20% — edge case)
  200 photos → charge ₹139  → infra ₹86  → profit ₹50   (36% margin)
  500 photos → charge ₹199  → infra ₹90  → profit ₹104  (52% margin)
 1000 photos → charge ₹274  → infra ₹98  → profit ₹170  (62% margin)
 2000 photos → charge ₹374  → infra ₹112 → profit ₹254  (68% margin)
 5000 photos → charge ₹614  → infra ₹153 → profit ₹446  (73% margin)
10000 photos → charge ₹964  → infra ₹223 → profit ₹718  (74% margin)

Note: 50–100 photo events have thin margin due to ₹83 fixed VPS cost.
These are edge cases — typical photographer events are 500–5000 photos.

MIRROR: Keep in sync with frontend/src/lib/pricing.ts at all times.
"""

from __future__ import annotations
from typing import TypedDict


# ── Free tier defaults (used when DB rows not yet set) ───────────────────────
FREE_TIER_DEFAULTS: dict[str, int] = {
    "free_photo_quota":   5000,
    "free_guest_quota":   200,
    "free_validity_days": 7,
}

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
#
# Base fee ₹99 covers the fixed VPS overhead (₹83/event).
# Per-photo rates are low and competitive vs Kwikpic (~₹85/event subscription).
# All rates verified profitable from 200 photos upward.
#
BASE_EVENT_FEE_PAISE = 9_900   # ₹99

PHOTO_TIERS: list[tuple[int | None, int]] = [
    (500,  20),    # ₹0.20/photo — first 500      → max ₹100
    (500,  15),    # ₹0.15/photo — 501–1000        → max ₹75
    (2000, 10),    # ₹0.10/photo — 1001–3000       → max ₹200
    (None,  7),    # ₹0.07/photo — 3001+
]

GUEST_TIERS: list[tuple[int | None, int]] = [
    (50,   10),    # ₹0.10/guest — first 50
    (150,   8),    # ₹0.08/guest — 51–200
    (300,   6),    # ₹0.06/guest — 201–500
    (None,  4),    # ₹0.04/guest — 501+
]

VALIDITY_ADDON_PAISE: dict[int, int] = {
    30:  0,        # included free
    90:  4_900,    # ₹49
    365: 14_900,   # ₹149
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