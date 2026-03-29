"""create_guests_table

Revision ID: 0021
Revises: 0020
Create Date: 2026-03-29

Creates the guests table for guest management functionality:
- Store guest contact information (name, email, phone)
- Track notification status (sent, opened, visited, downloaded)
- Support CSV import source tracking

IMPORTANT: This table is OPTIONAL - the system works perfectly without it.
If the table doesn't exist, guest-related features are gracefully disabled.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0021'
down_revision: Union[str, Sequence[str], None] = '0020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    
    # Create guests table if it doesn't exist
    if 'guests' not in inspect(bind).get_table_names():
        op.create_table(
            'guests',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('event_id', sa.Integer(), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(255), nullable=True),
            sa.Column('email', sa.String(255), nullable=False),
            sa.Column('phone', sa.String(50), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            # Notification tracking
            sa.Column('email_sent', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('email_sent_at', sa.DateTime(), nullable=True),
            sa.Column('email_opened', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('email_opened_at', sa.DateTime(), nullable=True),
            # Engagement tracking
            sa.Column('visited_event', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('visited_at', sa.DateTime(), nullable=True),
            sa.Column('downloaded_photos', sa.Boolean(), nullable=False, server_default='false'),
            # Timestamps
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            # Source tracking
            sa.Column('source', sa.String(50), nullable=False, server_default='manual'),
        )
        
        # Create indexes
        op.create_index('idx_guests_event_id', 'guests', ['event_id'])
        op.create_index('idx_guests_email', 'guests', ['email'])
        
        print("[migration] ✅ Guests table created successfully")
    else:
        print("[migration] ℹ️ Guests table already exists, skipping")


def downgrade() -> None:
    bind = op.get_bind()
    if 'guests' in inspect(bind).get_table_names():
        op.drop_index('idx_guests_email', table_name='guests')
        op.drop_index('idx_guests_event_id', table_name='guests')
        op.drop_table('guests')
        print("[migration] ✅ Guests table dropped")