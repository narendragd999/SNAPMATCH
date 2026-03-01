#!/usr/bin/env python3
"""
scripts/migrate_to_minio.py

Migrates all existing local storage files to MinIO (or R2).
Run this ONCE when switching from local to minio/r2 backend.

Usage:
  STORAGE_BACKEND=minio python scripts/migrate_to_minio.py

What it does:
  - Walks ./storage/
  - Uploads every file to MinIO under events/{event_id}/...
  - Prints progress

Safe to re-run — existing objects are skipped (HEAD check).
"""
import os
import sys
import json
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "http://localhost:9000")
ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
BUCKET     = os.getenv("MINIO_BUCKET",     "snapfind")
LOCAL_ROOT = os.getenv("STORAGE_PATH",     "./storage")

CONTENT_TYPES = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
}


def _object_exists(s3, key: str) -> bool:
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except ClientError:
        return False


def main():
    if not os.path.isdir(LOCAL_ROOT):
        print(f"❌ Storage directory not found: {LOCAL_ROOT}")
        sys.exit(1)

    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )

    print(f"📦 Migrating {LOCAL_ROOT} → MinIO bucket '{BUCKET}' at {ENDPOINT}\n")

    total = skipped = uploaded = failed = 0

    for root, dirs, files in os.walk(LOCAL_ROOT):
        # Build the object key prefix from relative path
        rel_root = os.path.relpath(root, LOCAL_ROOT)

        for filename in files:
            local_path = os.path.join(root, filename)
            ext = Path(filename).suffix.lower()

            if ext not in CONTENT_TYPES:
                continue

            total += 1

            # Map local path structure to object key
            # Local:  storage/3/thumbnails/abc.webp
            # Key:    events/3/thumbnails/abc.webp
            # Local:  storage/covers/xyz.jpg
            # Key:    covers/xyz.jpg
            if rel_root == ".":
                # Root level — shouldn't normally have files
                continue
            elif rel_root.startswith("covers"):
                key = f"covers/{filename}"
            else:
                # rel_root is like "3" or "3/thumbnails" or "3/guest_previews"
                parts = rel_root.replace("\\", "/").split("/")
                event_id = parts[0]
                sub      = "/".join(parts[1:])
                if sub:
                    key = f"events/{event_id}/{sub}/{filename}"
                else:
                    key = f"events/{event_id}/{filename}"

            # Skip if already uploaded
            if _object_exists(s3, key):
                skipped += 1
                continue

            content_type = CONTENT_TYPES.get(ext, "application/octet-stream")
            try:
                s3.upload_file(
                    local_path,
                    BUCKET,
                    key,
                    ExtraArgs={"ContentType": content_type},
                )
                uploaded += 1
                print(f"  ✅ {key}")
            except Exception as e:
                failed += 1
                print(f"  ❌ {key}: {e}")

    print(f"\n{'='*50}")
    print(f"Migration complete!")
    print(f"  Total files:  {total}")
    print(f"  Uploaded:     {uploaded}")
    print(f"  Skipped:      {skipped} (already existed)")
    print(f"  Failed:       {failed}")

    if failed:
        print(f"\n⚠  {failed} files failed. Re-run to retry.")
        sys.exit(1)


if __name__ == "__main__":
    main()
