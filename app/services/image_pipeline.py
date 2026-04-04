"""
app/services/image_pipeline.py

★ OPTIMIZED FOR GHA: Smaller intermediate sizes = faster processing ★
"""

import os
import io
import shutil
import numpy as np
import time
import logging

from app.core.config import STORAGE_PATH, INDEXES_PATH
from app.services import storage_service
from app.services.image_normalizer import normalize_to_jpeg

logger = logging.getLogger(__name__)

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()

# ★ REDUCED SIZES FOR FASTER PROCESSING ★
STORAGE_SIZE = 1400        # Was 1600 - 12% fewer pixels
THUMB_SIZE = 320           # Was 400 - 36% fewer pixels (thumbnails don't need to be big!)
FACE_DETECTION_SIZE = 480  # Was 640 - 44% fewer pixels (BIGGEST WIN!)
JPEG_QUALITY = 82          # Was 85 - slightly smaller files, visually identical

# Performance tracking
_perf_stats = {
    'total_images': 0,
    'total_time': 0,
}


def process_image(raw_filename: str, event_id: int) -> tuple:
    """
    Main entry point - optimized for speed on CPU-bound systems.
    
    Returns: (optimized_filename, face_numpy_array | None)
    """
    global _perf_stats
    t_start = time.time()
    _perf_stats['total_images'] += 1
    
    base_name = os.path.splitext(raw_filename)[0].removeprefix("raw_").removeprefix("guest_")

    # Get local path (download from MinIO if needed)
    raw_local_path = storage_service.get_local_temp_path(event_id, raw_filename)

    # Normalize format (PNG/WebP → JPEG)
    normalized_path = None
    try:
        raw_local_path, was_converted = normalize_to_jpeg(raw_local_path)
        normalized_path = raw_local_path if was_converted else None
    except Exception as e:
        logger.error(f"❌ Normalization failed for {raw_filename}: {e}")
        storage_service.release_local_temp_path(event_id, raw_filename)
        return None, None

    # Setup output directories
    tmp_event_dir = _get_tmp_dir(event_id)
    os.makedirs(tmp_event_dir, exist_ok=True)
    thumb_dir = os.path.join(tmp_event_dir, "thumbnails")
    os.makedirs(thumb_dir, exist_ok=True)

    optimized_filename = None
    face_np = None

    try:
        # Run processing pipeline
        optimized_filename, face_np = _run_pipeline(
            raw_local_path, tmp_event_dir, thumb_dir, base_name
        )

        if optimized_filename:
            opt_local_path = os.path.join(tmp_event_dir, optimized_filename)
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

                # Cleanup
                storage_service.release_local_temp_path(event_id, raw_filename)
                storage_service.delete_file(event_id, raw_filename)

    except Exception as e:
        logger.error(f"❌ Pipeline failed for {raw_filename}: {e}")
        import traceback
        traceback.print_exc()
        storage_service.release_local_temp_path(event_id, raw_filename)
        optimized_filename = None
    finally:
        # Cleanup normalized temp file
        try:
            if normalized_path and os.path.exists(normalized_path):
                os.remove(normalized_path)
        except Exception as cleanup_err:
            logger.warning(f"⚠ Cleanup error: {cleanup_err}")

    # Track performance
    elapsed = time.time() - t_start
    _perf_stats['total_time'] += elapsed
    
    if _perf_stats['total_images'] % 100 == 0:
        avg = _perf_stats['total_time'] / _perf_stats['total_images']
        logger.info(
            f"📊 Pipeline avg: {avg:.2f}s/image "
            f"({_perf_stats['total_images']} images processed)"
        )

    return optimized_filename, face_np


def _get_tmp_dir(event_id: int) -> str:
    if STORAGE_BACKEND == "local":
        return os.path.join(STORAGE_PATH, str(event_id))
    return f"/tmp/snapfind/{event_id}"  # Will be on tmpfs!


def _run_pipeline(raw_path, out_dir, thumb_dir, base_name):
    """Try pyvips first, fall back to Pillow"""
    try:
        import pyvips
        return _process_pyvips(raw_path, out_dir, thumb_dir, base_name)
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"⚠ pyvips failed ({e}), trying Pillow")

    try:
        return _process_pillow(raw_path, out_dir, thumb_dir, base_name)
    except Exception as e:
        logger.error(f"❌ Pillow also failed: {e}")
        return None, None


def _process_pyvips(raw_path, out_dir, thumb_dir, base_name):
    """Process with pyvips (memory-efficient streaming)"""
    import pyvips

    # Determine shrink factor based on image size
    shrink = 1
    try:
        # Use sequential access for fast metadata reading
        meta = pyvips.Image.new_from_file(raw_path, access="sequential")
        longest = max(meta.width, meta.height)
        
        # ★ AGGRESSIVE DOWNSAMPLING FOR LARGE IMAGES ★
        if longest >= 3200: shrink = 4      # Very large: 4x shrink
        elif longest >= 2000: shrink = 3    # Large: 3x shrink
        elif longest >= 1400: shrink = 2    # Medium: 2x shrink
        # else: no shrink for small images
    except Exception:
        pass

    # Load image with shrink (much less memory!)
    full_img = pyvips.Image.new_from_file(
        raw_path,
        access=pyvips.enums.Access.RANDOM,
        shrink=shrink,
    )
    
    # Auto-rotate based on EXIF
    full_img = full_img.autorot()
    
    # Remove alpha channel if present (saves memory)
    if full_img.bands == 4:
        full_img = full_img.flatten(background=[255, 255, 255])

    # Create optimized storage version
    base_img = full_img.thumbnail_image(STORAGE_SIZE)
    
    # Save as JPEG
    jpeg_filename = f"{base_name}.jpg"
    storage_path = os.path.join(out_dir, jpeg_filename)
    base_img.jpegsave(storage_path, Q=JPEG_QUALITY, optimize_coding=True)

    # Generate WebP thumbnail (smaller size now!)
    thumb_path = os.path.join(thumb_dir, f"{base_name}.webp")
    base_img.thumbnail_image(THUMB_SIZE).webpsave(thumb_path, Q=70, effort=2)  # Better compression

    # ★ KEY OPTIMIZATION: Smaller face detection array! ★
    face_np = None
    try:
        face_img = full_img.thumbnail_image(FACE_DETECTION_SIZE)  # 480px instead of 640px
        face_np = np.ndarray(
            buffer=face_img.write_to_memory(),
            dtype=np.uint8,
            shape=[face_img.height, face_img.width, face_img.bands],
        )
    except Exception as e:
        logger.debug(f"⚠ Could not create face array ({e})")

    return jpeg_filename, face_np


def _process_pillow(raw_path, out_dir, thumb_dir, base_name):
    """Fallback: Process with Pillow"""
    from PIL import Image as PILImage, ImageOps

    img = PILImage.open(raw_path)
    img = ImageOps.exif_transpose(img)
    
    # Convert to RGB if needed
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    # Resize for storage
    img.thumbnail((STORAGE_SIZE, STORAGE_SIZE), PILImage.LANCZOS)

    # Save optimized JPEG
    jpeg_filename = f"{base_name}.jpg"
    storage_path = os.path.join(out_dir, jpeg_filename)
    img.save(storage_path, "JPEG", quality=JPEG_QUALITY, optimize=True)

    # Generate smaller thumbnail
    thumb = img.copy()
    thumb.thumbnail((THUMB_SIZE, THUMB_SIZE), PILImage.LANCZOS)
    thumb_path = os.path.join(thumb_dir, f"{base_name}.webp")
    thumb.save(thumb_path, "WEBP", quality=70)  # Slightly lower quality for size

    # Create face detection array (smaller!)
    face_np = None
    try:
        face_img = img.copy()
        face_img.thumbnail((FACE_DETECTION_SIZE, FACE_DETECTION_SIZE), PILImage.LANCZOS)
        face_np = np.array(face_img.convert("RGB"))
    except Exception:
        pass

    return jpeg_filename, face_np