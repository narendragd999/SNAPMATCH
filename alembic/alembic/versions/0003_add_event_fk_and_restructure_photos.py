"""add_event_fk_and_restructure_photos_columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-02-21

Notes:
  - Adds FK from photos.event_id -> events.id (was commented out originally)
  - Adds renamed columns: faces_detected, approval_status, objects_detected, processed_at
  All operations are guarded with IF NOT EXISTS / inspector checks so this is
  safe to run against a DB that already has some of these columns from old migrations.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind, table):
    return [c['name'] for c in inspect(bind).get_columns(table)]

def _fks(bind, table):
    return [fk['name'] for fk in inspect(bind).get_foreign_keys(table)]


def upgrade() -> None:
    bind = op.get_bind()

    # FK: only add if not already present
    if 'fk_photos_event_id' not in _fks(bind, 'photos'):
        op.create_foreign_key(
            'fk_photos_event_id',
            'photos', 'events',
            ['event_id'], ['id'],
            ondelete='CASCADE',
        )

    cols = _cols(bind, 'photos')
    if 'faces_detected' not in cols:
        op.add_column('photos', sa.Column('faces_detected', sa.Integer(), nullable=True))
    if 'approval_status' not in cols:
        op.add_column('photos', sa.Column('approval_status', sa.String(), server_default='pending', nullable=True))
    if 'objects_detected' not in cols:
        op.add_column('photos', sa.Column('objects_detected', sa.String(), nullable=True))
    if 'processed_at' not in cols:
        op.add_column('photos', sa.Column('processed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if 'fk_photos_event_id' in _fks(bind, 'photos'):
        op.drop_constraint('fk_photos_event_id', 'photos', type_='foreignkey')
    op.drop_column('photos', 'processed_at')
    op.drop_column('photos', 'objects_detected')
    op.drop_column('photos', 'approval_status')
    op.drop_column('photos', 'faces_detected')
