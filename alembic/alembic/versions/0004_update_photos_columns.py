from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('photos', sa.Column('faces_detected', sa.Integer(), nullable=True))
    op.add_column('photos', sa.Column('approval_status', sa.String(), server_default='pending', nullable=True))
    op.add_column('photos', sa.Column('objects_detected', sa.String(), nullable=True))
    op.add_column('photos', sa.Column('processed_at', sa.DateTime(), nullable=True))
    # Remove old columns that were renamed
    op.drop_column('photos', 'face_count')
    op.drop_column('photos', 'is_approved')
    op.drop_column('photos', 'approved_by')
    op.drop_column('photos', 'rejection_reason')

def downgrade():
    op.drop_column('photos', 'faces_detected')
    op.drop_column('photos', 'approval_status')
    op.drop_column('photos', 'objects_detected')
    op.drop_column('photos', 'processed_at')