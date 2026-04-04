import os
import numpy as np
import cv2
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.core.config import STORAGE_PATH
from app.services.face_model import face_app

# ★ ADD THIS IMPORT ★
from app.services.face_service_enhanced import detect_faces_enhanced

MAX_DIM = 640
MAX_WORKERS = 4
MAX_FACES_PER_IMAGE = 20

# ★ NEW: Feature flag for enhanced detection ★
USE_ENHANCED_DETECTION = os.getenv(
    "USE_ENHANCED_FACE_DETECTION", 
    "true"
).lower() == "true"

def resize_if_needed(img):
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
    ENHANCED VERSION: Uses multi-scale + rotation detection for side/rotated faces.
    
    face_np: optional pre-decoded numpy array from image_pipeline.process_raw_image().
             When provided, skips the cv2.imread() disk read entirely.
             Must be uint8 RGB, already resized to <=640px by image_pipeline.
    """
    image_path = os.path.join(STORAGE_PATH, str(event_id), file)

    if face_np is not None:
        # Fast path: use in-memory array, no disk read needed.
        print("⚡ Using in-memory face_np (no disk read)")
        img = cv2.cvtColor(face_np, cv2.COLOR_RGB2BGR)
    else:
        # Fallback: load from disk
        if not os.path.exists(image_path):
            return []

        if os.path.getsize(image_path) > 15_000_000:
            return []

        img = cv2.imread(image_path)
        if img is None:
            return []

        img = resize_if_needed(img)

    # ★★★ THIS IS THE KEY CHANGE ★★★
    # BEFORE (line 73 in original):
    #   faces = face_app.get(img)
    
    # AFTER (enhanced version):
    if USE_ENHANCED_DETECTION:
        # Use enhanced multi-scale + rotation detection
        faces = detect_faces_enhanced(
            img, 
            try_rotations=True,   # Detect side profiles
            try_scales=True       # Detect small/distant faces
        )
    else:
        # Original behavior (backward compatible)
        faces = face_app.get(img)

    # PERF: Truncate extreme crowd shots early
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
    """Batch processing (unchanged - calls process_single_image internally)"""
    folder = os.path.join(STORAGE_PATH, str(event_id))

    if not os.path.exists(folder):
        return []

    files = [
        f for f in os.listdir(folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]

    all_faces = []

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
                print("Face error:", e)

    return all_faces