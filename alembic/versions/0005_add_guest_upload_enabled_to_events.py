"""add_guest_upload_enabled_to_events

Revision ID: 0005
Revises: 0004
Create Date: 2026-02-21

Notes:
  - Adds guest_upload_enabled column with default FALSE
    (previous intent was TRUE, changed to FALSE per business decision)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'events',
        sa.Column(
            'guest_upload_enabled',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('events', 'guest_upload_enabled')
