from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('events', sa.Column('processing_started_at', sa.DateTime(), nullable=True))
    op.add_column('events', sa.Column('processing_completed_at', sa.DateTime(), nullable=True))

def downgrade():
    op.drop_column('events', 'processing_completed_at')
    op.drop_column('events', 'processing_started_at')