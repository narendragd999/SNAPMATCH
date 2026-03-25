"""add_guest_and_processing_columns_to_photos

Revision ID: 0008
Revises: 0007
Create Date: 2026-02-22

Notes:
  - Adds guest-upload columns: guest_email, guest_message
  - Adds face detection confidence column
  - Adds scene/object detection columns (not duplicates; scene_label/confidence
    and objects_detected are net-new at this point in the clean chain)
  - Adds face_detected_at timestamp
  - Adds rejection_reason (was dropped in 0003 restructure)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Guest information
    op.add_column('photos', sa.Column('guest_email', sa.String(), nullable=True))
    op.add_column('photos', sa.Column('guest_message', sa.Text(), nullable=True))

    # Face detection
    op.add_column('photos', sa.Column('face_detection_confidence', sa.String(), nullable=True))
    op.add_column('photos', sa.Column('face_detected_at', sa.DateTime(), nullable=True))

    # Scene / object detection
    op.add_column('photos', sa.Column('scene_label', sa.String(), nullable=True))
    op.add_column('photos', sa.Column('scene_confidence', sa.String(), nullable=True))

    # Rejection reason (dropped in 0003 restructure, restored here)
    op.add_column('photos', sa.Column('rejection_reason', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('photos', 'rejection_reason')
    op.drop_column('photos', 'scene_confidence')
    op.drop_column('photos', 'scene_label')
    op.drop_column('photos', 'face_detected_at')
    op.drop_column('photos', 'face_detection_confidence')
    op.drop_column('photos', 'guest_message')
    op.drop_column('photos', 'guest_email')
