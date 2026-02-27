"""
Migration: Add guest upload support

Adds to events table:
  - guest_upload_enabled (Boolean, default False)

Adds to photos table:
  - uploaded_by       (String, default 'owner')
  - guest_name        (String, nullable)
  - guest_ip          (String, nullable)

Run with:
  docker compose exec backend python -m app.database.migration_guest_upload
  OR via psql directly (see raw SQL below)
"""

import os
import sys

# Allow running as a script
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.database.db import engine


def run_migration():
    print("🔄 Running guest upload migration...")

    with engine.connect() as conn:

        # ── events table ──────────────────────────────────
        try:
            conn.execute(text("""
                ALTER TABLE events
                ADD COLUMN IF NOT EXISTS guest_upload_enabled BOOLEAN DEFAULT FALSE NOT NULL;
            """))
            conn.commit()
            print("✅ events.guest_upload_enabled added")
        except Exception as e:
            print(f"⚠ events.guest_upload_enabled: {e}")
            conn.rollback()

        # ── photos table ──────────────────────────────────
        try:
            conn.execute(text("""
                ALTER TABLE photos
                ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR DEFAULT 'owner';
            """))
            conn.commit()
            print("✅ photos.uploaded_by added")
        except Exception as e:
            print(f"⚠ photos.uploaded_by: {e}")
            conn.rollback()

        try:
            conn.execute(text("""
                ALTER TABLE photos
                ADD COLUMN IF NOT EXISTS guest_name VARCHAR;
            """))
            conn.commit()
            print("✅ photos.guest_name added")
        except Exception as e:
            print(f"⚠ photos.guest_name: {e}")
            conn.rollback()

        try:
            conn.execute(text("""
                ALTER TABLE photos
                ADD COLUMN IF NOT EXISTS guest_ip VARCHAR;
            """))
            conn.commit()
            print("✅ photos.guest_ip added")
        except Exception as e:
            print(f"⚠ photos.guest_ip: {e}")
            conn.rollback()

        # Backfill existing photos as 'owner' uploaded
        try:
            conn.execute(text("""
                UPDATE photos SET uploaded_by = 'owner'
                WHERE uploaded_by IS NULL;
            """))
            conn.commit()
            print("✅ Backfilled existing photos.uploaded_by = 'owner'")
        except Exception as e:
            print(f"⚠ Backfill: {e}")
            conn.rollback()

    print("\n✅ Migration complete.")
    print("\nNext steps:")
    print("  1. Register approval_routes and guest_upload_routes in main.py")
    print("  2. Restart backend: docker compose restart backend")
    print("  3. Enable guest upload per event from the event detail page")


if __name__ == "__main__":
    run_migration()
