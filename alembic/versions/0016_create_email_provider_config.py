"""create email_provider_config table

Revision ID: 0016
Revises: 0015
Create Date: 2026-03-28

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = '0016'
down_revision = '0015'
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


def table_has_data(table_name):
    """Check if table has any data."""
    conn = op.get_bind()
    result = conn.execute(sa.text(f"SELECT 1 FROM {table_name} LIMIT 1"))
    return result.fetchone() is not None


def upgrade():
    if not table_exists('email_provider_config'):
        op.create_table(
            'email_provider_config',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('provider', sa.String(20), nullable=False, server_default='smtp'),
            
            # SMTP
            sa.Column('smtp_host', sa.String(255), nullable=True),
            sa.Column('smtp_port', sa.Integer(), nullable=True, server_default='587'),
            sa.Column('smtp_user', sa.String(255), nullable=True),
            sa.Column('smtp_password', sa.String(255), nullable=True),
            sa.Column('smtp_from', sa.String(255), nullable=True),
            sa.Column('smtp_use_tls', sa.Boolean(), server_default='true'),
            
            # SendGrid
            sa.Column('sendgrid_api_key', sa.String(255), nullable=True),
            sa.Column('sendgrid_from', sa.String(255), nullable=True),
            
            # Brevo
            sa.Column('brevo_api_key', sa.String(255), nullable=True),
            sa.Column('brevo_from', sa.String(255), nullable=True),
            
            # Resend
            sa.Column('resend_api_key', sa.String(255), nullable=True),
            sa.Column('resend_from', sa.String(255), nullable=True),
            
            # SES
            sa.Column('ses_access_key', sa.String(255), nullable=True),
            sa.Column('ses_secret_key', sa.String(255), nullable=True),
            sa.Column('ses_region', sa.String(50), nullable=True, server_default='us-east-1'),
            sa.Column('ses_from', sa.String(255), nullable=True),
            
            # Mailgun
            sa.Column('mailgun_api_key', sa.String(255), nullable=True),
            sa.Column('mailgun_domain', sa.String(255), nullable=True),
            sa.Column('mailgun_from', sa.String(255), nullable=True),
            
            # Common
            sa.Column('from_name', sa.String(100), nullable=True, server_default='SnapMatch'),
            sa.Column('reply_to', sa.String(255), nullable=True),
            
            # Status
            sa.Column('is_active', sa.Boolean(), server_default='true'),
            sa.Column('is_configured', sa.Boolean(), server_default='false'),
            sa.Column('last_test_at', sa.DateTime(), nullable=True),
            sa.Column('last_test_status', sa.String(20), nullable=True),
            sa.Column('last_test_error', sa.Text(), nullable=True),
            
            # Timestamps
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
            
            sa.PrimaryKeyConstraint('id')
        )
    
    if not index_exists('email_provider_config', 'ix_email_provider_config_id'):
        op.create_index('ix_email_provider_config_id', 'email_provider_config', ['id'], unique=False)
    
    # Insert default config only if table is empty
    if table_exists('email_provider_config') and not table_has_data('email_provider_config'):
        op.execute("""
            INSERT INTO email_provider_config (
                provider, smtp_host, smtp_port, smtp_user, smtp_password, smtp_from, smtp_use_tls,
                sendgrid_api_key, sendgrid_from, brevo_api_key, brevo_from,
                resend_api_key, resend_from, is_active, is_configured
            ) VALUES (
                'smtp',
                'smtp.gmail.com',
                587,
                '',
                '',
                '',
                true,
                '', '',
                '', '',
                '', '',
                true,
                false
            )
        """)


def downgrade():
    if index_exists('email_provider_config', 'ix_email_provider_config_id'):
        op.drop_index('ix_email_provider_config_id', table_name='email_provider_config')
    if table_exists('email_provider_config'):
        op.drop_table('email_provider_config')