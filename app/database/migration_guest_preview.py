"""
Migration: Add guest_preview_filename column to photos table.

Run with:
  docker compose exec backend python -m app.database.migration_guest_preview
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from sqlalchemy import text
from app.database.db import engine


def run_migration():
    print("🔄 Running guest preview migration...")

    with engine.connect() as conn:
        try:
            conn.execute(text("""
                ALTER TABLE photos
                ADD COLUMN IF NOT EXISTS guest_preview_filename VARCHAR;
            """))
            conn.commit()
            print("✅ photos.guest_preview_filename added")
        except Exception as e:
            print(f"⚠ Error: {e}")
            conn.rollback()

    print("✅ Migration complete.")


if __name__ == "__main__":
    run_migration()