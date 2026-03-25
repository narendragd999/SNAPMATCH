"""add branding columns to events table

Revision ID: 002_add_branding_columns
Revises: 001_pricing_config
Create Date: 2026-03-25
"""

from alembic import op
import sqlalchemy as sa

revision = "002_add_branding_columns"
down_revision = "001_pricing_config"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "events",
        sa.Column(
            "brand_template_id",
            sa.String(40),
            nullable=True,
            server_default="classic",
        ),
    )
    op.add_column(
        "events",
        sa.Column("brand_logo_url", sa.Text(), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column(
            "brand_primary_color",
            sa.String(7),
            nullable=True,
            server_default="#3b82f6",
        ),
    )
    op.add_column(
        "events",
        sa.Column(
            "brand_accent_color",
            sa.String(7),
            nullable=True,
            server_default="#60a5fa",
        ),
    )
    op.add_column(
        "events",
        sa.Column(
            "brand_font",
            sa.String(40),
            nullable=True,
            server_default="system",
        ),
    )
    op.add_column(
        "events",
        sa.Column("brand_footer_text", sa.String(100), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column(
            "brand_show_powered_by",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    # Covering index for public route lookups (token → branding fields)
    op.create_index(
        "ix_events_public_token_branding",
        "events",
        ["public_token"],
        postgresql_include=[
            "brand_template_id",
            "brand_logo_url",
            "brand_primary_color",
            "brand_accent_color",
            "brand_font",
            "brand_footer_text",
            "brand_show_powered_by",
        ],
    )


def downgrade():
    op.drop_index("ix_events_public_token_branding", table_name="events")
    op.drop_column("events", "brand_show_powered_by")
    op.drop_column("events", "brand_footer_text")
    op.drop_column("events", "brand_font")
    op.drop_column("events", "brand_accent_color")
    op.drop_column("events", "brand_primary_color")
    op.drop_column("events", "brand_logo_url")
    op.drop_column("events", "brand_template_id")
