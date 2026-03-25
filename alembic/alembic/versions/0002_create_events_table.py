"""create_events_table

Revision ID: 0002
Revises: 0001
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'events' not in inspect(bind).get_table_names():
        op.create_table(
            'events',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('public_token', sa.String(), unique=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()')),
        )


def downgrade() -> None:
    op.drop_table('events')
