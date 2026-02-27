"""Merge branches

Revision ID: b97732cdd20d
Revises: d5e6f7a8b9c0, 99b519e81a90
Create Date: 2026-02-22 05:39:47.833428

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b97732cdd20d'
down_revision: Union[str, Sequence[str], None] = ('d5e6f7a8b9c0', '99b519e81a90')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
