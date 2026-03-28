"""create co_occurrences table

Revision ID: 0013
Revises: 0012
Create Date: 2025-01-17

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def table_exists(table_name):
    """Check if a table already exists in the database."""
    conn = op.get_bind()
    inspector = inspect(conn)
    return table_name in inspector.get_table_names()


def index_exists(table_name, index_name):
    """Check if an index already exists."""
    conn = op.get_bind()
    inspector = inspect(conn)
    indexes = inspector.get_indexes(table_name)
    return any(idx['name'] == index_name for idx in indexes)


def constraint_exists(table_name, constraint_name):
    """Check if a constraint already exists."""
    conn = op.get_bind()
    inspector = inspect(conn)
    try:
        constraints = inspector.get_unique_constraints(table_name)
        return any(c['name'] == constraint_name for c in constraints)
    except:
        return False


def upgrade():
    # Create co_occurrences table for tracking relationships between clusters
    # Check if table already exists (idempotent migration)
    if not table_exists('co_occurrences'):
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
    
    # Create indexes for efficient lookups (check if exists first)
    if not index_exists('co_occurrences', 'ix_co_occurrences_id'):
        op.create_index(op.f('ix_co_occurrences_id'), 'co_occurrences', ['id'], unique=False)
    if not index_exists('co_occurrences', 'ix_co_occurrences_event_id'):
        op.create_index(op.f('ix_co_occurrences_event_id'), 'co_occurrences', ['event_id'], unique=False)
    if not index_exists('co_occurrences', 'ix_co_occurrences_cluster_id_a'):
        op.create_index(op.f('ix_co_occurrences_cluster_id_a'), 'co_occurrences', ['cluster_id_a'], unique=False)
    if not index_exists('co_occurrences', 'ix_co_occurrences_cluster_id_b'):
        op.create_index(op.f('ix_co_occurrences_cluster_id_b'), 'co_occurrences', ['cluster_id_b'], unique=False)
    
    # Composite index for relationship lookups
    if not index_exists('co_occurrences', 'idx_co_occurrence_lookup'):
        op.create_index('idx_co_occurrence_lookup', 'co_occurrences', ['event_id', 'cluster_id_a', 'cluster_id_b'], unique=False)
    
    # Index for count-based queries (finding strong relationships)
    if not index_exists('co_occurrences', 'idx_co_occurrence_event_count'):
        op.create_index('idx_co_occurrence_event_count', 'co_occurrences', ['event_id', 'photo_count'], unique=False)
    
    # Unique constraint to prevent duplicate pairs
    if not constraint_exists('co_occurrences', 'uq_co_occurrence_pair'):
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