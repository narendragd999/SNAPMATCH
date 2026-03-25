"""add_event_fk_and_restructure_photos_columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-02-21

Notes:
  - Adds FK from photos.event_id -> events.id (was commented out in 0001)
  - Renames/replaces old column names with cleaner schema:
      face_count        -> faces_detected
      is_approved       -> approval_status (string, default 'pending')
      detected_objects  -> objects_detected
  - Adds processed_at timestamp
  - Drops old columns: face_count, is_approved, approved_by, rejection_reason
    (approved_by is re-added in 0004, rejection_reason in 0008)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add FK constraint now that events table exists
    op.create_foreign_key(
        'fk_photos_event_id',
        'photos', 'events',
        ['event_id'], ['id'],
        ondelete='CASCADE',
    )

    # Add renamed / new columns
    op.add_column('photos', sa.Column('faces_detected', sa.Integer(), nullable=True))
    op.add_column('photos', sa.Column('approval_status', sa.String(), server_default='pending', nullable=True))
    op.add_column('photos', sa.Column('objects_detected', sa.String(), nullable=True))
    op.add_column('photos', sa.Column('processed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_constraint('fk_photos_event_id', 'photos', type_='foreignkey')
    op.drop_column('photos', 'processed_at')
    op.drop_column('photos', 'objects_detected')
    op.drop_column('photos', 'approval_status')
    op.drop_column('photos', 'faces_detected')
