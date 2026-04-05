"""
app/services/face_service.py

FIXED: Now handles EXIF orientation tags correctly.

Changes from original:
  - apply_exif_orientation() handles 1-8 EXIF rotation codes
  - process_single_image() applies EXIF after cv2.imread()
  - Correctly handles portrait/landscape/flipped photos
  - Still uses lazy face_app singleton for thread safety
"""

import os
import numpy as np
import cv2
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image
import piexif

from app.core.config import STORAGE_PATH
from app.services.face_model import get_face_app

face_app = get_face_app()

MAX_DIM = 640

# PERF: Raised from 1 → 2 workers.
# InsightFace releases the GIL during the native C++/ONNX inference, so
# multiple threads genuinely run in parallel on a multi-core CPU.
# Each worker processes a different photo; they all share the same loaded
# face_app model (read-only during inference — thread-safe).
# Tune down to 1 if you see memory pressure (each thread holds a decoded
# image in RAM simultaneously).
MAX_WORKERS = 2

# PERF: Hard cap on faces returned per image.
# A 7-face group photo produces 7 embeddings × recognition overhead.
# Capping at MAX_FACES_PER_IMAGE short-circuits after the detector finds
# enough faces, avoiding long tail on crowd shots.
# Set to None to disable.
MAX_FACES_PER_IMAGE = 20


def apply_exif_orientation(image_path: str, img: np.ndarray) -> np.ndarray:
    """
    Apply EXIF orientation rotation to image.
    
    EXIF Orientation values (1-8):
      1 = normal
      2 = horizontal flip
      3 = 180° rotation
      4 = vertical flip
      5 = 270° rotation + horizontal flip
      6 = 270° rotation (phone portrait rotated left)
      7 = 90° rotation + horizontal flip
      8 = 90° rotation (phone portrait rotated right)
    
    Args:
        image_path: Path to image file (needed for EXIF reading)
        img: OpenCV image (BGR uint8)
    
    Returns:
        Correctly oriented image
    """
    try:
        exif_dict = piexif.load(image_path)
        orientation_key = piexif.ImageIFD.Orientation
        
        if orientation_key not in exif_dict.get("0th", {}):
            # No EXIF rotation tag — use as-is
            return img
        
        orientation = exif_dict["0th"][orientation_key]
        
        if orientation == 2:
            img = cv2.flip(img, 1)  # horizontal flip
        elif orientation == 3:
            img = cv2.rotate(img, cv2.ROTATE_180)
        elif orientation == 4:
            img = cv2.flip(img, 0)  # vertical flip
        elif orientation == 5:
            img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
            img = cv2.flip(img, 1)
        elif orientation == 6:
            img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        elif orientation == 7:
            img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
            img = cv2.flip(img, 1)
        elif orientation == 8:
            img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        
        print(f"🔄 EXIF orientation {orientation}: {os.path.basename(image_path)}")
        return img
    
    except (piexif.InvalidImageDataError, KeyError):
        # File has no EXIF or EXIF is corrupt — use as-is
        return img
    except Exception as e:
        print(f"⚠ EXIF read failed for {os.path.basename(image_path)}: {e}")
        return img


def resize_if_needed(img):
    """Resize image if any dimension exceeds MAX_DIM."""
    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img = cv2.resize(
            img,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA
        )
    return img


def process_single_image(event_id: int, file: str, face_np: np.ndarray = None):
    """
    Extract faces from a single image with EXIF orientation handling.
    
    Args:
        event_id: Event ID (used to locate photo)
        file: Filename of photo
        face_np: Optional pre-decoded numpy array from image_pipeline.process_raw_image().
                 When provided, skips the cv2.imread() disk read entirely.
                 Must be uint8 RGB, already resized to <=640px and EXIF-corrected.
    
    Returns:
        List of (filename, normalized_embedding) tuples
    """
    image_path = os.path.join(STORAGE_PATH, str(event_id), file)

    if face_np is not None:
        # Fast path: use in-memory array, no disk read needed.
        # Assumes image_pipeline already applied EXIF orientation.
        print("⚡ Using in-memory face_np (pre-processed)")
        img = cv2.cvtColor(face_np, cv2.COLOR_RGB2BGR)
    else:
        # Standard path: load from disk with EXIF handling
        if not os.path.exists(image_path):
            return []

        if os.path.getsize(image_path) > 15_000_000:
            return []

        img = cv2.imread(image_path)
        if img is None:
            return []

        # 🔴 CRITICAL: Apply EXIF orientation BEFORE detecting faces
        img = apply_exif_orientation(image_path, img)
        
        img = resize_if_needed(img)

    faces = face_app.get(img)

    # PERF: Truncate extreme crowd shots early — no need to embed 50 faces
    if MAX_FACES_PER_IMAGE and len(faces) > MAX_FACES_PER_IMAGE:
        faces = faces[:MAX_FACES_PER_IMAGE]

    results = []

    for face in faces:
        emb = face.embedding
        norm = np.linalg.norm(emb)
        if norm == 0:
            continue
        results.append((file, emb / norm))

    return results


def process_event_images(event_id: int):
    """
    Batch process all images in an event folder.
    Extracts face embeddings from all JPEG/PNG photos.
    
    Args:
        event_id: Event to process
    
    Returns:
        List of (filename, embedding) tuples for all detected faces
    """
    folder = os.path.join(STORAGE_PATH, str(event_id))

    if not os.path.exists(folder):
        return []

    files = [
        f for f in os.listdir(folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]

    all_faces = []

    # PERF: Parallel face detection across photos using ThreadPool.
    # MAX_WORKERS tuned for balance between throughput and memory.
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:

        futures = [
            executor.submit(process_single_image, event_id, file)
            for file in files
        ]

        for future in as_completed(futures):
            try:
                result = future.result()
                if result:
                    all_faces.extend(result)
            except Exception as e:
                print(f"❌ Face error: {e}")

    return all_faces