"""create cms tables (testimonials, faqs, newsletter_subscribers)

Revision ID: 0014
Revises:
Create Date: 2026-03-28

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade():
    # Create testimonials table
    op.create_table(
        'testimonials',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('role', sa.String(length=100), nullable=False),
        sa.Column('company', sa.String(length=100), nullable=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('rating', sa.Integer(), nullable=True, server_default='5'),
        sa.Column('avatar_url', sa.String(length=500), nullable=True),
        sa.Column('verified', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_testimonials_id', 'testimonials', ['id'], unique=False)

    # Create faqs table
    op.create_table(
        'faqs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('answer', sa.Text(), nullable=False),
        sa.Column('category', sa.String(length=50), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_faqs_id', 'faqs', ['id'], unique=False)

    # Create newsletter_subscribers table
    op.create_table(
        'newsletter_subscribers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('source', sa.String(length=50), nullable=True, server_default='landing_page'),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('subscribed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('unsubscribed_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_newsletter_subscribers_id', 'newsletter_subscribers', ['id'], unique=False)
    op.create_index('ix_newsletter_subscribers_email', 'newsletter_subscribers', ['email'], unique=True)

    # Seed default testimonials
    op.execute("""
        INSERT INTO testimonials (name, role, company, text, rating, verified, sort_order, is_active) VALUES
        ('Rajesh Mehta', 'Lead Photographer', 'RMStudios', 'SnapFind cut our post-event delivery from 3 days to 3 hours. Clients love finding their photos by selfie — it feels like magic.', 5, true, 1, true),
        ('Priya Sharma', 'Wedding Planner', 'BlissEvents', 'We used to spend hours sharing photos on WhatsApp. Now we share one link and every guest gets their photos automatically.', 5, true, 2, true),
        ('Amit Verma', 'Corporate Events Manager', 'TechCorp India', 'The face clustering accuracy is outstanding. 800 attendees, 4,000 photos — everyone found their pictures within seconds.', 5, true, 3, true)
    """)

    # Seed default FAQs
    op.execute("""
        INSERT INTO faqs (question, answer, category, sort_order, is_active) VALUES
        ('How accurate is the face recognition?', 'We use InsightFace''s buffalo_l model which achieves 99.2% accuracy on standard benchmarks. In real event conditions with varied lighting, expect 96-98% accuracy.', 'Technology', 1, true),
        ('How long does processing take?', 'Processing takes approximately 3-4 minutes for 1,000 photos. It runs entirely in the background — you can share the event guest link immediately while processing completes.', 'Performance', 2, true),
        ('Is guest data private and secure?', 'Yes. Selfies uploaded for search are processed in memory and never stored. Event photos are stored securely with AES-256 encryption and deleted after your chosen retention period.', 'Security', 3, true),
        ('Do guests need to create an account?', 'No. Guests simply open your event link, take or upload a selfie, and instantly see their photos. Zero friction for attendees.', 'Guest Experience', 4, true),
        ('What photo formats are supported?', 'JPG, JPEG, PNG, WebP, and HEIC (iPhone photos). Maximum 20MB per photo. Bulk upload supports thousands of files simultaneously.', 'Technical', 5, true),
        ('How much does a paid event cost?', 'Pricing is pay-per-event and depends on three factors you control: photo count, storage duration, and optional guest uploads. Use the live configurator on our pricing page to see your exact price before paying. There are no subscriptions or monthly fees.', 'Pricing', 6, true),
        ('Can I use this for corporate events?', 'Absolutely. PIN-protected events and private guest portals make SnapFind ideal for conferences, award ceremonies, team outings and corporate functions.', 'Use Cases', 7, true)
    """)


def downgrade():
    op.drop_index('ix_newsletter_subscribers_email', table_name='newsletter_subscribers')
    op.drop_index('ix_newsletter_subscribers_id', table_name='newsletter_subscribers')
    op.drop_table('newsletter_subscribers')

    op.drop_index('ix_faqs_id', table_name='faqs')
    op.drop_table('faqs')

    op.drop_index('ix_testimonials_id', table_name='testimonials')
    op.drop_table('testimonials')