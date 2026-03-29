"""add_email_notification_columns_to_events

Revision ID: 0020
Revises: 0019
Create Date: 2026-03-29

Adds email notification preferences to events table.
Allows photographers to control which notifications are sent automatically.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0020'
down_revision: Union[str, Sequence[str], None] = '0019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c['name'] for c in inspect(bind).get_columns('events')]
    
    additions = [
        # Email notification preferences
        ('notify_on_guest_upload', sa.Column('notify_on_guest_upload', sa.Boolean(), nullable=True, server_default=sa.text('true'))),
        ('notify_on_expiry_warning', sa.Column('notify_on_expiry_warning', sa.Boolean(), nullable=True, server_default=sa.text('true'))),
        ('expiry_warning_days', sa.Column('expiry_warning_days', sa.Integer(), nullable=True, server_default=7)),
        ('notify_on_processing_complete', sa.Column('notify_on_processing_complete', sa.Boolean(), nullable=True, server_default=sa.text('true'))),
        # Tracking for notification history
        ('last_notification_at', sa.Column('last_notification_at', sa.DateTime(), nullable=True)),
        ('notifications_sent_count', sa.Column('notifications_sent_count', sa.Integer(), default=0)),
    ]
    
    for col_name, col_def in additions:
        if col_name not in cols:
            op.add_column('events', col_def)


def downgrade() -> None:
    for col in [
        'notifications_sent_count',
        'last_notification_at',
        'notify_on_processing_complete'
        'expiry_warning_days'
        'notify_on_expiry_warning'
        'notify_on_guest_upload'
    ]:
        op.drop_column('events', col)