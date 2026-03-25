"""add_photos_table

Revision ID: 0001
Revises:
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'photos',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=True),
        sa.Column('original_filename', sa.String(), nullable=True),
        sa.Column('stored_filename', sa.String(), nullable=True),
        sa.Column('optimized_filename', sa.String(), nullable=True),
        sa.Column('file_size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('status', sa.String(), server_default='uploaded', nullable=True),
        sa.Column('cluster_ids', sa.String(), nullable=True),
        sa.Column('uploaded_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('optimized_at', sa.DateTime(), nullable=True),
        sa.Column('detected_at', sa.DateTime(), nullable=True),
        sa.Column('enriched_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_photo_event_status', 'photos', ['event_id', 'status'])
    op.create_index('idx_photo_event_optimized', 'photos', ['event_id', 'optimized_filename'])


def downgrade() -> None:
    op.drop_index('idx_photo_event_optimized', table_name='photos')
    op.drop_index('idx_photo_event_status', table_name='photos')
    op.drop_table('photos')
