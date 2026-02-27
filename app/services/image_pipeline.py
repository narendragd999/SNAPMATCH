"""
image_pipeline.py — Raw photo optimization using pyvips (Pillow fallback included).

WHY PYVIPS REPLACES PILLOW HERE:
  The old code used Pillow which fully decodes the entire image into RAM before
  resizing. A 24MP JPEG (6000×4000) = ~69MB decoded bitmap, just to throw most
  of it away scaling to 1200px. This caused the 5–9s "opt spikes" in logs.

  pyvips uses shrink-on-load: for a 6000px → 1200px resize it only decodes at
  ~2× target size from the JPEG DCT stream. The full bitmap never exists in RAM.

OPTIMIZATIONS vs original Pillow version:
  ┌──────────────────────────────────────────┬──────────┬──────────┐
  │ Change                                   │ Before   │ After    │
  ├──────────────────────────────────────────┼──────────┼──────────┤
  │ RANDOM access (fixes out-of-order crash) │ crash    │ stable   │
  │ Single disk read for all 3 outputs       │ 2+ reads │ 1 read   │
  │ Progressive JPEG interlace (slow write)  │ enabled  │ disabled │
  │ WebP encoding effort                     │ 4 (slow) │ 1 (fast) │
  │ Face detection input (was re-read disk)  │ disk I/O │ in-memory│
  └──────────────────────────────────────────┴──────────┴──────────┘

THE OUT-OF-ORDER BUG — root cause and fix:
  pyvips.Image.thumbnail() uses SEQUENTIAL access by default. Pixels flow
  once, top-to-bottom, through a lazy pipeline. Multiple operations on the
  same object (jpegsave, webpsave, copy_memory, write_to_memory) all compete
  for the same stream position, causing:
      "VipsJpeg: out of order read at line N"

  Fix: pass access=pyvips.enums.Access.RANDOM to thumbnail(). This forces
  pyvips to fully decode the image into RAM before any operations run. All
  subsequent resize/save/numpy calls read from the in-memory buffer safely.

  RAM cost: a 4096x3072 source decoded to 1200px output is ~4MB. Negligible.

RETURN VALUE CHANGE (important — update calling code):
  Old:  fname = process_raw_image(raw_path, event_folder)
  New:  fname, face_np = process_raw_image(raw_path, event_folder)

  face_np is a 640px uint8 numpy array ready for InsightFace.get(face_np).
  Pass it directly instead of cv2.imread() to avoid an extra disk read.
  face_np is None when pyvips is unavailable or numpy conversion fails.

DOCKERFILE — add these lines before pip install:
    RUN apt-get update && apt-get install -y libvips-dev && rm -rf /var/lib/apt/lists/*

REQUIREMENTS:
    pyvips>=2.2.1
    numpy>=1.21.0
"""

import os
import uuid
import numpy as np
from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError

ImageFile.LOAD_TRUNCATED_IMAGES = True

# ── Sizes ────────────────────────────────────────────────────────────────────
# 640px matches InsightFace internal detection input — no redundant resize.
FACE_DETECTION_SIZE = 640

# Storage JPEG served to end users. Set to None to skip saving a full-size copy.
STORAGE_SIZE = 1200

THUMB_SIZE   = 400
JPEG_QUALITY = 85

# Detect pyvips once at import time — no error if not installed
try:
    import pyvips
    _PYVIPS_AVAILABLE = True
except ImportError:
    _PYVIPS_AVAILABLE = False


# ──────────────────────────────────────────────────────────────────────────────
# pyvips implementation
# ──────────────────────────────────────────────────────────────────────────────

def _process_pyvips(raw_path: str, event_folder: str, base_name: str):
    """
    Returns (jpeg_filename: str | None, face_np: np.ndarray | None)

    All three outputs (storage JPEG, WebP thumbnail, face detection array)
    are produced from a single disk read using RANDOM access mode.
    """
    thumb_folder = os.path.join(event_folder, "thumbnails")
    os.makedirs(thumb_folder, exist_ok=True)

    # ── Single disk read with RANDOM access ───────────────────────────────────
    # RANDOM forces full decode into RAM upfront. Without it, pyvips uses a
    # lazy sequential stream — jpegsave consumes the stream, then any second
    # operation (webpsave, write_to_memory, copy_memory) fails with:
    #     "VipsJpeg: out of order read at line N"
    # RANDOM access costs ~4MB RAM per image (decoded 1200px RGB). Acceptable.
    # ── Load with new_from_file(RANDOM) — works on ALL pyvips >= 2.1.x ─────────
    # thumbnail(access=RANDOM) requires newer pyvips and raises:
    #     "thumbnail does not support optional argument access"
    # new_from_file(RANDOM) forces full decode into RAM before any operations,
    # eliminating the sequential-stream conflict that caused:
    #     "VipsJpeg: out of order read at line N"

    # Determine JPEG shrink factor dynamically
    # Target = STORAGE_SIZE (1200)
    # JPEG supports shrink factors: 1, 2, 4, 8
  
    # Determine best shrink factor (JPEG supports 1,2,4,8)
    # Aggressive shrink for performance
    shrink = 1

    try:
        meta = pyvips.Image.new_from_file(raw_path, access="sequential")
        longest = max(meta.width, meta.height)

        if longest >= 1600:
            shrink = 2
        if longest >= 3200:
            shrink = 4
        if longest >= 6400:
            shrink = 8

    except Exception:
        shrink = 1

    full_img = pyvips.Image.new_from_file(
        raw_path,
        access=pyvips.enums.Access.RANDOM,
        shrink=shrink
    )

    full_img = full_img.autorot()

    if full_img.bands == 4:
        full_img = full_img.flatten(background=[255, 255, 255])

    # Resize to storage size using thumbnail_image() — safe on RANDOM-decoded image
    base_img = full_img.thumbnail_image(STORAGE_SIZE)

    # ── Storage JPEG (1200px for serving to users) ────────────────────────────
    storage_path = os.path.join(event_folder, f"{base_name}.jpg")
    base_img.jpegsave(storage_path, Q=JPEG_QUALITY, optimize_coding=True)
    jpeg_filename = f"{base_name}.jpg"

    # ── WebP Thumbnail (400px) — from in-memory base_img, no 2nd disk read ───
    thumb_path = os.path.join(thumb_folder, f"{base_name}.webp")
    base_img.thumbnail_image(THUMB_SIZE).webpsave(thumb_path, Q=75, effort=1)

    # ── Face detection array (640px) — never written to disk ─────────────────
    face_np = None
    try:
        face_img = full_img.thumbnail_image(FACE_DETECTION_SIZE)
        face_np = np.ndarray(
            buffer=face_img.write_to_memory(),
            dtype=np.uint8,
            shape=[face_img.height, face_img.width, face_img.bands],
        )
    except Exception as e:
        print(f"⚠ numpy conversion failed for {raw_path} ({e}), InsightFace will load from disk")

    return jpeg_filename, face_np


# ──────────────────────────────────────────────────────────────────────────────
# Pillow fallback
# ──────────────────────────────────────────────────────────────────────────────

def _process_pillow(raw_path: str, event_folder: str, base_name: str):
    """
    Pillow fallback — used when pyvips is unavailable or fails on exotic formats.
    Returns (jpeg_filename, None) — face_np always None on Pillow path.
    """
    jpeg_path = os.path.join(event_folder, f"{base_name}.jpg")
    thumb_folder = os.path.join(event_folder, "thumbnails")
    os.makedirs(thumb_folder, exist_ok=True)
    thumb_path = os.path.join(thumb_folder, f"{base_name}.webp")

    with Image.open(raw_path) as img:
        img.verify()

    with Image.open(raw_path) as img:
        img = ImageOps.exif_transpose(img)  # fix rotation before decode
        img = img.convert("RGB")

        if STORAGE_SIZE and max(img.size) > STORAGE_SIZE:
            img.thumbnail((STORAGE_SIZE, STORAGE_SIZE), Image.LANCZOS)

        img.save(
            jpeg_path,
            "JPEG",
            quality=JPEG_QUALITY,
            optimize=True,
            progressive=True,
        )

        thumb = img.copy()
        thumb.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
        thumb.save(thumb_path, "WEBP", quality=75, method=1)

    return f"{base_name}.jpg", None


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def process_raw_image(raw_path: str, event_folder: str):
    """
    Optimize a raw upload to a storage JPEG + WebP thumbnail + face detection array.

    Returns:
        (jpeg_filename: str | None, face_np: np.ndarray | None)

        jpeg_filename -- optimized JPEG filename e.g. 'abc123.jpg', or None on failure
        face_np       -- 640px uint8 numpy array for InsightFace, or None if unavailable

    ── IMPORTANT: update your calling code ──────────────────────────────────────
    Old (returns str, causes 'join() got tuple' error):
        fname = process_raw_image(raw_path, event_folder)
        faces = app.get(cv2.imread(os.path.join(event_folder, fname)))

    New (returns tuple):
        fname, face_np = process_raw_image(raw_path, event_folder)
        if fname:
            if face_np is not None:
                faces = app.get(face_np)               # fast: no disk read
            else:
                img = cv2.imread(os.path.join(event_folder, fname))
                faces = app.get(img)                   # fallback: disk read
    ─────────────────────────────────────────────────────────────────────────────
    """
    if not os.path.exists(raw_path) or os.path.getsize(raw_path) < 1024:
        print(f"⚠ Skipping invalid/tiny file: {raw_path}")
        return None, None

    try:
        os.makedirs(event_folder, exist_ok=True)
        base_name = str(uuid.uuid4())

        if _PYVIPS_AVAILABLE:
            try:
                return _process_pyvips(raw_path, event_folder, base_name)
            except Exception as e:
                print(f"⚠ pyvips failed for {raw_path} ({e}), retrying with Pillow")

        return _process_pillow(raw_path, event_folder, base_name)

    except (UnidentifiedImageError, OSError) as e:
        print(f"❌ Corrupted image skipped: {raw_path} | Error: {e}")
        return None, None

    except Exception as e:
        print(f"🔥 Unexpected error processing {raw_path}: {e}")
        return None, None