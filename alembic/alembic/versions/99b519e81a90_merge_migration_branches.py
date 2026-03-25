"""Merge migration branches

Revision ID: 99b519e81a90
Revises: 0005, c4d5e6f7a8b9
Create Date: 2026-02-22 05:32:35.992083

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '99b519e81a90'
down_revision: Union[str, Sequence[str], None] = ('0005', 'c4d5e6f7a8b9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
