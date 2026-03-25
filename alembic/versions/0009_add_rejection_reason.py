"""add rejection_reason column to photos

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = 'd5e6f7a8b9c0'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR;")


def downgrade():
    op.drop_column('photos', 'rejection_reason')
