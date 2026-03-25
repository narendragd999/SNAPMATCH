"""add watermark fields to events table

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = 'e6f7a8b9c0d1'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS watermark_enabled BOOLEAN DEFAULT FALSE NOT NULL;")
    op.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS watermark_config TEXT;")


def downgrade():
    op.execute("ALTER TABLE events DROP COLUMN IF EXISTS watermark_config;")
    op.execute("ALTER TABLE events DROP COLUMN IF EXISTS watermark_enabled;")
