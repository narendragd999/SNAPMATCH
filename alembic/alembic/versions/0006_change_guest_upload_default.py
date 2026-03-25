"""change guest_upload_enabled default from True to False

Revision ID: a1b2c3d4e5f6
Revises: 
Create Date: 2026-02-22

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = None  # replace with your latest revision id
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'events',                       # your table name
        'guest_upload_enabled',
        existing_type=sa.Boolean(),
        server_default=sa.false(),      # new default → False
        existing_nullable=False,
    )


def downgrade():
    op.alter_column(
        'events',
        'guest_upload_enabled',
        existing_type=sa.Boolean(),
        server_default=sa.true(),       # revert default → True
        existing_nullable=False,
    )