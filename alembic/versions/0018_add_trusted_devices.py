"""add trusted devices table

Revision ID: 0018
Revises: 0017
Create Date: 2026-03-28
Adds trusted device management for OTP bypass on known devices.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0018'
down_revision = '0017'
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
    """Check if a unique constraint already exists."""
    conn = op.get_bind()
    inspector = inspect(conn)
    try:
        constraints = inspector.get_unique_constraints(table_name)
        return any(c['name'] == constraint_name for c in constraints)
    except:
        return False


def upgrade():
    # Create trusted_devices table only if it doesn't exist
    if not table_exists('trusted_devices'):
        op.create_table(
            'trusted_devices',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('device_fingerprint', sa.String(255), nullable=False),
            sa.Column('device_name', sa.String(100), nullable=True),
            sa.Column('user_agent', sa.String(500), nullable=True),
            sa.Column('ip_address', sa.String(50), nullable=True),
            sa.Column('trusted_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
            sa.Column('expires_at', sa.DateTime(), nullable=True),
            sa.Column('last_used_at', sa.DateTime(), nullable=True),
            sa.Column('is_active', sa.Boolean(), server_default='true'),
            
            sa.PrimaryKeyConstraint('id'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
        )
    
    # Create indexes only if they don't exist
    if not index_exists('trusted_devices', 'ix_trusted_devices_user_id'):
        op.create_index('ix_trusted_devices_user_id', 'trusted_devices', ['user_id'])
    
    if not index_exists('trusted_devices', 'ix_trusted_devices_fingerprint'):
        op.create_index('ix_trusted_devices_fingerprint', 'trusted_devices', ['device_fingerprint'])
    
    # Create unique constraint only if it doesn't exist
    if not constraint_exists('trusted_devices', 'uq_user_device'):
        op.create_unique_constraint('uq_user_device', 'trusted_devices', ['user_id', 'device_fingerprint'])


def downgrade():
    if constraint_exists('trusted_devices', 'uq_user_device'):
        op.drop_constraint('uq_user_device', 'trusted_devices', type_='unique')
    
    if index_exists('trusted_devices', 'ix_trusted_devices_fingerprint'):
        op.drop_index('ix_trusted_devices_fingerprint', table_name='trusted_devices')
    
    if index_exists('trusted_devices', 'ix_trusted_devices_user_id'):
        op.drop_index('ix_trusted_devices_user_id', table_name='trusted_devices')
    
    if table_exists('trusted_devices'):
        op.drop_table('trusted_devices')