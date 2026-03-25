"""create events table

Revision ID: 0002
Revises: 0001
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Some environments initialize from this migration chain without a prior
    # users-table revision. Create it here before events(owner_id) FK.
    if "users" not in inspector.get_table_names():
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("email", sa.String(), nullable=False),
            sa.Column("password_hash", sa.String(), nullable=False),
            sa.Column("role", sa.String(), nullable=True),
            sa.Column("plan_type", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("free_event_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.UniqueConstraint("email", name="uq_users_email"),
        )
        op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), unique=True),
        sa.Column("public_token", sa.String(), unique=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id")),

        # Processing
        sa.Column("processing_status", sa.String(), default="pending"),
        sa.Column("processing_progress", sa.Integer(), default=0),

        # Counts
        sa.Column("image_count", sa.Integer(), default=0),
        sa.Column("total_faces", sa.Integer(), default=0),
        sa.Column("total_clusters", sa.Integer(), default=0),

        # Status
        sa.Column("public_status", sa.String(), default="active"),

        # Timestamps
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("processing_started_at", sa.DateTime()),
        sa.Column("processing_completed_at", sa.DateTime()),

        # Guest upload
        sa.Column("guest_upload_enabled", sa.Boolean(), default=True),

        # Billing
        sa.Column("photo_quota", sa.Integer(), default=50),
        sa.Column("guest_quota", sa.Integer(), default=0),
        sa.Column("guest_uploads_used", sa.Integer(), default=0),
        sa.Column("validity_days", sa.Integer(), default=30),
        sa.Column("is_free_tier", sa.Boolean(), default=False),

        # Payment
        sa.Column("payment_status", sa.String(), default="pending"),
        sa.Column("amount_paid_paise", sa.Integer(), default=0),
    )


def downgrade():
    op.drop_table("events")
    # Intentionally do not drop "users" here. It may pre-exist this revision
    # in databases that had user management initialized outside Alembic.