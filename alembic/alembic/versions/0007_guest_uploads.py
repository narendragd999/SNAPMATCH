"""create guest_uploads table

Revision ID: 0007_guest_uploads
Revises: 0006
Create Date: 2026-02-22
"""

from alembic import op
import sqlalchemy as sa

revision      = 'b3c4d5e6f7a8'
down_revision = 'a1b2c3d4e5f6'  # guest_upload_enabled default change
branch_labels = None
depends_on    = None


def upgrade():
    op.create_table(
        'guest_uploads',
        sa.Column('id',                sa.Integer(),  primary_key=True, index=True),
        sa.Column('event_id',          sa.Integer(),  sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('filename',          sa.String(),   nullable=False),
        sa.Column('original_filename', sa.String(),   nullable=False),
        sa.Column('contributor_name',  sa.String(),   nullable=True),
        sa.Column('message',           sa.String(),   nullable=True),
        sa.Column('status',            sa.String(),   nullable=False, server_default='pending'),
        sa.Column('uploaded_at',       sa.DateTime(), nullable=True),
        sa.Column('reviewed_at',       sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table('guest_uploads')