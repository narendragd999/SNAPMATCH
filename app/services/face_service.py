import os
import numpy as np
import cv2
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.core.config import STORAGE_PATH
from app.services.face_model import face_app

MAX_DIM = 640

# PERF: Raised from 1 → 4 workers.
# InsightFace releases the GIL during the native C++/ONNX inference, so
# multiple threads genuinely run in parallel on a multi-core CPU.
# Each worker processes a different photo; they all share the same loaded
# face_app model (read-only during inference — thread-safe).
# Tune down to 2 if you see memory pressure (each thread holds a decoded
# image in RAM simultaneously).
MAX_WORKERS = 4

# PERF: Hard cap on faces returned per image.
# A 7-face group photo produces 7 embeddings × recognition overhead.
# Capping at MAX_FACES_PER_IMAGE short-circuits after the detector finds
# enough faces, avoiding long tail on crowd shots.
# Set to None to disable.
MAX_FACES_PER_IMAGE = 20


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
    face_np: optional pre-decoded numpy array from image_pipeline.process_raw_image().
             When provided, skips the cv2.imread() disk read entirely.
             Must be uint8 RGB, already resized to <=640px by image_pipeline.
    """
    image_path = os.path.join(STORAGE_PATH, str(event_id), file)

    if face_np is not None:
        # Fast path: use in-memory array, no disk read needed.
        # image_pipeline sized it to FACE_DETECTION_SIZE (640px) which is
        # within MAX_DIM, so resize_if_needed is skipped.
        # Convert RGB -> BGR for OpenCV/InsightFace.
        print("⚡ Using in-memory face_np (no disk read)")
        img = cv2.cvtColor(face_np, cv2.COLOR_RGB2BGR)
    else:
        # Fallback: load from disk (Pillow path or face_np conversion failed).
        if not os.path.exists(image_path):
            return []

        if os.path.getsize(image_path) > 15_000_000:
            return []

        img = cv2.imread(image_path)
        if img is None:
            return []

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

    folder = os.path.join(STORAGE_PATH, str(event_id))

    if not os.path.exists(folder):
        return []

    files = [
        f for f in os.listdir(folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]

    all_faces = []

    # PERF: MAX_WORKERS raised to 4 — parallel face detection across photos.
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