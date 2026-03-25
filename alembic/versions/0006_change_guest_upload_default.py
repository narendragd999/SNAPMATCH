from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = 'a1b2c3d4e5f6'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    columns = [col['name'] for col in inspector.get_columns('events')]

    if 'guest_upload_enabled' not in columns:
        op.add_column(
            'events',
            sa.Column(
                'guest_upload_enabled',
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true")
            )
        )

    op.alter_column(
        'events',
        'guest_upload_enabled',
        existing_type=sa.Boolean(),
        server_default=sa.text("false"),
        existing_nullable=False,
    )


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    columns = [col['name'] for col in inspector.get_columns('events')]

    if 'guest_upload_enabled' in columns:
        op.alter_column(
            'events',
            'guest_upload_enabled',
            existing_type=sa.Boolean(),
            server_default=sa.text("true"),
            existing_nullable=False,
        )