"""add_guest_and_processing_columns_to_photos

Revision ID: 0008
Revises: 0007
Create Date: 2026-02-22
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c['name'] for c in inspect(bind).get_columns('photos')]

    additions = [
        ('guest_email',               sa.Column('guest_email', sa.String(), nullable=True)),
        ('guest_message',             sa.Column('guest_message', sa.Text(), nullable=True)),
        ('face_detection_confidence', sa.Column('face_detection_confidence', sa.String(), nullable=True)),
        ('face_detected_at',          sa.Column('face_detected_at', sa.DateTime(), nullable=True)),
        ('scene_label',               sa.Column('scene_label', sa.String(), nullable=True)),
        ('scene_confidence',          sa.Column('scene_confidence', sa.String(), nullable=True)),
        ('rejection_reason',          sa.Column('rejection_reason', sa.String(), nullable=True)),
    ]
    for col_name, col_def in additions:
        if col_name not in cols:
            op.add_column('photos', col_def)


def downgrade() -> None:
    for col in ('rejection_reason', 'scene_confidence', 'scene_label',
                'face_detected_at', 'face_detection_confidence',
                'guest_message', 'guest_email'):
        op.drop_column('photos', col)
