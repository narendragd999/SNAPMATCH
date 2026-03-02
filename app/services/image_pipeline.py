"""
app/services/image_pipeline.py

Image optimization pipeline.

For local backend: reads/writes directly to disk (unchanged behaviour).
For minio/r2:
  1. Downloads raw file to /tmp via storage_service.get_local_temp_path()
  2. Processes entirely on local disk
  3. Uploads optimized JPEG + WebP thumbnail to object store
  4. Cleans up temp files

Returns (optimized_filename, face_numpy_array | None)
"""
import os
import io
import shutil
import numpy as np

from app.core.config import STORAGE_PATH, INDEXES_PATH
from app.services import storage_service

STORAGE_BACKEND    = os.getenv("STORAGE_BACKEND", "local").lower()
STORAGE_SIZE       = 1200   # max side px for stored JPEG
THUMB_SIZE         = 400    # max side px for WebP thumbnail
FACE_DETECTION_SIZE = 640   # max side px for face detection array
JPEG_QUALITY       = 85


def process_image(raw_filename: str, event_id: int) -> tuple[str | None, np.ndarray | None]:
    """
    Main entry point called by Celery process_single_photo task.

    raw_filename:  e.g. "raw_abc123.jpg"  (stored in object store or local disk)
    Returns: (optimized_filename, face_np)
    """
    base_name = os.path.splitext(raw_filename)[0].removeprefix("raw_").removeprefix("guest_")

    # ── Get a local path the pipeline can read from ────────────────────────────
    raw_local_path = storage_service.get_local_temp_path(event_id, raw_filename)

    # ── Working directory for output files ────────────────────────────────────
    tmp_event_dir = _get_tmp_dir(event_id)
    os.makedirs(tmp_event_dir, exist_ok=True)
    thumb_dir = os.path.join(tmp_event_dir, "thumbnails")
    os.makedirs(thumb_dir, exist_ok=True)

    optimized_filename = None
    face_np            = None

    try:
        optimized_filename, face_np = _run_pipeline(
            raw_local_path, tmp_event_dir, thumb_dir, base_name
        )

        if optimized_filename:
            opt_local_path   = os.path.join(tmp_event_dir, optimized_filename)
            thumb_local_path = os.path.join(thumb_dir, f"{base_name}.webp")

            if STORAGE_BACKEND != "local":
                # Upload optimized JPEG
                storage_service.upload_from_local_path(
                    opt_local_path, event_id, optimized_filename, "image/jpeg"
                )
                # Upload thumbnail
                storage_service.upload_thumbnail_from_local_path(
                    thumb_local_path, event_id, f"{base_name}.webp"
                )
                # Clean temp raw
                storage_service.release_local_temp_path(event_id, raw_filename)
            # For local backend, files are already in the right place (STORAGE_PATH/event_id/)
    except Exception as e:
        print(f"❌ Pipeline failed for {raw_filename}: {e}")
        import traceback; traceback.print_exc()
        storage_service.release_local_temp_path(event_id, raw_filename)
        return None, None

    return optimized_filename, face_np


def _get_tmp_dir(event_id: int) -> str:
    if STORAGE_BACKEND == "local":
        return os.path.join(STORAGE_PATH, str(event_id))
    return f"/tmp/snapfind/{event_id}"


def _run_pipeline(
    raw_path: str,
    out_dir:  str,
    thumb_dir: str,
    base_name: str,
) -> tuple[str | None, np.ndarray | None]:
    """Try pyvips first, fall back to Pillow."""
    try:
        import pyvips
        return _process_pyvips(raw_path, out_dir, thumb_dir, base_name)
    except ImportError:
        pass
    except Exception as e:
        print(f"⚠ pyvips failed ({e}), trying Pillow")

    try:
        return _process_pillow(raw_path, out_dir, thumb_dir, base_name)
    except Exception as e:
        print(f"❌ Pillow also failed: {e}")
        return None, None


def _process_pyvips(raw_path, out_dir, thumb_dir, base_name):
    import pyvips

    # Determine shrink factor
    shrink = 1
    try:
        meta   = pyvips.Image.new_from_file(raw_path, access="sequential")
        longest = max(meta.width, meta.height)
        if longest >= 1600: shrink = 2
        if longest >= 3200: shrink = 4
        if longest >= 6400: shrink = 8
    except Exception:
        pass

    full_img = pyvips.Image.new_from_file(
        raw_path,
        access=pyvips.enums.Access.RANDOM,
        shrink=shrink,
    )
    full_img = full_img.autorot()
    if full_img.bands == 4:
        full_img = full_img.flatten(background=[255, 255, 255])

    base_img = full_img.thumbnail_image(STORAGE_SIZE)

    # Storage JPEG
    jpeg_filename = f"{base_name}.jpg"
    storage_path  = os.path.join(out_dir, jpeg_filename)
    base_img.jpegsave(storage_path, Q=JPEG_QUALITY, optimize_coding=True)

    # WebP thumbnail
    thumb_path = os.path.join(thumb_dir, f"{base_name}.webp")
    base_img.thumbnail_image(THUMB_SIZE).webpsave(thumb_path, Q=75, effort=1)

    # Face detection array (640px, in memory only)
    face_np = None
    try:
        face_img = full_img.thumbnail_image(FACE_DETECTION_SIZE)
        face_np  = np.ndarray(
            buffer=face_img.write_to_memory(),
            dtype=np.uint8,
            shape=[face_img.height, face_img.width, face_img.bands],
        )
    except Exception as e:
        print(f"⚠ numpy conversion failed ({e}), InsightFace will load from disk")

    return jpeg_filename, face_np


def _process_pillow(raw_path, out_dir, thumb_dir, base_name):
    from PIL import Image as PILImage, ImageOps

    img = PILImage.open(raw_path)
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    # Resize
    img.thumbnail((STORAGE_SIZE, STORAGE_SIZE), PILImage.LANCZOS)

    jpeg_filename = f"{base_name}.jpg"
    storage_path  = os.path.join(out_dir, jpeg_filename)
    img.save(storage_path, "JPEG", quality=JPEG_QUALITY, optimize=True)

    # Thumbnail
    thumb = img.copy()
    thumb.thumbnail((THUMB_SIZE, THUMB_SIZE), PILImage.LANCZOS)
    thumb_path = os.path.join(thumb_dir, f"{base_name}.webp")
    thumb.save(thumb_path, "WEBP", quality=75)

    # Face detection array
    face_np = None
    try:
        face_img = img.copy()
        face_img.thumbnail((FACE_DETECTION_SIZE, FACE_DETECTION_SIZE), PILImage.LANCZOS)
        face_np = np.array(face_img.convert("RGB"))
    except Exception:
        pass

    return jpeg_filename, face_np
