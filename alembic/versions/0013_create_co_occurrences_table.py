"""create co_occurrences table

Revision ID: 0013
Revises: 0012
Create Date: 2025-01-17

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade():
    # Create co_occurrences table for tracking relationships between clusters
    op.create_table(
        'co_occurrences',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=False),
        sa.Column('cluster_id_a', sa.Integer(), nullable=False),
        sa.Column('cluster_id_b', sa.Integer(), nullable=False),
        sa.Column('photo_count', sa.Integer(), nullable=False, server_default='1'),
        sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    
    # Create indexes for efficient lookups
    op.create_index(op.f('ix_co_occurrences_id'), 'co_occurrences', ['id'], unique=False)
    op.create_index(op.f('ix_co_occurrences_event_id'), 'co_occurrences', ['event_id'], unique=False)
    op.create_index(op.f('ix_co_occurrences_cluster_id_a'), 'co_occurrences', ['cluster_id_a'], unique=False)
    op.create_index(op.f('ix_co_occurrences_cluster_id_b'), 'co_occurrences', ['cluster_id_b'], unique=False)
    
    # Composite index for relationship lookups
    op.create_index('idx_co_occurrence_lookup', 'co_occurrences', ['event_id', 'cluster_id_a', 'cluster_id_b'], unique=False)
    
    # Index for count-based queries (finding strong relationships)
    op.create_index('idx_co_occurrence_event_count', 'co_occurrences', ['event_id', 'photo_count'], unique=False)
    
    # Unique constraint to prevent duplicate pairs
    op.create_unique_constraint('uq_co_occurrence_pair', 'co_occurrences', ['event_id', 'cluster_id_a', 'cluster_id_b'])


def downgrade():
    op.drop_constraint('uq_co_occurrence_pair', 'co_occurrences', type_='unique')
    op.drop_index('idx_co_occurrence_event_count', table_name='co_occurrences')
    op.drop_index('idx_co_occurrence_lookup', table_name='co_occurrences')
    op.drop_index(op.f('ix_co_occurrences_cluster_id_b'), table_name='co_occurrences')
    op.drop_index(op.f('ix_co_occurrences_cluster_id_a'), table_name='co_occurrences')
    op.drop_index(op.f('ix_co_occurrences_event_id'), table_name='co_occurrences')
    op.drop_index(op.f('ix_co_occurrences_id'), table_name='co_occurrences')
    op.drop_table('co_occurrences')