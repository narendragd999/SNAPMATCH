"""add_guest_upload_enabled_to_events

Revision ID: 0005
Revises: 0004
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c['name'] for c in inspect(bind).get_columns('events')]
    if 'guest_upload_enabled' not in cols:
        op.add_column(
            'events',
            sa.Column(
                'guest_upload_enabled',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text('false'),
            ),
        )
    else:
        # Column exists from old migration with wrong default — fix it
        op.alter_column(
            'events',
            'guest_upload_enabled',
            existing_type=sa.Boolean(),
            server_default=sa.text('false'),
            existing_nullable=False,
        )


def downgrade() -> None:
    op.drop_column('events', 'guest_upload_enabled')
