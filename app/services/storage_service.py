"""
app/services/storage_service.py

Unified object-storage abstraction.

LOCAL dev  → plain local filesystem (no MinIO needed)
MinIO      → STORAGE_BACKEND=minio  (localhost Docker)
Cloudflare R2 → STORAGE_BACKEND=r2  (just change 4 env vars, same boto3 code)

The public URL returned by get_file_url() is what every API response and
frontend uses to serve images — never a local filesystem path.

Migration to R2:
  1. Set STORAGE_BACKEND=r2
  2. Set MINIO_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
  3. Set MINIO_ACCESS_KEY=<r2-access-key-id>
  4. Set MINIO_SECRET_KEY=<r2-secret-access-key>
  5. Set MINIO_BUCKET=snapfind
  6. Set MINIO_PUBLIC_URL=https://your-custom-domain.com   (R2 public bucket URL)
  That's it. All logic stays identical.
"""

import os
import io
import shutil
from pathlib import Path
from typing import BinaryIO, Optional

# ──────────────────────────────────────────────────────────────────────────────
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()   # local | minio | r2
# ──────────────────────────────────────────────────────────────────────────────

# ── MinIO / R2 config (only needed when backend != local) ─────────────────────
MINIO_ENDPOINT   = os.getenv("MINIO_ENDPOINT",   "http://localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET     = os.getenv("MINIO_BUCKET",     "snapfind")

# Public base URL used to build file URLs returned to the browser.
# MinIO local:  http://localhost:9000/snapfind
# R2 custom:    https://photos.yourdomain.com
MINIO_PUBLIC_URL = os.getenv("MINIO_PUBLIC_URL", f"{MINIO_ENDPOINT}/{MINIO_BUCKET}")

# Public endpoint used to SIGN presigned PUT URLs for the browser.
#
# WHY this exists:
#   boto3 embeds the endpoint host inside the HMAC signature via
#   X-Amz-SignedHeaders=content-type;host. If the signing host is the internal
#   Docker address (minio:9000) but the browser sends the request to a
#   Cloudflare Tunnel URL (https://xxx.trycloudflare.com), the Host header
#   won't match the signature → MinIO returns 403 SignatureDoesNotMatch.
#
#   The fix is NOT to rewrite the URL after signing (the signature is already
#   wrong). Instead we use a SEPARATE boto3 client whose endpoint_url is the
#   public HTTPS address, so signatures are computed with the correct host from
#   the start. The browser PUT, the cloudflared forwarded Host, and the
#   signature all agree.
#
# Usage:
#   Cloudflare Tunnel preview:  MINIO_PRESIGN_ENDPOINT=https://xxx.trycloudflare.com
#   Cloudflare R2:              MINIO_PRESIGN_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
#   Local dev (HTTP is fine):   leave unset → falls back to MINIO_ENDPOINT
_presign_ep_raw        = os.getenv("MINIO_PRESIGN_ENDPOINT", "").strip()
MINIO_PRESIGN_ENDPOINT = (_presign_ep_raw if _presign_ep_raw else MINIO_ENDPOINT).rstrip("/")

# ── Local fallback paths (used only when STORAGE_BACKEND=local) ───────────────
_BASE_DIR   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_LOCAL_ROOT = os.getenv("STORAGE_PATH", os.path.join(_BASE_DIR, "storage"))

# ─────────────────────────────────────────────────────────────────────────────
# boto3 clients (lazy-initialised — not imported at module load to keep local
# mode free of boto3 dependency)
#
# _s3           → internal operations (upload, download, delete, list, head,
#                 bucket creation). Uses MINIO_ENDPOINT (Docker-internal).
#
# _presign_s3   → presigned URL generation ONLY.
#                 Uses MINIO_PRESIGN_ENDPOINT (public HTTPS address) so the
#                 browser's Host header matches the signature.
#                 NEVER used for internal ops — the public URL may not be
#                 reachable from inside Docker.
# ─────────────────────────────────────────────────────────────────────────────
_s3         = None
_presign_s3 = None


def _ensure_bucket(s3_client) -> None:
    """
    Create the MinIO bucket if it doesn't already exist, then apply:
      - public-read policy   → thumbnails and photos load in browser without auth
      - CORS policy          → browser preflight OPTIONS passes for presigned PUTs

    Safe to call multiple times (idempotent).
    """
    import json

    try:
        s3_client.head_bucket(Bucket=MINIO_BUCKET)
        return  # bucket already exists — nothing to do
    except Exception:
        pass  # bucket missing → create it below

    s3_client.create_bucket(Bucket=MINIO_BUCKET)

    # Public-read so thumbnails / photos load directly in browser
    policy = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect":    "Allow",
            "Principal": {"AWS": ["*"]},
            "Action":    ["s3:GetObject"],
            "Resource":  [f"arn:aws:s3:::{MINIO_BUCKET}/*"],
        }]
    }
    s3_client.put_bucket_policy(Bucket=MINIO_BUCKET, Policy=json.dumps(policy))

    # CORS — required for browser preflight OPTIONS before presigned PUTs.
    # Without this every direct-upload attempt silently fails.
    cors = {
        "CORSRules": [{
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
        }]
    }
    s3_client.put_bucket_cors(Bucket=MINIO_BUCKET, CORSConfiguration=cors)


def _get_s3():
    """
    boto3 client for internal S3 operations (upload, download, delete, etc.).
    Uses the Docker-internal MINIO_ENDPOINT.
    Also handles one-time bucket creation + policies on first call (MinIO only).
    """
    global _s3
    if _s3 is None:
        import boto3
        from botocore.config import Config
        _s3 = boto3.client(
            "s3",
            endpoint_url=MINIO_ENDPOINT,
            aws_access_key_id=MINIO_ACCESS_KEY,
            aws_secret_access_key=MINIO_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",          # R2 uses "auto"; MinIO ignores it
        )
        # Ensure bucket exists (MinIO only — R2 bucket is pre-created in dashboard)
        if STORAGE_BACKEND == "minio":
            _ensure_bucket(_s3)
    return _s3


def _get_presign_s3():
    """
    Dedicated boto3 client for presigned URL generation ONLY.

    Uses MINIO_PRESIGN_ENDPOINT (the public HTTPS Cloudflare Tunnel URL or R2
    endpoint) as its endpoint_url so that boto3 computes HMAC signatures that
    include the PUBLIC host. The browser PUT request will carry that same host,
    cloudflared forwards it unchanged to MinIO on localhost:9000, and MinIO
    validates the signature correctly.

    This client must NOT be used for internal operations (upload, list, etc.)
    because the public endpoint may not be network-reachable from inside Docker.
    """
    global _presign_s3
    if _presign_s3 is None:
        import boto3
        from botocore.config import Config
        _presign_s3 = boto3.client(
            "s3",
            endpoint_url=MINIO_PRESIGN_ENDPOINT,   # ← PUBLIC endpoint
            aws_access_key_id=MINIO_ACCESS_KEY,
            aws_secret_access_key=MINIO_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    return _presign_s3


def init_storage() -> None:
    """
    Eagerly initialise storage. Call this from FastAPI's startup event so the
    bucket exists before any presign or upload request arrives.

    - local backend: creates the storage directory tree
    - minio backend: creates bucket + public-read policy + CORS (idempotent)
    - r2 backend:    no-op (bucket is pre-created in the Cloudflare dashboard)
    """
    if STORAGE_BACKEND == "local":
        os.makedirs(_LOCAL_ROOT, exist_ok=True)
    elif STORAGE_BACKEND == "minio":
        # _get_s3() calls _ensure_bucket() on first use — just trigger it now.
        _get_s3()


# ─────────────────────────────────────────────────────────────────────────────
# Internal key helpers
# ─────────────────────────────────────────────────────────────────────────────

def _key(event_id: int, filename: str) -> str:
    """Object key: events/{event_id}/{filename}"""
    return f"events/{event_id}/{filename}"

def _thumb_key(event_id: int, filename: str) -> str:
    """Object key: events/{event_id}/thumbnails/{filename}"""
    return f"events/{event_id}/thumbnails/{filename}"

def _guest_preview_key(event_id: int, filename: str) -> str:
    return f"events/{event_id}/guest_previews/{filename}"

def _cover_key(filename: str) -> str:
    return f"covers/{filename}"


# ─────────────────────────────────────────────────────────────────────────────
# Public API — used by upload_routes, tasks, image_pipeline, public_routes etc.
# ─────────────────────────────────────────────────────────────────────────────

# ── Upload ────────────────────────────────────────────────────────────────────

def upload_file(
    data: bytes | BinaryIO,
    event_id: int,
    filename: str,
    content_type: str = "application/octet-stream",
) -> str:
    """
    Store a photo under events/{event_id}/{filename}.
    Returns the object key (not the public URL).
    """
    key = _key(event_id, filename)
    _put(key, data, content_type)
    return key


def upload_thumbnail(
    data: bytes | BinaryIO,
    event_id: int,
    filename: str,
) -> str:
    key = _thumb_key(event_id, filename)
    _put(key, data, "image/webp")
    return key


def upload_guest_preview(
    data: bytes | BinaryIO,
    event_id: int,
    filename: str,
) -> str:
    key = _guest_preview_key(event_id, filename)
    _put(key, data, "image/webp")
    return key


def upload_cover(
    data: bytes | BinaryIO,
    filename: str,
) -> str:
    key = _cover_key(filename)
    _put(key, data, "image/jpeg")
    return key


# ── Download / read (used by AI pipeline which needs numpy arrays) ─────────────

def download_file(event_id: int, filename: str) -> bytes:
    """Download raw bytes of a stored photo."""
    key = _key(event_id, filename)
    return _get(key)


def file_exists(event_id: int, filename: str) -> bool:
    key = _key(event_id, filename)
    return _exists(key)


def thumbnail_exists(event_id: int, filename: str) -> bool:
    key = _thumb_key(event_id, filename)
    return _exists(key)


def generate_presigned_put_url(
    event_id: int,
    filename: str,
    content_type: str = "application/octet-stream",
    expires_in: int = 3600,
) -> str:
    """
    Return a presigned PUT URL so the browser can upload directly to MinIO/R2,
    bypassing FastAPI entirely (no backend bottleneck, no Cloudflare body limit).

    The URL is signed for ContentType=application/octet-stream.
    The browser MUST send that exact Content-Type header or MinIO/S3 returns
    a SignatureDoesNotMatch 403.

    How signing with the public endpoint works:
        _get_presign_s3() uses MINIO_PRESIGN_ENDPOINT as its boto3 endpoint_url.
        boto3 embeds that host in X-Amz-SignedHeaders=content-type;host.
        The browser PUTs to that same URL → Host header matches the signature.
        cloudflared forwards the request to localhost:9000 unchanged.
        MinIO validates the signature: it matches. ✓

        No URL rewriting is performed — the generated URL is already correct.

    Bucket initialisation (critical on fresh containers):
        _get_s3() is called FIRST every time to guarantee the bucket exists
        before any browser PUT arrives. On a fresh GitHub Actions preview the
        bucket does not exist yet — _get_s3() creates it along with the
        public-read and CORS policies via _ensure_bucket(). Only after that
        is _get_presign_s3() used solely for signature generation.

    Local backend:
        Raises NotImplementedError. The /presign route returns an error entry
        for each affected file; the frontend falls back to legacy multipart
        automatically, so local dev works unchanged.

    MINIO_PRESIGN_ENDPOINT not set (local dev):
        Falls back to MINIO_ENDPOINT. Presigned URLs use the internal address
        which is fine on HTTP. Mixed Content is not a problem on localhost.
    """
    if STORAGE_BACKEND == "local":
        raise NotImplementedError(
            "Presigned PUT URLs are not supported for STORAGE_BACKEND=local. "
            "The frontend falls back to legacy multipart upload automatically."
        )

    # ── Guarantee the bucket exists before the browser tries to PUT ──────────
    # _get_s3() creates bucket + public-read + CORS on first call (idempotent).
    # Skipping this means a fresh MinIO instance returns 404 on presigned PUTs
    # because the bucket doesn't exist yet.
    _get_s3()

    key = _key(event_id, filename)

    # Use the presign-specific client (signed with the PUBLIC host).
    # No URL rewriting needed — the URL already points to the public endpoint.
    url = _get_presign_s3().generate_presigned_url(
        "put_object",
        Params={
            "Bucket":      MINIO_BUCKET,
            "Key":         key,
            "ContentType": content_type,
        },
        ExpiresIn=expires_in,
        HttpMethod="PUT",
    )

    return url


# ── Public URL ────────────────────────────────────────────────────────────────

def get_file_url(event_id: int, filename: str) -> str:
    return _public_url(_key(event_id, filename))

def get_thumbnail_url(event_id: int, filename: str) -> str:
    return _public_url(_thumb_key(event_id, filename))

def get_guest_preview_url(event_id: int, filename: str) -> str:
    return _public_url(_guest_preview_key(event_id, filename))

def get_cover_url(filename: str) -> str:
    return _public_url(_cover_key(filename))


# ── Delete ────────────────────────────────────────────────────────────────────

def delete_file(event_id: int, filename: str) -> None:
    _delete(_key(event_id, filename))

def delete_thumbnail(event_id: int, filename: str) -> None:
    _delete(_thumb_key(event_id, filename))

def delete_guest_preview(event_id: int, filename: str) -> None:
    _delete(_guest_preview_key(event_id, filename))


def delete_event_folder(event_id: int) -> None:
    """Delete ALL objects under events/{event_id}/"""
    prefix = f"events/{event_id}/"
    if STORAGE_BACKEND == "local":
        folder = os.path.join(_LOCAL_ROOT, str(event_id))
        if os.path.exists(folder):
            shutil.rmtree(folder)
    else:
        s3 = _get_s3()
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=MINIO_BUCKET, Prefix=prefix):
            objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if objects:
                s3.delete_objects(Bucket=MINIO_BUCKET, Delete={"Objects": objects})


def delete_cover(filename: str) -> None:
    _delete(_cover_key(filename))


# ── List (used by tasks to iterate all photos in an event) ───────────────────

def list_event_files(event_id: int) -> list[str]:
    """
    Returns list of filenames (not full keys) for the event folder.
    Excludes thumbnails/ and guest_previews/ sub-prefixes.
    """
    prefix = f"events/{event_id}/"
    if STORAGE_BACKEND == "local":
        folder = os.path.join(_LOCAL_ROOT, str(event_id))
        if not os.path.exists(folder):
            return []
        return [
            f for f in os.listdir(folder)
            if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
            and os.path.isfile(os.path.join(folder, f))
        ]
    else:
        s3 = _get_s3()
        paginator = s3.get_paginator("list_objects_v2")
        filenames = []
        for page in paginator.paginate(Bucket=MINIO_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                rel = key[len(prefix):]
                if "/" not in rel and rel.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    filenames.append(rel)
        return filenames


# ── Local-path helper (for Celery tasks that still need a temp file on disk) ──

def get_local_temp_path(event_id: int, filename: str) -> str:
    """
    For the AI/processing pipeline that needs a real filesystem path:
    - local backend: returns the actual path
    - minio/r2: downloads to /tmp and returns that path
    Call release_local_temp_path() when done.
    """
    if STORAGE_BACKEND == "local":
        return os.path.join(_LOCAL_ROOT, str(event_id), filename)

    tmp_dir = f"/tmp/snapfind/{event_id}"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, filename)
    if not os.path.exists(tmp_path):
        data = download_file(event_id, filename)
        with open(tmp_path, "wb") as f:
            f.write(data)
    return tmp_path


def release_local_temp_path(event_id: int, filename: str) -> None:
    """Remove temp file downloaded for processing (minio/r2 only)."""
    if STORAGE_BACKEND == "local":
        return
    tmp_path = f"/tmp/snapfind/{event_id}/{filename}"
    if os.path.exists(tmp_path):
        os.remove(tmp_path)


def upload_from_local_path(local_path: str, event_id: int, filename: str, content_type: str = "image/jpeg") -> str:
    """
    After processing pipeline writes optimized file to disk (always local),
    this uploads it to the object store and removes the temp file (if minio/r2).
    Returns the object key.
    """
    if STORAGE_BACKEND == "local":
        return _key(event_id, filename)

    with open(local_path, "rb") as f:
        data = f.read()
    key = upload_file(data, event_id, filename, content_type)
    if local_path.startswith("/tmp/snapfind"):
        os.remove(local_path)
    return key


def upload_thumbnail_from_local_path(local_path: str, event_id: int, filename: str) -> str:
    if STORAGE_BACKEND == "local":
        return _thumb_key(event_id, filename)
    with open(local_path, "rb") as f:
        data = f.read()
    key = upload_thumbnail(data, event_id, filename)
    if local_path.startswith("/tmp/snapfind"):
        os.remove(local_path)
    return key


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _put(key: str, data: bytes | BinaryIO, content_type: str) -> None:
    if STORAGE_BACKEND == "local":
        local_path = os.path.join(_LOCAL_ROOT, *key.split("/"))
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        if isinstance(data, bytes):
            with open(local_path, "wb") as f:
                f.write(data)
        else:
            with open(local_path, "wb") as f:
                shutil.copyfileobj(data, f)
    else:
        s3 = _get_s3()
        if isinstance(data, bytes):
            body = io.BytesIO(data)
        else:
            body = data
        s3.upload_fileobj(body, MINIO_BUCKET, key, ExtraArgs={"ContentType": content_type})


def _get(key: str) -> bytes:
    if STORAGE_BACKEND == "local":
        local_path = os.path.join(_LOCAL_ROOT, *key.split("/"))
        with open(local_path, "rb") as f:
            return f.read()
    else:
        s3 = _get_s3()
        buf = io.BytesIO()
        s3.download_fileobj(MINIO_BUCKET, key, buf)
        return buf.getvalue()


def _exists(key: str) -> bool:
    if STORAGE_BACKEND == "local":
        return os.path.exists(os.path.join(_LOCAL_ROOT, *key.split("/")))
    else:
        try:
            _get_s3().head_object(Bucket=MINIO_BUCKET, Key=key)
            return True
        except Exception:
            return False


def _delete(key: str) -> None:
    if STORAGE_BACKEND == "local":
        local_path = os.path.join(_LOCAL_ROOT, *key.split("/"))
        if os.path.exists(local_path):
            os.remove(local_path)
    else:
        try:
            _get_s3().delete_object(Bucket=MINIO_BUCKET, Key=key)
        except Exception:
            pass


def _public_url(key: str) -> str:
    if STORAGE_BACKEND == "local":
        # Served by FastAPI StaticFiles at /storage
        # key = "events/3/thumbnails/abc.webp"  →  /storage/events/3/thumbnails/abc.webp
        return f"/storage/{key}"
    else:
        return f"{MINIO_PUBLIC_URL.rstrip('/')}/{key}"


# ═══════════════════════════════════════════════════════════════════════════════
# 🎨 BRANDING LOGO STORAGE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════
# These methods support the branding logo upload flow:
#   1. POST /events/{id}/branding/logo-presign → returns presigned PUT URL
#   2. Browser PUTs logo directly to MinIO/R2
#   3. PATCH /events/{id}/branding → stores the public URL
# ─────────────────────────────────────────────────────────────────────────────


def generate_presigned_put(
    object_key:   str,
    content_type: str,
    expires_in:   int = 300,
) -> str:
    """
    Generate a presigned PUT URL so the browser can upload directly to R2/MinIO.

    object_key  : full object path, e.g. "logos/42/abc.png"
    content_type: MIME type, e.g. "image/png"
    expires_in  : seconds until the URL expires (default 5 min)

    Returns the presigned PUT URL string.
    Raises RuntimeError for the local backend (caller handles 501).

    IMPORTANT: Uses _get_presign_s3() which uses MINIO_PRESIGN_ENDPOINT so that
    the signature includes the PUBLIC host. This is critical for Cloudflare Tunnel
    or any scenario where the browser PUTs to a different host than the internal
    MinIO endpoint. See the docstring of _get_presign_s3() for details.
    """
    if STORAGE_BACKEND == "local":
        raise RuntimeError("Presigned PUT not supported on local backend")

    # Ensure bucket exists before generating presigned URL (critical on fresh containers)
    _get_s3()

    # Use the presign-specific client (signed with the PUBLIC host)
    url = _get_presign_s3().generate_presigned_url(
        "put_object",
        Params={
            "Bucket":      MINIO_BUCKET,
            "Key":         object_key,
            "ContentType": content_type,
        },
        ExpiresIn=expires_in,
        HttpMethod="PUT",
    )
    return url


def get_public_url(object_key: str) -> str:
    """
    Return the permanent public URL for an object already in storage.

    Uses MINIO_PUBLIC_URL for consistency with the rest of the codebase.
    This works for MinIO, R2, or any S3-compatible storage.

    For local backend: returns /storage/{object_key} (served by FastAPI StaticFiles)
    """
    if STORAGE_BACKEND == "local":
        # Served by FastAPI StaticFiles at /storage
        return f"/storage/{object_key}"

    # Use the same MINIO_PUBLIC_URL that the rest of the codebase uses
    # This ensures consistency with get_file_url(), get_thumbnail_url(), etc.
    return f"{MINIO_PUBLIC_URL.rstrip('/')}/{object_key}"


def delete_file_by_key(object_key: str) -> None:
    """
    Delete any object from storage by its full key.
    Used when the owner removes their logo.

    For local backend: deletes from local filesystem
    For MinIO/R2: uses the existing _delete() helper which uses _get_s3()
    """
    _delete(object_key)