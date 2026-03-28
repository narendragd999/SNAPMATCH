"""add fallback fields to email_provider_config

Revision ID: 0017
Revises: 0016
Create Date: 2026-03-28
Adds fallback provider support with priority and rate limiting.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0017'
down_revision = '0016'
branch_labels = None
depends_on = None


def column_exists(table_name, column_name):
    """Check if a column already exists in a table."""
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def index_exists(table_name, index_name):
    """Check if an index already exists."""
    conn = op.get_bind()
    inspector = inspect(conn)
    indexes = inspector.get_indexes(table_name)
    return any(idx['name'] == index_name for idx in indexes)


def table_exists(table_name):
    """Check if a table already exists in the database."""
    conn = op.get_bind()
    inspector = inspect(conn)
    return table_name in inspector.get_table_names()


def upgrade():
    # Only proceed if table exists
    if not table_exists('email_provider_config'):
        return
    
    # Add new columns for fallback support (check if exists first)
    if not column_exists('email_provider_config', 'priority'):
        op.add_column('email_provider_config', sa.Column('priority', sa.Integer(), nullable=True, server_default='1'))
    
    if not column_exists('email_provider_config', 'fallback_enabled'):
        op.add_column('email_provider_config', sa.Column('fallback_enabled', sa.Boolean(), nullable=True, server_default='true'))
    
    if not column_exists('email_provider_config', 'daily_sent_count'):
        op.add_column('email_provider_config', sa.Column('daily_sent_count', sa.Integer(), nullable=True, server_default='0'))
    
    if not column_exists('email_provider_config', 'daily_limit'):
        op.add_column('email_provider_config', sa.Column('daily_limit', sa.Integer(), nullable=True))
    
    if not column_exists('email_provider_config', 'last_sent_date'):
        op.add_column('email_provider_config', sa.Column('last_sent_date', sa.DateTime(), nullable=True))
    
    # Set default daily limits for known providers (only for rows that don't have limits set)
    op.execute("""
        UPDATE email_provider_config 
        SET daily_limit = CASE 
            WHEN provider = 'brevo' THEN 300
            WHEN provider = 'sendgrid' THEN 100
            WHEN provider = 'resend' THEN 100
            WHEN provider = 'smtp' THEN 500
            WHEN provider = 'ses' THEN 1000
            WHEN provider = 'mailgun' THEN 5000
            ELSE NULL
        END,
        priority = COALESCE(priority, 1),
        fallback_enabled = COALESCE(fallback_enabled, true)
        WHERE daily_limit IS NULL
    """)
    
    # Create index on priority for faster sorting
    if not index_exists('email_provider_config', 'ix_email_provider_config_priority'):
        op.create_index('ix_email_provider_config_priority', 'email_provider_config', ['priority', 'is_active'], unique=False)


def downgrade():
    if index_exists('email_provider_config', 'ix_email_provider_config_priority'):
        op.drop_index('ix_email_provider_config_priority', table_name='email_provider_config')
    
    if column_exists('email_provider_config', 'last_sent_date'):
        op.drop_column('email_provider_config', 'last_sent_date')
    if column_exists('email_provider_config', 'daily_limit'):
        op.drop_column('email_provider_config', 'daily_limit')
    if column_exists('email_provider_config', 'daily_sent_count'):
        op.drop_column('email_provider_config', 'daily_sent_count')
    if column_exists('email_provider_config', 'fallback_enabled'):
        op.drop_column('email_provider_config', 'fallback_enabled')
    if column_exists('email_provider_config', 'priority'):
        op.drop_column('email_provider_config', 'priority')