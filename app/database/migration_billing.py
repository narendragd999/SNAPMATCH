"""
Migration: Pay-Per-Event Billing System

Adds to events table:
  - photo_quota         (INTEGER, default 50)      max owner photos allowed
  - guest_quota         (INTEGER, default 0)       total guest upload slots purchased
  - guest_uploads_used  (INTEGER, default 0)       consumed guest slots (approved only)
  - validity_days       (INTEGER, default 30)      event lifetime in days
  - is_free_tier        (BOOLEAN, default FALSE)   TRUE = user's one free event
  - payment_order_id    (VARCHAR, nullable)        Razorpay order_id
  - payment_id          (VARCHAR, nullable)        Razorpay payment_id
  - payment_status      (VARCHAR, default 'pending') pending|paid|failed|free
  - amount_paid_paise   (INTEGER, default 0)       amount charged in paise

Adds to users table:
  - free_event_used     (BOOLEAN, default FALSE)   TRUE = free tier already consumed

Creates new table:
  - event_orders        billing ledger per Razorpay order

Run with:
  docker compose exec backend python -m app.database.migration_billing
  OR (local):
  python -m app.database.migration_billing
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.database.db import engine


def run_migration():
    print("=" * 60)
    print("🔄  Pay-Per-Event Billing Migration")
    print("=" * 60)

    with engine.connect() as conn:

        # ── events table — quota columns ──────────────────────────
        columns = [
            ("photo_quota",        "INTEGER DEFAULT 50"),
            ("guest_quota",        "INTEGER DEFAULT 0"),
            ("guest_uploads_used", "INTEGER DEFAULT 0"),
            ("validity_days",      "INTEGER DEFAULT 30"),
            ("is_free_tier",       "BOOLEAN DEFAULT FALSE"),
            ("payment_order_id",   "VARCHAR"),
            ("payment_id",         "VARCHAR"),
            ("payment_status",     "VARCHAR DEFAULT 'pending'"),
            ("amount_paid_paise",  "INTEGER DEFAULT 0"),
        ]

        for col, definition in columns:
            try:
                conn.execute(text(f"""
                    ALTER TABLE events
                    ADD COLUMN IF NOT EXISTS {col} {definition};
                """))
                conn.commit()
                print(f"  ✅  events.{col}")
            except Exception as e:
                print(f"  ⚠   events.{col}: {e}")
                conn.rollback()

        # ── users table ───────────────────────────────────────────
        try:
            conn.execute(text("""
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS free_event_used BOOLEAN DEFAULT FALSE;
            """))
            conn.commit()
            print("  ✅  users.free_event_used")
        except Exception as e:
            print(f"  ⚠   users.free_event_used: {e}")
            conn.rollback()

        # ── event_orders table ────────────────────────────────────
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS event_orders (
                    id                    SERIAL PRIMARY KEY,
                    user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
                    event_id              INTEGER REFERENCES events(id) ON DELETE SET NULL,
                    razorpay_order_id     VARCHAR UNIQUE,
                    razorpay_payment_id   VARCHAR,
                    razorpay_signature    VARCHAR,
                    amount_paise          INTEGER NOT NULL,
                    photo_quota           INTEGER NOT NULL,
                    guest_quota           INTEGER NOT NULL DEFAULT 0,
                    validity_days         INTEGER NOT NULL DEFAULT 30,
                    status                VARCHAR DEFAULT 'created',
                    event_name            VARCHAR,
                    created_at            TIMESTAMP DEFAULT NOW(),
                    paid_at               TIMESTAMP
                );
            """))
            conn.commit()
            print("  ✅  table: event_orders (created)")
        except Exception as e:
            print(f"  ⚠   event_orders table: {e}")
            conn.rollback()

        # ── indexes ───────────────────────────────────────────────
        indexes = [
            ("idx_event_orders_user_id",     "event_orders(user_id)"),
            ("idx_event_orders_event_id",    "event_orders(event_id)"),
            ("idx_event_orders_rzp_order",   "event_orders(razorpay_order_id)"),
            ("idx_events_payment_status",    "events(payment_status)"),
            ("idx_events_is_free_tier",      "events(is_free_tier)"),
        ]
        for idx_name, idx_def in indexes:
            try:
                conn.execute(text(f"""
                    CREATE INDEX IF NOT EXISTS {idx_name} ON {idx_def};
                """))
                conn.commit()
                print(f"  ✅  index: {idx_name}")
            except Exception as e:
                print(f"  ⚠   index {idx_name}: {e}")
                conn.rollback()

        # ── backfill existing events ──────────────────────────────
        # Existing events created before this migration: mark as free/legacy paid
        try:
            conn.execute(text("""
                UPDATE events
                SET
                    payment_status   = 'paid',
                    is_free_tier     = FALSE,
                    photo_quota      = COALESCE(image_count, 50) + 500,
                    guest_quota      = CASE WHEN guest_upload_enabled THEN 50 ELSE 0 END,
                    validity_days    = 365
                WHERE payment_status = 'pending'
                  AND image_count    > 0;
            """))
            conn.commit()
            print("  ✅  backfill: existing events with photos → payment_status=paid")
        except Exception as e:
            print(f"  ⚠   backfill existing events: {e}")
            conn.rollback()

        # Mark users who already have events as free_event_used
        # (they got their free event before this system existed)
        try:
            conn.execute(text("""
                UPDATE users
                SET free_event_used = TRUE
                WHERE id IN (
                    SELECT DISTINCT owner_id FROM events
                )
                AND free_event_used = FALSE;
            """))
            conn.commit()
            print("  ✅  backfill: existing users with events → free_event_used=true")
        except Exception as e:
            print(f"  ⚠   backfill users: {e}")
            conn.rollback()

        # ── verify ───────────────────────────────────────────────
        try:
            result = conn.execute(text("SELECT COUNT(*) FROM event_orders;"))
            count = result.scalar()
            print(f"\n  📊  event_orders rows: {count}")

            result = conn.execute(text(
                "SELECT COUNT(*) FROM events WHERE payment_status = 'paid';"
            ))
            print(f"  📊  events with payment_status=paid: {result.scalar()}")

            result = conn.execute(text(
                "SELECT COUNT(*) FROM users WHERE free_event_used = TRUE;"
            ))
            print(f"  📊  users with free_event_used=true: {result.scalar()}")
        except Exception as e:
            print(f"  ⚠   verification query: {e}")

    print("\n" + "=" * 60)
    print("✅  Migration complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Copy updated model files (event.py, user.py, event_order.py)")
    print("  2. Restart backend: docker compose restart backend")
    print("  3. Run Step 2: pricing engine (app/core/pricing.py)")


if __name__ == "__main__":
    run_migration()
