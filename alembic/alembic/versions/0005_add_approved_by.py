from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('photos', sa.Column('approved_by', sa.Integer(), nullable=True))

def downgrade():
    op.drop_column('photos', 'approved_by')