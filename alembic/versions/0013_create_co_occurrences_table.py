"""create_co_occurrences_table

Revision ID: 0013
Revises: 0012
Create Date: 2026-03-26

Group/Family Detection - stores co-occurrence relationships between
face clusters to enable "people who appear with you" features.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    
    # Check if table already exists
    if 'co_occurrences' not in inspector.get_table_names():
        op.create_table(
            'co_occurrences',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('event_id', sa.Integer(), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
            sa.Column('cluster_id_a', sa.Integer(), nullable=False),
            sa.Column('cluster_id_b', sa.Integer(), nullable=False),
            sa.Column('photo_count', sa.Integer(), nullable=False, server_default='1'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('event_id', 'cluster_id_a', 'cluster_id_b', name='uq_event_clusters'),
        )
        
        # Create indexes for efficient queries
        op.create_index('idx_event_cluster_a', 'co_occurrences', ['event_id', 'cluster_id_a'])
        op.create_index('idx_event_cluster_b', 'co_occurrences', ['event_id', 'cluster_id_b'])
        op.create_index('idx_event_count', 'co_occurrences', ['event_id', 'photo_count'])
        op.create_index(op.f('ix_co_occurrences_id'), 'co_occurrences', ['id'])
        op.create_index(op.f('ix_co_occurrences_event_id'), 'co_occurrences', ['event_id'])
        op.create_index(op.f('ix_co_occurrences_cluster_id_a'), 'co_occurrences', ['cluster_id_a'])
        op.create_index(op.f('ix_co_occurrences_cluster_id_b'), 'co_occurrences', ['cluster_id_b'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    
    if 'co_occurrences' in inspector.get_table_names():
        op.drop_index(op.f('ix_co_occurrences_cluster_id_b'), table_name='co_occurrences')
        op.drop_index(op.f('ix_co_occurrences_cluster_id_a'), table_name='co_occurrences')
        op.drop_index(op.f('ix_co_occurrences_event_id'), table_name='co_occurrences')
        op.drop_index(op.f('ix_co_occurrences_id'), table_name='co_occurrences')
        op.drop_index('idx_event_count', table_name='co_occurrences')
        op.drop_index('idx_event_cluster_b', table_name='co_occurrences')
        op.drop_index('idx_event_cluster_a', table_name='co_occurrences')
        op.drop_table('co_occurrences')
