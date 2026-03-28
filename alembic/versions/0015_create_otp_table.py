"""create otp table and add email_verified to users

Revision ID: 0015
Revises: 0014
Create Date: 2024-01-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0015'
down_revision = '0014'
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


def column_exists(table_name, column_name):
    """Check if a column already exists in a table."""
    conn = op.get_bind()
    inspector = inspect(conn)
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def upgrade():
    # Create otp_verifications table
    if not table_exists('otp_verifications'):
        op.create_table(
            'otp_verifications',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('email', sa.String(), nullable=False),
            sa.Column('otp_code', sa.String(6), nullable=False),
            sa.Column('purpose', sa.String(), nullable=True, default='registration'),
            sa.Column('is_verified', sa.Boolean(), nullable=True, default=False),
            sa.Column('attempts', sa.Integer(), nullable=True, default=0),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id')
        )
    if not index_exists('otp_verifications', 'ix_otp_verifications_id'):
        op.create_index('ix_otp_verifications_id', 'otp_verifications', ['id'], unique=False)
    if not index_exists('otp_verifications', 'ix_otp_verifications_email'):
        op.create_index('ix_otp_verifications_email', 'otp_verifications', ['email'], unique=False)

    # Add email_verified column to users table
    if not column_exists('users', 'email_verified'):
        op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    # Drop otp_verifications table
    if index_exists('otp_verifications', 'ix_otp_verifications_email'):
        op.drop_index('ix_otp_verifications_email', table_name='otp_verifications')
    if index_exists('otp_verifications', 'ix_otp_verifications_id'):
        op.drop_index('ix_otp_verifications_id', table_name='otp_verifications')
    if table_exists('otp_verifications'):
        op.drop_table('otp_verifications')

    # Remove email_verified column from users table
    if column_exists('users', 'email_verified'):
        op.drop_column('users', 'email_verified')