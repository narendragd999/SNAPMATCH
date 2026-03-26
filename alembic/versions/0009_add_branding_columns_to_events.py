"""add_branding_columns_to_events

Revision ID: 0009
Revises: 0008
Create Date: 2026-02-22
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c['name'] for c in inspect(bind).get_columns('events')]

    additions = [
        ('brand_template_id',      sa.Column('brand_template_id', sa.String(40), nullable=True, server_default='classic')),
        ('brand_logo_url',         sa.Column('brand_logo_url', sa.Text(), nullable=True)),
        ('brand_primary_color',    sa.Column('brand_primary_color', sa.String(7), nullable=True, server_default='#3b82f6')),
        ('brand_accent_color',     sa.Column('brand_accent_color', sa.String(7), nullable=True, server_default='#60a5fa')),
        ('brand_font',             sa.Column('brand_font', sa.String(40), nullable=True, server_default='system')),
        ('brand_footer_text',      sa.Column('brand_footer_text', sa.String(100), nullable=True)),
        ('brand_show_powered_by',  sa.Column('brand_show_powered_by', sa.Boolean(), nullable=True, server_default=sa.text('true'))),
    ]
    for col_name, col_def in additions:
        if col_name not in cols:
            op.add_column('events', col_def)

    existing_idx = [i['name'] for i in inspect(bind).get_indexes('events')]
    if 'ix_events_public_token' not in existing_idx:
        op.create_index('ix_events_public_token', 'events', ['public_token'])


def downgrade() -> None:
    op.drop_index('ix_events_public_token', table_name='events')
    for col in ('brand_show_powered_by', 'brand_footer_text', 'brand_font',
                'brand_accent_color', 'brand_primary_color',
                'brand_logo_url', 'brand_template_id'):
        op.drop_column('events', col)
