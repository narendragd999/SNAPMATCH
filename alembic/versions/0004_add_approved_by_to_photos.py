"""add_approved_by_to_photos

Revision ID: 0004
Revises: 0003
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('photos', sa.Column('approved_by', sa.Integer(), nullable=True))
    op.add_column('photos', sa.Column('approved_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('photos', 'approved_at')
    op.drop_column('photos', 'approved_by')
