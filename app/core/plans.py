# app/core/plans.py
#
# Two event types only — no pro/enterprise/free tiers.
#   "free"          → quota from PlatformSetting DB (get_free_tier_config)
#   "pay_per_event" → quota from event.photo_quota set at purchase
#
# No PLANS dict. No hardcoded image limits.
# All quota enforcement reads event.photo_quota directly from DB.

from app.core.pricing import FREE_TIER_CONFIG, get_free_tier_config  # noqa: F401

VALID_PLAN_TYPES = ("free", "pay_per_event")