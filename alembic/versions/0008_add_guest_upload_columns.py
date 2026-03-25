"""add guest upload and processing columns to photos

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-02-22
"""
from alembic import op
import sqlalchemy as sa

revision = 'c4d5e6f7a8b9'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS guest_email VARCHAR;")
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS guest_message TEXT;")
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS face_detection_confidence VARCHAR;")
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS scene_label VARCHAR;")
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS scene_confidence VARCHAR;")
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS objects_detected TEXT;")
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS optimized_at TIMESTAMP;")
    op.execute("ALTER TABLE photos ADD COLUMN IF NOT EXISTS face_detected_at TIMESTAMP;")


def downgrade():
    op.drop_column('photos', 'face_detected_at')
    op.drop_column('photos', 'optimized_at')
    op.drop_column('photos', 'objects_detected')
    op.drop_column('photos', 'scene_confidence')
    op.drop_column('photos', 'scene_label')
    op.drop_column('photos', 'face_detection_confidence')
    op.drop_column('photos', 'guest_message')
    op.drop_column('photos', 'guest_email')
