"""add foreign key photos.event_id → events.id

Revision ID: 0013_add_photos_event_fk
Revises: 002_add_branding_columns
Create Date: 2026-03-25
"""

from alembic import op

# revision identifiers
revision = "0013_add_photos_event_fk"
down_revision = "002_add_branding_columns"
branch_labels = None
depends_on = None


def upgrade():
    op.create_foreign_key(
        "fk_photos_event",
        "photos",
        "events",
        ["event_id"],
        ["id"],
        ondelete="CASCADE"
    )


def downgrade():
    op.drop_constraint(
        "fk_photos_event",
        "photos",
        type_="foreignkey"
    )