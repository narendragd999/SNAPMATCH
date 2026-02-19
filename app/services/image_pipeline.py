import os
import uuid
from PIL import Image, ImageFile, UnidentifiedImageError

MAX_SIZE = 1200
THUMB_SIZE = 400
JPEG_QUALITY = 85
WEBP_QUALITY = 80

# Allow loading truncated images
ImageFile.LOAD_TRUNCATED_IMAGES = True


def process_raw_image(raw_path: str, event_folder: str):

    # Skip tiny corrupted files (optional safety)
    if not os.path.exists(raw_path) or os.path.getsize(raw_path) < 1024:
        print(f"⚠ Skipping invalid/tiny file: {raw_path}")
        return None

    try:
        os.makedirs(event_folder, exist_ok=True)
        thumb_folder = os.path.join(event_folder, "thumbnails")
        os.makedirs(thumb_folder, exist_ok=True)

        base_name = str(uuid.uuid4())

        jpeg_path = os.path.join(event_folder, f"{base_name}.jpg")
        thumb_path = os.path.join(thumb_folder, f"{base_name}.webp")

        # ---- VERIFY IMAGE FIRST ----
        with Image.open(raw_path) as img:
            img.verify()

        # ---- REOPEN AFTER VERIFY ----
        with Image.open(raw_path) as img:

            img = img.convert("RGB")

            width, height = img.size

            if max(width, height) > MAX_SIZE:
                img.thumbnail((MAX_SIZE, MAX_SIZE), Image.LANCZOS)

            # Save optimized JPEG
            img.save(
                jpeg_path,
                "JPEG",
                quality=JPEG_QUALITY,
                optimize=True,
                progressive=True
            )

            # Generate thumbnail
            thumb = img.copy()
            thumb.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)

            thumb.save(
                thumb_path,
                "WEBP",
                quality=75,
                method=3
            )

        return f"{base_name}.jpg"

    except (UnidentifiedImageError, OSError) as e:
        print(f"❌ Corrupted image skipped: {raw_path} | Error: {e}")
        return None

    except Exception as e:
        print(f"🔥 Unexpected error processing {raw_path}: {e}")
        return None
