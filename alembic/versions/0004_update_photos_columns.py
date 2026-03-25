"""update photos columns — rename and add detection fields

Revision ID: 0004
Revises: 0003
Create Date: 2026-02-21
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('photos', sa.Column('faces_detected', sa.Integer(), nullable=True))
    op.add_column('photos', sa.Column('approval_status', sa.String(), server_default='pending', nullable=True))
    op.add_column('photos', sa.Column('objects_detected', sa.String(), nullable=True))
    op.add_column('photos', sa.Column('processed_at', sa.DateTime(), nullable=True))
    op.drop_column('photos', 'face_count')
    op.drop_column('photos', 'is_approved')
    op.drop_column('photos', 'approved_by')
    op.drop_column('photos', 'rejection_reason')


def downgrade() -> None:
    op.add_column('photos', sa.Column('face_count', sa.Integer(), nullable=True))
    op.add_column('photos', sa.Column('is_approved', sa.Integer(), nullable=True))
    op.add_column('photos', sa.Column('approved_by', sa.Integer(), nullable=True))
    op.add_column('photos', sa.Column('rejection_reason', sa.String(), nullable=True))
    op.drop_column('photos', 'processed_at')
    op.drop_column('photos', 'objects_detected')
    op.drop_column('photos', 'approval_status')
    op.drop_column('photos', 'faces_detected')
