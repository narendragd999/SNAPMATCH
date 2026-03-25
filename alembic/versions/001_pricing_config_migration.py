"""create pricing_config table

Revision ID: 001_pricing_config
Revises:
Create Date: 2026-03-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON
import json

revision = "001_pricing_config"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "pricing_config",
        sa.Column("id",                   sa.Integer(),  primary_key=True),
        sa.Column("free_photo_quota",      sa.Integer(),  nullable=False, server_default="50"),
        sa.Column("free_guest_quota",      sa.Integer(),  nullable=False, server_default="10"),
        sa.Column("free_validity_days",    sa.Integer(),  nullable=False, server_default="7"),
        sa.Column("min_photo_quota",       sa.Integer(),  nullable=False, server_default="50"),
        sa.Column("max_photo_quota",       sa.Integer(),  nullable=False, server_default="10000"),
        sa.Column("min_guest_quota",       sa.Integer(),  nullable=False, server_default="0"),
        sa.Column("max_guest_quota",       sa.Integer(),  nullable=False, server_default="1000"),
        sa.Column("base_event_fee_paise",  sa.Integer(),  nullable=False, server_default="9900"),
        sa.Column("photo_tiers",           JSON,          nullable=False),
        sa.Column("guest_tiers",           JSON,          nullable=False),
        sa.Column("validity_options",      JSON,          nullable=False),
        sa.Column("is_active",             sa.Boolean(),  nullable=False, server_default="true"),
        sa.Column("created_at",            sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at",            sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # Seed default row
    op.execute(f"""
        INSERT INTO pricing_config (
            free_photo_quota, free_guest_quota, free_validity_days,
            min_photo_quota, max_photo_quota, min_guest_quota, max_guest_quota,
            base_event_fee_paise, photo_tiers, guest_tiers, validity_options, is_active
        ) VALUES (
            50, 10, 7,
            50, 10000, 0, 1000,
            9900,
            '{json.dumps([
                {{"bucket": 500,  "rate_paise": 20}},
                {{"bucket": 500,  "rate_paise": 15}},
                {{"bucket": 2000, "rate_paise": 10}},
                {{"bucket": None, "rate_paise": 7}}
            ])}',
            '{json.dumps([
                {{"bucket": 50,  "rate_paise": 10}},
                {{"bucket": 150, "rate_paise": 8}},
                {{"bucket": 300, "rate_paise": 6}},
                {{"bucket": None,"rate_paise": 4}}
            ])}',
            '{json.dumps([
                {{"days": 30,  "addon_paise": 0,     "included": True}},
                {{"days": 90,  "addon_paise": 4900,  "included": False}},
                {{"days": 365, "addon_paise": 14900, "included": False}}
            ])}',
            true
        )
    """)


def downgrade():
    op.drop_table("pricing_config")