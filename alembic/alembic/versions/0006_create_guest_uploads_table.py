"""create_guest_uploads_table

Revision ID: 0006
Revises: 0005
Create Date: 2026-02-22
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'guest_uploads',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('event_id', sa.Integer(), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('original_filename', sa.String(), nullable=False),
        sa.Column('contributor_name', sa.String(), nullable=True),
        sa.Column('message', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('uploaded_at', sa.DateTime(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
    )
    op.create_index('idx_guest_uploads_event_id', 'guest_uploads', ['event_id'])


def downgrade() -> None:
    op.drop_index('idx_guest_uploads_event_id', table_name='guest_uploads')
    op.drop_table('guest_uploads')
