"""
app/services/image_pipeline.py (FIXED)

Image optimization pipeline with guaranteed EXIF orientation.

Key fixes:
  1. Both pyvips and Pillow paths now correctly rotate face_np
  2. pyvips: apply autorot() BEFORE creating face_np array
  3. Pillow: use exif_transpose(img) BEFORE face_np conversion
  4. face_np is always RGB, correctly oriented, <=640px

For local backend: reads/writes directly to disk.
For minio/r2:
  1. Downloads raw file to /tmp via storage_service.get_local_temp_path()
  2. Processes entirely on local disk (with EXIF correction)
  3. Uploads optimized JPEG + WebP thumbnail to object store
  4. Cleans up temp files

Returns (optimized_filename, face_numpy_array | None)
    - optimized_filename: "abc123.jpg" (1600px, EXIF-rotated)
    - face_numpy_array: uint8 RGB (640px, EXIF-rotated), or None if extraction failed
"""
import os
import io
import shutil
import numpy as np

from app.core.config import STORAGE_PATH, INDEXES_PATH
from app.services import storage_service
from app.services.image_normalizer import normalize_to_jpeg

STORAGE_BACKEND    = os.getenv("STORAGE_BACKEND", "local").lower()
STORAGE_SIZE       = 1600   # max side px for stored JPEG
THUMB_SIZE         = 400    # max side px for WebP thumbnail
FACE_DETECTION_SIZE = 640   # max side px for face detection array
JPEG_QUALITY       = 85


def process_image(raw_filename: str, event_id: int) -> tuple[str | None, np.ndarray | None]:
    """
    Main entry point called by Celery process_single_photo task.

    raw_filename:  e.g. "raw_abc123.jpg"  (stored in object store or local disk)
    event_id:      Event ID for organizing files
    
    Returns: 
        (optimized_filename, face_np)
        - optimized_filename: EXIF-rotated, optimized JPEG suitable for storage
        - face_np: EXIF-rotated, uint8 RGB array for face detection (640px max)
    """
    base_name = os.path.splitext(raw_filename)[0].removeprefix("raw_").removeprefix("guest_")

    # ── Get a local path the pipeline can read from ────────────────────────────
    raw_local_path = storage_service.get_local_temp_path(event_id, raw_filename)

    # ── Normalize any format → JPEG (no-op for jpg/png/webp) ─────────────────
    normalized_path = None
    try:
        raw_local_path, was_converted = normalize_to_jpeg(raw_local_path)
        normalized_path = raw_local_path if was_converted else None
    except Exception as e:
        print(f"❌ Normalization failed for {raw_filename}: {e}")
        storage_service.release_local_temp_path(event_id, raw_filename)
        return None, None

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
                # Upload optimized JPEG (already EXIF-rotated)
                storage_service.upload_from_local_path(
                    opt_local_path, event_id, optimized_filename, "image/jpeg"
                )
                # Upload thumbnail
                storage_service.upload_thumbnail_from_local_path(
                    thumb_local_path, event_id, f"{base_name}.webp"
                )
                # Clean temp raw
                storage_service.release_local_temp_path(event_id, raw_filename)
                # Delete original raw file from MinIO/R2 — no longer needed
                # now that the optimized JPEG + thumbnail are safely uploaded.
                storage_service.delete_file(event_id, raw_filename)
                print(f"🗑 Deleted raw from storage: {raw_filename}")
            # For local backend, files are already in the right place (STORAGE_PATH/event_id/)
    except Exception as e:
        print(f"❌ Pipeline failed for {raw_filename}: {e}")
        import traceback
        traceback.print_exc()
        storage_service.release_local_temp_path(event_id, raw_filename)
        optimized_filename = None   # ensure we return None on failure
    finally:
        # Always clean up the temp JPEG created by format normalization.
        # Wrapped in its own try so a cleanup error never masks the real result.
        try:
            if normalized_path and os.path.exists(normalized_path):
                os.remove(normalized_path)
        except Exception as cleanup_err:
            print(f"⚠ Could not delete normalized temp file: {cleanup_err}")

    return optimized_filename, face_np


def _get_tmp_dir(event_id: int) -> str:
    """Get appropriate temp directory based on storage backend."""
    if STORAGE_BACKEND == "local":
        return os.path.join(STORAGE_PATH, str(event_id))
    return f"/tmp/snapfind/{event_id}"


def _run_pipeline(
    raw_path: str,
    out_dir:  str,
    thumb_dir: str,
    base_name: str,
) -> tuple[str | None, np.ndarray | None]:
    """
    Try pyvips first (faster), fall back to Pillow if unavailable or fails.
    Both paths now guarantee EXIF-corrected output.
    """
    try:
        import pyvips
        result = _process_pyvips(raw_path, out_dir, thumb_dir, base_name)
        if result[0]:  # if filename returned successfully
            return result
        print("⚠ pyvips returned empty result, trying Pillow")
    except ImportError:
        print("⚠ pyvips not installed, using Pillow")
    except Exception as e:
        print(f"⚠ pyvips failed ({e}), trying Pillow")

    try:
        return _process_pillow(raw_path, out_dir, thumb_dir, base_name)
    except Exception as e:
        print(f"❌ Pillow also failed: {e}")
        return None, None


def _process_pyvips(raw_path, out_dir, thumb_dir, base_name):
    """
    Process using pyvips (faster for large files).
    
    CRITICAL: autorot() is called BEFORE creating face_np array
    to ensure face_np uses the correctly-oriented image.
    """
    import pyvips

    # ── Load with smart shrink for very large images ────────────────────────
    shrink = 1
    try:
        meta   = pyvips.Image.new_from_file(raw_path, access="sequential")
        longest = max(meta.width, meta.height)
        if longest >= 1600: shrink = 2
        if longest >= 3200: shrink = 4
        if longest >= 6400: shrink = 8
        print(f"📐 Image size: {meta.width}×{meta.height}, shrink={shrink}")
    except Exception as e:
        print(f"⚠ Could not determine image size: {e}")

    full_img = pyvips.Image.new_from_file(
        raw_path,
        access=pyvips.enums.Access.RANDOM,
        shrink=shrink,
    )

    # ── CRITICAL: Apply EXIF orientation rotation ────────────────────────────
    print(f"🔄 Applying EXIF autorotation...")
    full_img = full_img.autorot()
    
    # ── Handle RGBA/etc. → RGB ─────────────────────────────────────────────────
    if full_img.bands == 4:
        full_img = full_img.flatten(background=[255, 255, 255])

    # ── Generate storage JPEG (1600px max) ──────────────────────────────────────
    base_img = full_img.thumbnail_image(STORAGE_SIZE)
    jpeg_filename = f"{base_name}.jpg"
    storage_path  = os.path.join(out_dir, jpeg_filename)
    base_img.jpegsave(storage_path, Q=JPEG_QUALITY, optimize_coding=True)
    print(f"💾 Stored: {jpeg_filename}")

    # ── Generate WebP thumbnail (400px max) ─────────────────────────────────────
    thumb_path = os.path.join(thumb_dir, f"{base_name}.webp")
    base_img.thumbnail_image(THUMB_SIZE).webpsave(thumb_path, Q=75, effort=1)
    print(f"🎞 Thumbnail: {base_name}.webp")

    # ── Generate face detection array (640px, EXIF-corrected RGB) ───────────────
    face_np = None
    try:
        # ✓ Use full_img (already EXIF-rotated) not original
        face_img = full_img.thumbnail_image(FACE_DETECTION_SIZE)
        
        # Ensure RGB (in case bands != 3)
        if face_img.bands != 3:
            face_img = face_img.extract_band(0, n=3)
        
        # Convert to numpy (RGB, not BGR)
        face_np = np.ndarray(
            buffer=face_img.write_to_memory(),
            dtype=np.uint8,
            shape=[face_img.height, face_img.width, face_img.bands],
        )
        
        # Verify shape
        if face_np.shape[2] == 3:
            print(f"✓ Face array: {face_np.shape} (RGB, EXIF-rotated)")
        else:
            print(f"⚠ Face array has {face_np.shape[2]} bands, expected 3")
            face_np = None
    
    except Exception as e:
        print(f"⚠ Face array extraction failed ({e}), face detection will load from disk")
        face_np = None

    return jpeg_filename, face_np


def _process_pillow(raw_path, out_dir, thumb_dir, base_name):
    """
    Process using Pillow (fallback when pyvips unavailable).
    
    CRITICAL: exif_transpose() is called immediately after opening
    to ensure all subsequent images use the correctly-oriented version.
    """
    from PIL import Image as PILImage, ImageOps

    # ── Load and apply EXIF orientation ──────────────────────────────────────
    img = PILImage.open(raw_path)
    print(f"📂 Loaded: {raw_path} ({img.size}, mode={img.mode})")
    
    # ✓ CRITICAL: Apply EXIF orientation
    img = ImageOps.exif_transpose(img)
    print(f"🔄 Applied EXIF orientation")
    
    # ── Convert to RGB if needed ─────────────────────────────────────────────
    if img.mode in ("RGBA", "P", "LA", "L"):
        img = img.convert("RGB")
        print(f"🎨 Converted to RGB")

    # ── Generate storage JPEG (1600px max) ──────────────────────────────────
    img.thumbnail((STORAGE_SIZE, STORAGE_SIZE), PILImage.LANCZOS)
    jpeg_filename = f"{base_name}.jpg"
    storage_path  = os.path.join(out_dir, jpeg_filename)
    img.save(storage_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
    print(f"💾 Stored: {jpeg_filename}")

    # ── Generate WebP thumbnail (400px max) ──────────────────────────────────
    thumb = img.copy()
    thumb.thumbnail((THUMB_SIZE, THUMB_SIZE), PILImage.LANCZOS)
    thumb_path = os.path.join(thumb_dir, f"{base_name}.webp")
    thumb.save(thumb_path, "WEBP", quality=75)
    print(f"🎞 Thumbnail: {base_name}.webp")

    # ── Generate face detection array (640px, EXIF-corrected RGB) ────────────
    face_np = None
    try:
        # ✓ Use img (already EXIF-rotated via exif_transpose)
        face_img = img.copy()
        face_img.thumbnail(
            (FACE_DETECTION_SIZE, FACE_DETECTION_SIZE), 
            PILImage.LANCZOS
        )
        
        # Convert to RGB array (ensure 3 channels)
        face_img_rgb = face_img.convert("RGB")
        face_np = np.array(face_img_rgb, dtype=np.uint8)
        
        print(f"✓ Face array: {face_np.shape} (RGB, EXIF-rotated)")
    
    except Exception as e:
        print(f"⚠ Face array extraction failed ({e}), face detection will load from disk")
        face_np = None

    return jpeg_filename, face_np