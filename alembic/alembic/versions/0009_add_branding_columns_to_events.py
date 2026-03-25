"""add_branding_columns_to_events

Revision ID: 0009
Revises: 0008
Create Date: 2026-02-22
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('events', sa.Column('brand_template_id', sa.String(40), nullable=True, server_default='classic'))
    op.add_column('events', sa.Column('brand_logo_url', sa.Text(), nullable=True))
    op.add_column('events', sa.Column('brand_primary_color', sa.String(7), nullable=True, server_default='#3b82f6'))
    op.add_column('events', sa.Column('brand_accent_color', sa.String(7), nullable=True, server_default='#60a5fa'))
    op.add_column('events', sa.Column('brand_font', sa.String(40), nullable=True, server_default='system'))
    op.add_column('events', sa.Column('brand_footer_text', sa.String(100), nullable=True))
    op.add_column('events', sa.Column('brand_show_powered_by', sa.Boolean(), nullable=True, server_default=sa.text('true')))

    op.create_index('ix_events_public_token', 'events', ['public_token'])


def downgrade() -> None:
    op.drop_index('ix_events_public_token', table_name='events')
    op.drop_column('events', 'brand_show_powered_by')
    op.drop_column('events', 'brand_footer_text')
    op.drop_column('events', 'brand_font')
    op.drop_column('events', 'brand_accent_color')
    op.drop_column('events', 'brand_primary_color')
    op.drop_column('events', 'brand_logo_url')
    op.drop_column('events', 'brand_template_id')
