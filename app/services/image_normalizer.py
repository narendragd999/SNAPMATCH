"""
app/services/image_normalizer.py

Global image format normalizer — single source of truth for:
  - Which extensions are accepted
  - Which MIME type maps to which extension
  - Converting ANY Pillow-readable format → JPEG before pipeline processing

Design goals:
  - Zero impact on upload timing  (conversion runs in Celery worker, not API)
  - One place to add new formats  (just add to ACCEPTED_EXTENSIONS + MIME_MAP)
  - pyvips-aware                  (if pyvips can already open the file, skip Pillow conversion)
"""

import os
from PIL import Image as PILImage, ImageOps, UnidentifiedImageError

# ── Accepted at upload time ────────────────────────────────────────────────────
# Add any new extension here — everything else is handled automatically.
ACCEPTED_EXTENSIONS: set[str] = {
    ".jpg", ".jpeg",   # JPEG
    ".png",            # PNG
    ".webp",           # WebP
    ".heic", ".heif",  # Apple HEIC/HEIF
    ".tiff", ".tif",   # TIFF (cameras, scanners)
    ".bmp",            # Bitmap
    ".gif",            # GIF (first frame only)
    ".avif",           # AVIF
}

# Formats pyvips/Pillow handle natively — no pre-conversion needed
_NATIVE_EXTENSIONS: set[str] = {".jpg", ".jpeg", ".png", ".webp"}

# ── MIME map ──────────────────────────────────────────────────────────────────
_MIME_MAP: dict[str, str] = {
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tiff": "image/tiff",
    ".tif":  "image/tiff",
    ".bmp":  "image/bmp",
    ".gif":  "image/gif",
    ".avif": "image/avif",
}


def _ext(filename: str) -> str:
    return os.path.splitext(filename)[1].lower()


def mime_for_ext(ext: str) -> str:
    """Return correct MIME type for a file extension. Defaults to application/octet-stream."""
    return _MIME_MAP.get(ext.lower(), "application/octet-stream")


def is_accepted(filename: str) -> bool:
    """Return True if the file extension is accepted for upload."""
    return _ext(filename) in ACCEPTED_EXTENSIONS


_openers_registered = False


def _register_extra_openers() -> None:
    """Register optional Pillow plugins once per process (HEIC, AVIF, etc.)."""
    global _openers_registered
    if _openers_registered:
        return
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    try:
        import pillow_avif  # pip install pillow-avif-plugin
        # auto-registered on import
    except ImportError:
        pass
    _openers_registered = True


def normalize_to_jpeg(src_path: str) -> tuple[str, bool]:
    """
    Ensure the image at src_path is in a format pyvips/Pillow can process natively.

    - If the file is already .jpg/.jpeg/.png/.webp → returns (src_path, False).
      No work done, no temp file created.
    - Otherwise → converts to a temporary JPEG next to the source file and
      returns (jpeg_path, True).  Caller MUST delete jpeg_path when done.

    Conversion runs inside the Celery worker — zero impact on upload latency.

    Args:
        src_path: Absolute path to the raw image on local disk.

    Returns:
        (path_to_use, was_converted)
    """
    ext = _ext(src_path)

    # Already native — fast path, no I/O
    if ext in _NATIVE_EXTENSIONS:
        return src_path, False

    _register_extra_openers()

    jpeg_path = src_path.rsplit(".", 1)[0] + "_normalized.jpg"
    try:
        img = PILImage.open(src_path)
        img = ImageOps.exif_transpose(img)   # honour EXIF rotation
        if img.mode != "RGB":
            img = img.convert("RGB")         # handles RGBA, P, L, CMYK, etc.
        img.save(jpeg_path, "JPEG", quality=95, optimize=True)
        print(f"✅ Normalized {ext} → JPEG: {os.path.basename(jpeg_path)}")
        return jpeg_path, True

    except UnidentifiedImageError:
        raise RuntimeError(f"Unrecognized image format: {os.path.basename(src_path)}")
    except Exception as exc:
        # Clean up partial file if save failed halfway
        if os.path.exists(jpeg_path):
            os.remove(jpeg_path)
        raise RuntimeError(f"Format normalization failed for {ext}: {exc}")