#!/usr/bin/env python3
"""
scripts/setup_minio.py

Run this ONCE after starting MinIO to:
  1. Create the 'snapfind' bucket
  2. Set a public-read bucket policy (so thumbnails load without signed URLs)
  3. Set CORS policy (required for browser direct PUT uploads via presigned URLs)

Usage:
  python scripts/setup_minio.py
"""
import json
import os
import sys

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "http://localhost:9000")
ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
BUCKET     = os.getenv("MINIO_BUCKET",     "snapfind")


def main():
    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )

    # 1. Create bucket
    try:
        s3.head_bucket(Bucket=BUCKET)
        print(f"✅ Bucket '{BUCKET}' already exists")
    except ClientError as e:
        if e.response["Error"]["Code"] == "404":
            s3.create_bucket(Bucket=BUCKET)
            print(f"✅ Bucket '{BUCKET}' created")
        else:
            print(f"❌ Error checking bucket: {e}")
            sys.exit(1)

    # 2. Public-read policy (so thumbnails / optimized photos load in browser)
    policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect":    "Allow",
                "Principal": {"AWS": ["*"]},
                "Action":    ["s3:GetObject"],
                "Resource":  [f"arn:aws:s3:::{BUCKET}/*"],
            }
        ],
    }
    s3.put_bucket_policy(Bucket=BUCKET, Policy=json.dumps(policy))
    print(f"✅ Public-read policy applied to '{BUCKET}'")

    # 3. CORS policy — required for browser direct PUT (presigned URL uploads)
    #    Without this the browser's preflight OPTIONS request is rejected and
    #    every upload fails silently with a CORS error.
    cors = {
        "CORSRules": [
            {
                "AllowedOrigins": ["*"],
                "AllowedMethods": ["PUT", "GET", "HEAD"],
                "AllowedHeaders": [
                    "Content-Type",
                    "Authorization",
                    "X-Amz-Date",
                    "X-Amz-Content-Sha256",
                    "X-Api-Key",
                    "x-amz-*",
                ],
                "ExposeHeaders":  ["ETag"],
                "MaxAgeSeconds":  86400,
            }
        ]
    }
    s3.put_bucket_cors(Bucket=BUCKET, CORSConfiguration=cors)
    print(f"✅ CORS policy applied to '{BUCKET}' (allows browser PUT uploads)")

    print(f"\n🎉 MinIO setup complete!")
    print(f"   Endpoint:   {ENDPOINT}")
    print(f"   Bucket:     {BUCKET}")
    print(f"   Public URL: {ENDPOINT}/{BUCKET}")
    print(f"\n   Console: http://localhost:9001  (minioadmin / minioadmin)")


if __name__ == "__main__":
    main()