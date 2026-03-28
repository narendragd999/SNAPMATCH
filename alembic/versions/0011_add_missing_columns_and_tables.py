"""add_missing_columns_and_tables

Revision ID: 0011
Revises: 0010
Create Date: 2026-03-25

What this migration covers
──────────────────────────
This migration closes the gap between the Alembic chain (0001–0010) and the
actual SQLAlchemy models.  Several columns and entire tables were added to the
codebase via ad-hoc scripts (migration_billing.py, migration_guest_upload.py,
migration_guest_preview.py) or were simply never migrated at all.

Every operation is guarded so running this against a DB that already has some
of these objects (e.g. via Base.metadata.create_all or an ad-hoc script) is
completely safe — nothing will be duplicated or error out.

Tables
──────
  users             — was never created by the Alembic chain
  clusters          — was never created by the Alembic chain
  platform_settings — was never created by the Alembic chain
  event_orders      — was only created by ad-hoc migration_billing.py

Columns — events
────────────────
  slug, owner_id (FK → users)
  processing_status, processing_progress, image_count, cover_image, description
  total_faces, total_clusters, public_status, process_count
  last_processed_at, expires_at
  processing_started_at, processing_completed_at
  pin_enabled, pin_hash, pin_version
  photo_quota, guest_quota, guest_uploads_used
  validity_days, is_free_tier
  payment_order_id, payment_id, payment_status, amount_paid_paise

Columns — photos
────────────────
  uploaded_by, guest_name, guest_ip
  guest_preview_filename
  detected_objects         ← never migrated anywhere

Indexes — photos
────────────────
  idx_event_approval, idx_event_status,
  idx_event_uploaded_by, idx_approval_pending

Columns — users
───────────────
  free_event_used          ← only in ad-hoc migration_billing.py

Indexes — event_orders
──────────────────────
  idx_event_orders_user_id, idx_event_orders_event_id,
  idx_event_orders_rzp_order, idx_events_payment_status, idx_events_is_free_tier
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision: str = '0011'
down_revision: Union[str, Sequence[str], None] = '0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── helpers ────────────────────────────────────────────────────────────────────

def _tables(bind):
    return inspect(bind).get_table_names()

def _cols(bind, table):
    return [c['name'] for c in inspect(bind).get_columns(table)]

def _indexes(bind, table):
    return [i['name'] for i in inspect(bind).get_indexes(table)]

def _fks(bind, table):
    return [fk['name'] for fk in inspect(bind).get_foreign_keys(table)]

def _add_col(table, col):
    """Add a column only if it does not already exist."""
    op.add_column(table, col)   # caller must already have checked


# ══════════════════════════════════════════════════════════════════════════════
# UPGRADE
# ══════════════════════════════════════════════════════════════════════════════

def upgrade() -> None:
    bind = op.get_bind()
    tables   = _tables(bind)

    # ──────────────────────────────────────────────────────────────────────────
    # 1. TABLE: users
    #    The Alembic chain never created this table; it exists only because
    #    Base.metadata.create_all() or a manual script ran first.
    #    We create it here so a clean Alembic-only install works.
    # ──────────────────────────────────────────────────────────────────────────
    if 'users' not in tables:
        op.create_table(
            'users',
            sa.Column('id',            sa.Integer(),  primary_key=True, index=True),
            sa.Column('email',         sa.String(),   unique=True, nullable=False),
            sa.Column('password_hash', sa.String(),   nullable=False),
            sa.Column('role',          sa.String(),   server_default='owner'),
            sa.Column('plan_type',     sa.String(),   server_default='pro'),
            sa.Column('created_at',    sa.DateTime(), server_default=sa.text('now()')),
            sa.Column('free_event_used', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        )
    else:
        # Table exists — add free_event_used if missing
        if 'free_event_used' not in _cols(bind, 'users'):
            op.add_column('users', sa.Column(
                'free_event_used', sa.Boolean(),
                nullable=False, server_default=sa.text('false')
            ))

    # ──────────────────────────────────────────────────────────────────────────
    # 2. TABLE: clusters
    # ──────────────────────────────────────────────────────────────────────────
    if 'clusters' not in tables:
        op.create_table(
            'clusters',
            sa.Column('id',         sa.Integer(), primary_key=True, index=True),
            sa.Column('event_id',   sa.Integer(),
                      sa.ForeignKey('events.id', ondelete='CASCADE'), index=True),
            sa.Column('cluster_id', sa.Integer(), index=True),
            sa.Column('image_name', sa.String(),  nullable=True),
            sa.Column('embedding',  sa.LargeBinary(), nullable=True),
        )
        op.create_index('idx_event_cluster', 'clusters', ['event_id', 'cluster_id'])

    # ──────────────────────────────────────────────────────────────────────────
    # 3. TABLE: platform_settings
    # ──────────────────────────────────────────────────────────────────────────
    if 'platform_settings' not in tables:
        op.create_table(
            'platform_settings',
            sa.Column('key',   sa.String(), primary_key=True),
            sa.Column('value', sa.String(), nullable=False),
        )

    # ──────────────────────────────────────────────────────────────────────────
    # 4. TABLE: event_orders
    #    Previously only created by ad-hoc migration_billing.py
    # ──────────────────────────────────────────────────────────────────────────
    if 'event_orders' not in tables:
        op.create_table(
            'event_orders',
            sa.Column('id',                   sa.Integer(),  primary_key=True, index=True),
            sa.Column('user_id',              sa.Integer(),
                      sa.ForeignKey('users.id',  ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('event_id',             sa.Integer(),
                      sa.ForeignKey('events.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('razorpay_order_id',    sa.String(),  unique=True, index=True, nullable=True),
            sa.Column('razorpay_payment_id',  sa.String(),  nullable=True),
            sa.Column('razorpay_signature',   sa.String(),  nullable=True),
            sa.Column('amount_paise',         sa.Integer(), nullable=False),
            sa.Column('photo_quota',          sa.Integer(), nullable=False),
            sa.Column('guest_quota',          sa.Integer(), nullable=False, server_default='0'),
            sa.Column('validity_days',        sa.Integer(), nullable=False, server_default='30'),
            sa.Column('event_name',           sa.String(),  nullable=True),
            sa.Column('status',               sa.String(),  nullable=False, server_default='created'),
            sa.Column('created_at',           sa.DateTime(), server_default=sa.text('now()')),
            sa.Column('paid_at',              sa.DateTime(), nullable=True),
        )

    # Indexes for event_orders (safe even if table already existed)
    eo_idx = _indexes(bind, 'event_orders') if 'event_orders' in _tables(bind) else []
    for idx_name, idx_cols in [
        ('idx_event_orders_user_id',   ['user_id']),
        ('idx_event_orders_event_id',  ['event_id']),
        ('idx_event_orders_rzp_order', ['razorpay_order_id']),
    ]:
        if idx_name not in eo_idx:
            op.create_index(idx_name, 'event_orders', idx_cols)

    # ──────────────────────────────────────────────────────────────────────────
    # 4b. TABLE: user_activity_logs
    #    Tracks user activities for audit and analytics
    # ──────────────────────────────────────────────────────────────────────────
    if 'user_activity_logs' not in tables:
        op.create_table(
            'user_activity_logs',
            sa.Column('id',              sa.Integer(), primary_key=True, index=True),
            sa.Column('user_id',         sa.Integer(),
                      sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('activity_type',   sa.String(50), nullable=False, index=True),
            sa.Column('action',          sa.String(100), nullable=False),
            sa.Column('description',     sa.Text(), nullable=True),
            sa.Column('event_id',        sa.Integer(),
                      sa.ForeignKey('events.id', ondelete='SET NULL'), nullable=True, index=True),
            sa.Column('order_id',        sa.Integer(),
                      sa.ForeignKey('event_orders.id', ondelete='SET NULL'), nullable=True),
            sa.Column('ip_address',      sa.String(45), nullable=True),
            sa.Column('user_agent',      sa.String(500), nullable=True),
            sa.Column('request_path',    sa.String(500), nullable=True),
            sa.Column('request_method',  sa.String(10), nullable=True),
            sa.Column('status',          sa.String(20), server_default='success', nullable=False),
            sa.Column('error_message',   sa.Text(), nullable=True),
            sa.Column('metadata_json',   sa.Text(), nullable=True),
            sa.Column('created_at',      sa.DateTime(), server_default=sa.text('now()'), index=True),
        )
        # Composite indexes for common queries
        op.create_index('ix_user_activity_logs_user_created', 'user_activity_logs', ['user_id', 'created_at'])
        op.create_index('ix_user_activity_logs_type_created', 'user_activity_logs', ['activity_type', 'created_at'])

    # ──────────────────────────────────────────────────────────────────────────
    # 4c. TABLE: event_analytics
    #    Daily analytics snapshot for each event
    # ──────────────────────────────────────────────────────────────────────────
    if 'event_analytics' not in tables:
        op.create_table(
            'event_analytics',
            sa.Column('id',            sa.Integer(), primary_key=True, index=True),
            sa.Column('event_id',      sa.Integer(),
                      sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('date',          sa.Date(), nullable=False),
            sa.Column('page_views',    sa.Integer(), server_default='0', nullable=False),
            sa.Column('face_matches',  sa.Integer(), server_default='0', nullable=False),
            sa.Column('downloads',     sa.Integer(), server_default='0', nullable=False),
            sa.Column('guest_uploads', sa.Integer(), server_default='0', nullable=False),
            sa.Column('created_at',    sa.DateTime(), server_default=sa.text('now()')),
            sa.Column('updated_at',    sa.DateTime(), server_default=sa.text('now()')),
        )
        op.create_index('ix_event_analytics_event_date', 'event_analytics', ['event_id', 'date'], unique=True)

    # ──────────────────────────────────────────────────────────────────────────
    # 4d. TABLE: event_analytics_totals
    #    Running totals for event analytics
    # ──────────────────────────────────────────────────────────────────────────
    if 'event_analytics_totals' not in tables:
        op.create_table(
            'event_analytics_totals',
            sa.Column('id',                 sa.Integer(), primary_key=True, index=True),
            sa.Column('event_id',           sa.Integer(),
                      sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False, unique=True, index=True),
            sa.Column('total_views',        sa.Integer(), server_default='0', nullable=False),
            sa.Column('total_matches',      sa.Integer(), server_default='0', nullable=False),
            sa.Column('total_downloads',    sa.Integer(), server_default='0', nullable=False),
            sa.Column('total_guest_uploads', sa.Integer(), server_default='0', nullable=False),
            sa.Column('last_view_at',       sa.DateTime(), nullable=True),
            sa.Column('last_match_at',      sa.DateTime(), nullable=True),
            sa.Column('last_download_at',   sa.DateTime(), nullable=True),
            sa.Column('created_at',         sa.DateTime(), server_default=sa.text('now()')),
            sa.Column('updated_at',         sa.DateTime(), server_default=sa.text('now()')),
        )

    # ──────────────────────────────────────────────────────────────────────────
    # 5. COLUMNS: events
    # ──────────────────────────────────────────────────────────────────────────
    ev_cols = _cols(bind, 'events')

    event_additions = [
        # Core columns missing from 0002
        ('slug',                    sa.Column('slug',                    sa.String(),  unique=True, nullable=True)),
        ('owner_id',                sa.Column('owner_id',                sa.Integer(), nullable=True)),

        # Processing / status
        ('processing_status',       sa.Column('processing_status',       sa.String(),  server_default='pending',  nullable=True)),
        ('processing_progress',     sa.Column('processing_progress',     sa.Integer(), server_default='0',        nullable=True)),
        ('image_count',             sa.Column('image_count',             sa.Integer(), server_default='0',        nullable=True)),
        ('cover_image',             sa.Column('cover_image',             sa.String(),  nullable=True)),
        ('description',             sa.Column('description',             sa.String(),  nullable=True)),
        ('total_faces',             sa.Column('total_faces',             sa.Integer(), server_default='0',        nullable=True)),
        ('total_clusters',          sa.Column('total_clusters',          sa.Integer(), server_default='0',        nullable=True)),
        ('public_status',           sa.Column('public_status',           sa.String(),  server_default='active',   nullable=True)),
        ('process_count',           sa.Column('process_count',           sa.Integer(), server_default='0',        nullable=True)),
        ('last_processed_at',       sa.Column('last_processed_at',       sa.DateTime(), nullable=True)),
        ('expires_at',              sa.Column('expires_at',              sa.DateTime(), nullable=True)),
        ('processing_started_at',   sa.Column('processing_started_at',   sa.DateTime(), nullable=True)),
        ('processing_completed_at', sa.Column('processing_completed_at', sa.DateTime(), nullable=True)),

        # PIN protection
        ('pin_enabled',             sa.Column('pin_enabled',             sa.Boolean(), server_default=sa.text('true'),  nullable=False)),
        ('pin_hash',                sa.Column('pin_hash',                sa.String(),  nullable=True)),
        ('pin_version',             sa.Column('pin_version',             sa.String(),  nullable=True)),

        # Billing / quota  (previously only in ad-hoc migration_billing.py)
        ('photo_quota',             sa.Column('photo_quota',             sa.Integer(), server_default='50',        nullable=False)),
        ('guest_quota',             sa.Column('guest_quota',             sa.Integer(), server_default='0',         nullable=False)),
        ('guest_uploads_used',      sa.Column('guest_uploads_used',      sa.Integer(), server_default='0',         nullable=False)),
        ('validity_days',           sa.Column('validity_days',           sa.Integer(), server_default='30',        nullable=False)),
        ('is_free_tier',            sa.Column('is_free_tier',            sa.Boolean(), server_default=sa.text('false'), nullable=False)),
        ('payment_order_id',        sa.Column('payment_order_id',        sa.String(),  nullable=True)),
        ('payment_id',              sa.Column('payment_id',              sa.String(),  nullable=True)),
        ('payment_status',          sa.Column('payment_status',          sa.String(),  server_default='pending',  nullable=False)),
        ('amount_paid_paise',       sa.Column('amount_paid_paise',       sa.Integer(), server_default='0',        nullable=False)),
    ]

    for col_name, col_def in event_additions:
        if col_name not in ev_cols:
            op.add_column('events', col_def)

    # FK: events.owner_id → users.id
    if 'fk_events_owner_id' not in _fks(bind, 'events'):
        # Only add FK if the column now exists
        op.create_foreign_key(
            'fk_events_owner_id', 'events', 'users',
            ['owner_id'], ['id'],
        )

    # Indexes for events billing columns
    ev_idx = _indexes(bind, 'events')
    for idx_name, idx_cols in [
        ('idx_events_payment_status', ['payment_status']),
        ('idx_events_is_free_tier',   ['is_free_tier']),
        ('ix_events_slug',            ['slug']),
    ]:
        if idx_name not in ev_idx:
            op.create_index(idx_name, 'events', idx_cols)

    # ──────────────────────────────────────────────────────────────────────────
    # 6. COLUMNS: photos
    # ──────────────────────────────────────────────────────────────────────────
    ph_cols = _cols(bind, 'photos')

    photo_additions = [
        # From ad-hoc migration_guest_upload.py
        ('uploaded_by',               sa.Column('uploaded_by',               sa.String(),  server_default='owner', nullable=True)),
        ('guest_name',                sa.Column('guest_name',                sa.String(),  nullable=True)),
        ('guest_ip',                  sa.Column('guest_ip',                  sa.String(),  nullable=True)),
        # From ad-hoc migration_guest_preview.py
        ('guest_preview_filename',    sa.Column('guest_preview_filename',    sa.String(),  nullable=True)),
        # Never migrated anywhere
        ('detected_objects',          sa.Column('detected_objects',          sa.String(),  nullable=True)),
    ]

    for col_name, col_def in photo_additions:
        if col_name not in ph_cols:
            op.add_column('photos', col_def)

    # Backfill uploaded_by for existing rows so NOT NULL constraint is safe later
    bind.execute(text(
        "UPDATE photos SET uploaded_by = 'owner' WHERE uploaded_by IS NULL"
    ))

    # Indexes for photos (model defines 4 composite indexes)
    ph_idx = _indexes(bind, 'photos')
    for idx_name, idx_cols in [
        ('idx_event_approval',    ['event_id', 'approval_status']),
        ('idx_event_status',      ['event_id', 'status']),
        ('idx_event_uploaded_by', ['event_id', 'uploaded_by']),
        ('idx_approval_pending',  ['approval_status', 'event_id']),
    ]:
        if idx_name not in ph_idx:
            op.create_index(idx_name, 'photos', idx_cols)


# ══════════════════════════════════════════════════════════════════════════════
# DOWNGRADE
# ══════════════════════════════════════════════════════════════════════════════

def downgrade() -> None:
    # ── photos indexes ────────────────────────────────────────────────────────
    for idx in ('idx_approval_pending', 'idx_event_uploaded_by',
                'idx_event_status', 'idx_event_approval'):
        op.drop_index(idx, table_name='photos')

    # ── photos columns ────────────────────────────────────────────────────────
    for col in ('detected_objects', 'guest_preview_filename',
                'guest_ip', 'guest_name', 'uploaded_by'):
        op.drop_column('photos', col)

    # ── events indexes ────────────────────────────────────────────────────────
    for idx in ('ix_events_slug', 'idx_events_is_free_tier', 'idx_events_payment_status'):
        op.drop_index(idx, table_name='events')

    # ── events FK ─────────────────────────────────────────────────────────────
    op.drop_constraint('fk_events_owner_id', 'events', type_='foreignkey')

    # ── events columns ────────────────────────────────────────────────────────
    for col in (
        'amount_paid_paise', 'payment_status', 'payment_id', 'payment_order_id',
        'is_free_tier', 'validity_days', 'guest_uploads_used', 'guest_quota', 'photo_quota',
        'pin_version', 'pin_hash', 'pin_enabled',
        'processing_completed_at', 'processing_started_at',
        'expires_at', 'last_processed_at',
        'process_count', 'public_status', 'total_clusters', 'total_faces',
        'description', 'cover_image', 'image_count', 'processing_progress', 'processing_status',
        'owner_id', 'slug',
    ):
        op.drop_column('events', col)

    # ── users.free_event_used ─────────────────────────────────────────────────
    op.drop_column('users', 'free_event_used')

    # ── user_activity_logs ────────────────────────────────────────────────────
    op.drop_index('ix_user_activity_logs_type_created', table_name='user_activity_logs')
    op.drop_index('ix_user_activity_logs_user_created', table_name='user_activity_logs')
    op.drop_table('user_activity_logs')

    # ── event_analytics_totals ────────────────────────────────────────────────
    op.drop_table('event_analytics_totals')

    # ── event_analytics ───────────────────────────────────────────────────────
    op.drop_index('ix_event_analytics_event_date', table_name='event_analytics')
    op.drop_table('event_analytics')

    # ── tables ────────────────────────────────────────────────────────────────
    op.drop_index('idx_event_orders_rzp_order', table_name='event_orders')
    op.drop_index('idx_event_orders_event_id',  table_name='event_orders')
    op.drop_index('idx_event_orders_user_id',   table_name='event_orders')
    op.drop_table('event_orders')
    op.drop_table('platform_settings')
    op.drop_index('idx_event_cluster', table_name='clusters')
    op.drop_table('clusters')
    # NOTE: do not drop 'users' in downgrade — it is a root dependency