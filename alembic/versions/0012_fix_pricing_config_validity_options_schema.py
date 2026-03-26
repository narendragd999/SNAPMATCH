"""fix_pricing_config_validity_options_schema

Revision ID: 0012
Revises: 0011
Create Date: 2026-03-25

Problem
───────
Migration 0010 seeded pricing_config.validity_options using a
price_multiplier schema:
  [{"days": 7, "label": "1 week", "price_multiplier": 1.0}, ...]

But app/core/pricing.py (and the PricingConfig model default) expects
an addon_paise schema:
  [{"days": 30, "addon_paise": 0, "included": True}, ...]

This causes:
  KeyError: 'addon_paise'
at billing_routes.py → pricing.py line 220.

Fix
───
Replace the seeded row's validity_options (and guest_tiers while we're
here — the model default also differs from what 0010 seeded) with the
correct schema that matches pricing.py.
"""

from typing import Sequence, Union
from alembic import op
from sqlalchemy import text
import json

revision: str = '0012'
down_revision: Union[str, Sequence[str], None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── Correct schemas (must match app/core/pricing.py expectations) ─────────────

_validity_options = [
    {"days": 30,  "addon_paise": 0,     "included": True},
    {"days": 90,  "addon_paise": 4900,  "included": False},
    {"days": 365, "addon_paise": 14900, "included": False},
]

# 0010 seeded guest_tiers with rate_paise values (0, 500, 1000, 2000) which
# look like rupee amounts accidentally expressed as paise.
# The model default uses sensible per-photo paise rates — fix to match.
_guest_tiers = [
    {"bucket": 50,   "rate_paise": 10},
    {"bucket": 150,  "rate_paise": 8},
    {"bucket": 300,  "rate_paise": 6},
    {"bucket": None, "rate_paise": 4},
]


def upgrade() -> None:
    bind = op.get_bind()

    bind.execute(
        text("""
            UPDATE pricing_config
            SET
                validity_options = :validity_options,
                guest_tiers      = :guest_tiers,
                updated_at       = now()
            WHERE is_active = true
        """).bindparams(
            validity_options=json.dumps(_validity_options),
            guest_tiers=json.dumps(_guest_tiers),
        )
    )


def downgrade() -> None:
    # Restore the original (broken) values from 0010
    _old_validity = [
        {"days": 7,   "label": "1 week",   "price_multiplier": 1.0},
        {"days": 30,  "label": "1 month",  "price_multiplier": 1.2},
        {"days": 90,  "label": "3 months", "price_multiplier": 1.5},
        {"days": 365, "label": "1 year",   "price_multiplier": 2.0},
    ]
    _old_guest = [
        {"bucket": 50,   "rate_paise": 0},
        {"bucket": 200,  "rate_paise": 500},
        {"bucket": 500,  "rate_paise": 1000},
        {"bucket": None, "rate_paise": 2000},
    ]

    bind = op.get_bind()
    bind.execute(
        text("""
            UPDATE pricing_config
            SET
                validity_options = :validity_options,
                guest_tiers      = :guest_tiers,
                updated_at       = now()
            WHERE is_active = true
        """).bindparams(
            validity_options=json.dumps(_old_validity),
            guest_tiers=json.dumps(_old_guest),
        )
    )
