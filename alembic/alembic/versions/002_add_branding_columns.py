from alembic import op

revision = "002_add_branding_columns"
down_revision = "001_pricing_config"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_template_id VARCHAR(40) DEFAULT 'classic';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_logo_url TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_primary_color VARCHAR(7) DEFAULT '#3b82f6';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_accent_color VARCHAR(7) DEFAULT '#60a5fa';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_font VARCHAR(40) DEFAULT 'system';
    ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_footer_text VARCHAR(100);
    ALTER TABLE events ADD COLUMN IF NOT EXISTS brand_show_powered_by BOOLEAN DEFAULT TRUE;
    """)

    op.execute("""
    CREATE INDEX IF NOT EXISTS ix_events_public_token_branding
    ON events (public_token);
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_events_public_token_branding;")