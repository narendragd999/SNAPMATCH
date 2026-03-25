"""create_pricing_config_table

Revision ID: 0010
Revises: 0009
Create Date: 2026-03-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy import inspect, text
import json

revision: str = '0010'
down_revision: Union[str, Sequence[str], None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_photo_tiers = [
    {"bucket": 500,  "rate_paise": 20},
    {"bucket": 500,  "rate_paise": 15},
    {"bucket": 2000, "rate_paise": 10},
    {"bucket": None, "rate_paise": 7},
]

_guest_tiers = [
    {"bucket": 50,   "rate_paise": 0},
    {"bucket": 200,  "rate_paise": 500},
    {"bucket": 500,  "rate_paise": 1000},
    {"bucket": None, "rate_paise": 2000},
]

_validity_options = [
    {"days": 7,   "label": "1 week",   "price_multiplier": 1.0},
    {"days": 30,  "label": "1 month",  "price_multiplier": 1.2},
    {"days": 90,  "label": "3 months", "price_multiplier": 1.5},
    {"days": 365, "label": "1 year",   "price_multiplier": 2.0},
]


def upgrade() -> None:
    bind = op.get_bind()
    if 'pricing_config' not in inspect(bind).get_table_names():
        op.create_table(
            'pricing_config',
            sa.Column('id',                   sa.Integer(),               nullable=False),
            sa.Column('free_photo_quota',      sa.Integer(),               nullable=False, server_default='50'),
            sa.Column('free_guest_quota',      sa.Integer(),               nullable=False, server_default='10'),
            sa.Column('free_validity_days',    sa.Integer(),               nullable=False, server_default='7'),
            sa.Column('min_photo_quota',       sa.Integer(),               nullable=False, server_default='50'),
            sa.Column('max_photo_quota',       sa.Integer(),               nullable=False, server_default='10000'),
            sa.Column('min_guest_quota',       sa.Integer(),               nullable=False, server_default='0'),
            sa.Column('max_guest_quota',       sa.Integer(),               nullable=False, server_default='1000'),
            sa.Column('base_event_fee_paise',  sa.Integer(),               nullable=False, server_default='9900'),
            sa.Column('photo_tiers',           JSON,                       nullable=False),
            sa.Column('guest_tiers',           JSON,                       nullable=False),
            sa.Column('validity_options',      JSON,                       nullable=False),
            sa.Column('is_active',             sa.Boolean(),               nullable=False, server_default='true'),
            sa.Column('created_at',            sa.DateTime(timezone=True), server_default=sa.text('now()')),
            sa.Column('updated_at',            sa.DateTime(timezone=True), server_default=sa.text('now()')),
            sa.PrimaryKeyConstraint('id'),
        )

        op.execute(
            text("""
                INSERT INTO pricing_config (
                    free_photo_quota, free_guest_quota, free_validity_days,
                    min_photo_quota, max_photo_quota,
                    min_guest_quota, max_guest_quota,
                    base_event_fee_paise,
                    photo_tiers, guest_tiers, validity_options,
                    is_active
                ) VALUES (
                    50, 10, 7,
                    50, 10000,
                    0, 1000,
                    9900,
                    :photo_tiers::jsonb,
                    :guest_tiers::jsonb,
                    :validity_options::jsonb,
                    true
                )
            """),
            {
                "photo_tiers":      json.dumps(_photo_tiers),
                "guest_tiers":      json.dumps(_guest_tiers),
                "validity_options": json.dumps(_validity_options),
            },
        )


def downgrade() -> None:
    op.drop_table('pricing_config')
