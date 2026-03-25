"""change guest_upload_enabled default from True to False

Revision ID: a1b2c3d4e5f6
Revises: 0005
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'events',
        'guest_upload_enabled',
        existing_type=sa.Boolean(),
        server_default=sa.false(),
        existing_nullable=False,
    )


def downgrade():
    op.alter_column(
        'events',
        'guest_upload_enabled',
        existing_type=sa.Boolean(),
        server_default=sa.true(),
        existing_nullable=False,
    )
