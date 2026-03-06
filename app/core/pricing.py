"""
app/core/pricing.py

Pay-per-event pricing engine.
All monetary values are in PAISE (INR × 100) internally.
UI-facing helpers convert to ₹ strings.

Pricing structure:
  Base event fee  ₹49   (platform overhead, always charged)

  Photo quota (tiered):
    1–200     → ₹0.50/photo
    201–500   → ₹0.40/photo
    501–1000  → ₹0.30/photo
    1001–2000 → ₹0.25/photo
    2001–5000 → ₹0.20/photo
    5001+     → ₹0.15/photo

  Guest upload quota (tiered):
    0         → ₹0  (disabled)
    1–50      → ₹0.10/slot
    51–200    → ₹0.08/slot
    201–500   → ₹0.06/slot
    501+      → ₹0.04/slot

  Validity addon:
    30 days   → ₹0   (included)
    90 days   → ₹99
    365 days  → ₹299
"""

from __future__ import annotations
from typing import TypedDict


# ── Constants ────────────────────────────────────────────────────────────────

BASE_EVENT_FEE_PAISE = 4_900   # ₹49

# (bucket_size, paise_per_unit)   — None bucket_size means "all remaining"
PHOTO_TIERS: list[tuple[int | None, int]] = [
    (200,  50),    # ₹0.50 each
    (300,  40),    # ₹0.40 each  (201–500)
    (500,  30),    # ₹0.30 each  (501–1000)
    (1000, 25),    # ₹0.25 each  (1001–2000)
    (3000, 20),    # ₹0.20 each  (2001–5000)
    (None, 15),    # ₹0.15 each  (5001+)
]

GUEST_TIERS: list[tuple[int | None, int]] = [
    (50,   10),    # ₹0.10 each
    (150,   8),    # ₹0.08 each  (51–200)
    (300,   6),    # ₹0.06 each  (201–500)
    (None,  4),    # ₹0.04 each  (501+)
]

VALIDITY_ADDON_PAISE: dict[int, int] = {
    7:   0,        # Free tier baseline (no charge, just a reference)
    30:  0,        # Standard — included in base fee
    90:  9_900,    # ₹99
    365: 29_900,   # ₹299
}

VALID_VALIDITY_DAYS = (30, 90, 365)

FREE_TIER_CONFIG = {
    "photo_quota":   500,
    "guest_quota":   100,
    "validity_days": 7,
    "is_free_tier":  True,
    "amount_paise":  0,
}

MIN_PHOTO_QUOTA   = 50
MAX_PHOTO_QUOTA   = 10_000
MIN_GUEST_QUOTA   = 0
MAX_GUEST_QUOTA   = 1_000


# ── TypedDicts ───────────────────────────────────────────────────────────────

class PhotoBreakdown(TypedDict):
    tier_label: str          # e.g. "1–200 photos"
    units:      int          # photos in this tier
    rate_paise: int          # per-photo rate
    subtotal:   int          # paise


class PriceBreakdown(TypedDict):
    base_fee_paise:        int
    photo_tiers:           list[PhotoBreakdown]
    photo_total_paise:     int
    guest_tiers:           list[PhotoBreakdown]
    guest_total_paise:     int
    validity_addon_paise:  int
    total_paise:           int
    total_inr:             float
    photo_quota:           int
    guest_quota:           int
    validity_days:         int


# ── Core calculation ─────────────────────────────────────────────────────────

def _tiered_cost(quantity: int, tiers: list[tuple[int | None, int]]) -> tuple[int, list[PhotoBreakdown]]:
    """
    Calculate tiered cost for `quantity` units.
    Returns (total_paise, breakdown_list).
    """
    remaining    = quantity
    total_paise  = 0
    breakdown    = []
    used_so_far  = 0

    for bucket_size, rate in tiers:
        if remaining <= 0:
            break

        if bucket_size is None:
            units = remaining
        else:
            units = min(remaining, bucket_size)

        subtotal     = units * rate
        total_paise += subtotal

        start = used_so_far + 1
        end   = used_so_far + units

        breakdown.append(PhotoBreakdown(
            tier_label=f"{start}–{end}",
            units=units,
            rate_paise=rate,
            subtotal=subtotal,
        ))

        remaining    -= units
        used_so_far  += units

    return total_paise, breakdown


def calculate_price(
    photo_quota:   int,
    guest_quota:   int  = 0,
    validity_days: int  = 30,
) -> PriceBreakdown:
    """
    Calculate the full price for an event configuration.

    Args:
        photo_quota:   Number of owner-upload photo slots (50–10000)
        guest_quota:   Number of guest upload slots (0 = disabled)
        validity_days: 30 | 90 | 365

    Returns:
        PriceBreakdown TypedDict with full itemised breakdown.

    Raises:
        ValueError: if inputs are out of range.
    """
    # Validate inputs
    if not (MIN_PHOTO_QUOTA <= photo_quota <= MAX_PHOTO_QUOTA):
        raise ValueError(f"photo_quota must be between {MIN_PHOTO_QUOTA} and {MAX_PHOTO_QUOTA}")

    if not (MIN_GUEST_QUOTA <= guest_quota <= MAX_GUEST_QUOTA):
        raise ValueError(f"guest_quota must be between {MIN_GUEST_QUOTA} and {MAX_GUEST_QUOTA}")

    if validity_days not in VALIDITY_ADDON_PAISE:
        raise ValueError(f"validity_days must be one of {list(VALIDITY_ADDON_PAISE.keys())}")

    # Calculate components
    photo_total, photo_tiers  = _tiered_cost(photo_quota,  PHOTO_TIERS)
    guest_total, guest_tiers  = _tiered_cost(guest_quota,  GUEST_TIERS)
    validity_addon             = VALIDITY_ADDON_PAISE[validity_days]

    total_paise = BASE_EVENT_FEE_PAISE + photo_total + guest_total + validity_addon

    return PriceBreakdown(
        base_fee_paise=BASE_EVENT_FEE_PAISE,
        photo_tiers=photo_tiers,
        photo_total_paise=photo_total,
        guest_tiers=guest_tiers,
        guest_total_paise=guest_total,
        validity_addon_paise=validity_addon,
        total_paise=total_paise,
        total_inr=round(total_paise / 100, 2),
        photo_quota=photo_quota,
        guest_quota=guest_quota,
        validity_days=validity_days,
    )


def format_inr(paise: int) -> str:
    """Convert paise to ₹ formatted string. E.g. 4900 → '₹49.00'"""
    return f"₹{paise / 100:.2f}"


def get_rate_at_quota(photo_quota: int) -> int:
    """Return the per-photo rate (paise) for the last photo in the given quota."""
    used = 0
    for bucket_size, rate in PHOTO_TIERS:
        if bucket_size is None:
            return rate
        if photo_quota <= used + bucket_size:
            return rate
        used += bucket_size
    return PHOTO_TIERS[-1][1]


# ── Backwards compat shim (replaces old plans.py PLANS dict) ─────────────────

# Keep a minimal PLANS dict so any code that still references PLANS
# doesn't hard-crash before we finish migrating all call sites.
# The values here are NOT used for billing — only for display/admin.
PLANS: dict[str, dict] = {
    "free": {
        "display_name":        "Free",
        "photo_quota":         FREE_TIER_CONFIG["photo_quota"],
        "guest_quota":         FREE_TIER_CONFIG["guest_quota"],
        "validity_days":       FREE_TIER_CONFIG["validity_days"],
        "max_events":          1,
        "max_images_per_event": FREE_TIER_CONFIG["photo_quota"],
        "event_validity_days": FREE_TIER_CONFIG["validity_days"],
    },
    "pay_per_event": {
        "display_name":        "Pay Per Event",
        "photo_quota":         None,    # dynamic
        "guest_quota":         None,    # dynamic
        "validity_days":       None,    # dynamic
        "max_events":          None,    # unlimited
        "max_images_per_event": MAX_PHOTO_QUOTA,
        "event_validity_days": 365,
    },
}
