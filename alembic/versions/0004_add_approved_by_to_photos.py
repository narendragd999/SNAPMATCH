"""add_approved_by_to_photos

Revision ID: 0004
Revises: 0003
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind, table):
    return [c['name'] for c in inspect(bind).get_columns(table)]


def upgrade() -> None:
    bind = op.get_bind()
    cols = _cols(bind, 'photos')
    if 'approved_by' not in cols:
        op.add_column('photos', sa.Column('approved_by', sa.Integer(), nullable=True))
    if 'approved_at' not in cols:
        op.add_column('photos', sa.Column('approved_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('photos', 'approved_at')
    op.drop_column('photos', 'approved_by')
