"""add event processing timestamp columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('events', sa.Column('processing_started_at', sa.DateTime(), nullable=True))
    op.add_column('events', sa.Column('processing_completed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('events', 'processing_completed_at')
    op.drop_column('events', 'processing_started_at')
