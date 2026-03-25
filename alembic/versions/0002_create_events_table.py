from alembic import op
import sqlalchemy as sa

revision = "0002_create_events"
down_revision = "0001"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("public_token", sa.String(), unique=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"))
    )

def downgrade():
    op.drop_table("events")