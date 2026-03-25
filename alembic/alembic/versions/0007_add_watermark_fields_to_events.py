"""add_watermark_fields_to_events

Revision ID: 0007
Revises: 0006
Create Date: 2026-02-22
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'events',
        sa.Column('watermark_enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.add_column(
        'events',
        sa.Column('watermark_config', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('events', 'watermark_config')
    op.drop_column('events', 'watermark_enabled')
