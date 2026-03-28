"""create otp table and add email_verified to users

Revision ID: 0015
Revises: 0014_create_cms_tables.py
Create Date: 2024-01-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade():
    # Create otp_verifications table
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
    op.create_index('ix_otp_verifications_id', 'otp_verifications', ['id'], unique=False)
    op.create_index('ix_otp_verifications_email', 'otp_verifications', ['email'], unique=False)

    # Add email_verified column to users table
    op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    # Drop otp_verifications table
    op.drop_index('ix_otp_verifications_email', table_name='otp_verifications')
    op.drop_index('ix_otp_verifications_id', table_name='otp_verifications')
    op.drop_table('otp_verifications')

    # Remove email_verified column from users table
    op.drop_column('users', 'email_verified')