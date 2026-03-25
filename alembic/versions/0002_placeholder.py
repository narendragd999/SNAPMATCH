"""add events base columns

Revision ID: 0002
Revises: 0001
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This migration intentionally left as a no-op placeholder.
    # 0001 already creates the photos table in its final initial form.
    pass


def downgrade() -> None:
    pass
