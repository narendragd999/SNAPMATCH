"""add approved_by column to photos

Revision ID: 0005
Revises: 0004
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('photos', sa.Column('approved_by', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('photos', 'approved_by')
