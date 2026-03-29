"""add slideshow columns to events

Revision ID: 0019
Revises: 0018_add_trusted_devices
Create Date: 2025-01-15

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add slideshow columns to events table
    op.add_column('events', sa.Column('slideshow_enabled', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('events', sa.Column('slideshow_speed', sa.Integer(), nullable=False, server_default='5'))
    op.add_column('events', sa.Column('slideshow_transition', sa.String(20), nullable=True, server_default='fade'))
    op.add_column('events', sa.Column('slideshow_show_qr', sa.Boolean(), nullable=False, server_default='1'))
    op.add_column('events', sa.Column('slideshow_show_branding', sa.Boolean(), nullable=False, server_default='1'))
    op.add_column('events', sa.Column('slideshow_music_url', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('events', 'slideshow_music_url')
    op.drop_column('events', 'slideshow_show_branding')
    op.drop_column('events', 'slideshow_show_qr')
    op.drop_column('events', 'slideshow_transition')
    op.drop_column('events', 'slideshow_speed')
    op.drop_column('events', 'slideshow_enabled')