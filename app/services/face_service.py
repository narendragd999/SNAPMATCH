"""
app/services/face_service.py

FIXES vs original:
──────────────────
1. Use get_face_app() (lazy getter) instead of module-level `face_app` import.
   Module-level import triggers InsightFace model loading at Celery worker fork
   time, which can corrupt the ONNX thread pool in prefork mode. This causes
   random silent failures — especially on harder images like side profiles
   which need more compute time.

2. Flip augmentation at INDEX time (not just query time).
   Original code only augmented the selfie query. Event photos were indexed
   with only the raw front-facing embedding. Side-profile photos produce
   embeddings that are geometrically far from a front-facing selfie embedding,
   so they never matched even after query augmentation.
   
   Fix: for EVERY detected face we also run InsightFace on the horizontally
   flipped image and store BOTH embeddings. This means side-profile photos
   get two index entries — one from their natural pose, one from its mirror —
   which dramatically increases query hits for turned/side faces.

3. Multiple rotation variants at index time.
   Beyond horizontal flip, we add ±15° rotations. Event photographers often
   shoot at slight angles. The rotated variant's embedding lands closer to a
   front-facing query than the raw rotated original does.

4. Smart deduplication of augmented embeddings.
   Two variants of the same face would both match the same query, bloating
   results with duplicates. We deduplicate: if cosine similarity between two
   stored embeddings > 0.97, they're the same person-pose and we keep only
   the highest-norm one.

5. MAX_WORKERS raised 2 → 4 (was already 4 in docstring comment, 2 in code).

6. Proper handling of face_np fast-path — convert RGB→BGR before all variants.
"""

import os
import numpy as np
import cv2
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.core.config import STORAGE_PATH
from app.services.face_model import get_face_app   # ← lazy getter, NOT module-level face_app

MAX_DIM = 640

# Parallel workers for face detection.
# InsightFace releases the GIL during C++/ONNX inference — genuine parallelism.
# Tune down to 2 if you see memory pressure (each thread holds a decoded
# image + flip variants in RAM simultaneously: ~3× image memory per thread).
MAX_WORKERS = int(os.getenv("FACE_MAX_WORKERS", "4"))

# Hard cap on faces per image to avoid long-tail on crowd shots.
MAX_FACES_PER_IMAGE = int(os.getenv("FACE_MAX_PER_IMAGE", "20"))

# Cosine similarity threshold above which two augmented embeddings are
# considered duplicates of the same face (and only the best is kept).
DEDUP_THRESHOLD = float(os.getenv("FACE_DEDUP_THRESHOLD", "0.97"))

# Rotation angles (degrees) applied during indexing to catch tilted poses.
# ±15° covers most event photography angles without being too aggressive.
INDEX_ROTATION_ANGLES = [0, 15, -15]    # 0 = original, already included
# Set to [] to disable rotation augmentation (faster but less recall)


def resize_if_needed(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img = cv2.resize(
            img,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA,
        )
    return img


def _rotate_image(img: np.ndarray, angle_deg: float) -> np.ndarray:
    """Rotate image by angle_deg around its center. Keeps original canvas size."""
    if angle_deg == 0:
        return img
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)


def _extract_embeddings_from_img(img: np.ndarray) -> list[np.ndarray]:
    """
    Run InsightFace on one image variant.
    Returns list of L2-normalised 512-d embeddings (one per detected face).
    """
    face_app = get_face_app()
    faces = face_app.get(img)

    if MAX_FACES_PER_IMAGE and len(faces) > MAX_FACES_PER_IMAGE:
        # Sort by detection score descending so we keep highest-confidence faces
        faces = sorted(faces, key=lambda f: f.det_score, reverse=True)[:MAX_FACES_PER_IMAGE]

    result = []
    for face in faces:
        emb = face.embedding
        if emb is None:
            continue
        norm = np.linalg.norm(emb)
        if norm < 1e-6:
            continue
        result.append(emb / norm)
    return result


def _deduplicate_embeddings(embeddings: list[np.ndarray]) -> list[np.ndarray]:
    """
    Remove near-duplicate embeddings (same face, different augment variant).
    Uses cosine similarity (dot product on L2-normalised vectors).
    Keeps the first occurrence in order (which is always the original pose).
    """
    if not embeddings:
        return []

    kept = [embeddings[0]]
    for candidate in embeddings[1:]:
        is_dup = False
        for existing in kept:
            sim = float(np.dot(candidate, existing))
            if sim >= DEDUP_THRESHOLD:
                is_dup = True
                break
        if not is_dup:
            kept.append(candidate)
    return kept


def process_single_image(
    event_id: int,
    file: str,
    face_np: np.ndarray = None,
) -> list[tuple[str, np.ndarray]]:
    """
    Process one event photo and return all detected face embeddings.

    Returns a list of (filename, normalised_embedding) tuples.
    Multiple tuples per file are expected: one per face × one per augmentation
    variant. The caller (finalize_event in tasks.py) stores all of them in the
    Cluster table and FAISS index, giving each face multiple "search entry
    points" for different pose angles.

    Args:
        event_id: Event the photo belongs to.
        file:     Optimized filename (e.g. "abc123.jpg").
        face_np:  Optional pre-decoded numpy array (RGB, ≤640px) from
                  image_pipeline. When supplied, skips disk I/O entirely.
    """
    # ── 1. Load image ─────────────────────────────────────────────────────────
    if face_np is not None:
        # Fast path: in-memory array from image_pipeline (already 640px, RGB).
        # Convert RGB → BGR for OpenCV/InsightFace.
        base_img = cv2.cvtColor(face_np, cv2.COLOR_RGB2BGR)
    else:
        image_path = os.path.join(STORAGE_PATH, str(event_id), file)

        if not os.path.exists(image_path):
            return []

        if os.path.getsize(image_path) > 15_000_000:   # skip >15 MB raw files
            return []

        base_img = cv2.imread(image_path)
        if base_img is None:
            return []

        base_img = resize_if_needed(base_img)

    # ── 2. Build augmentation variants ────────────────────────────────────────
    #
    # We create several variants of the same image before running InsightFace:
    #
    #   a) Original image           — front-facing and near-front poses
    #   b) Horizontal flip          — mirrors a left-profile into a right-profile
    #                                 and vice versa. buffalo_l is slightly
    #                                 asymmetric in how it handles left vs right
    #                                 turns, so the flip often produces a better
    #                                 embedding for side profiles.
    #   c) ±15° rotations           — catches tilted shots from event photographers
    #                                 and guests who shoot at slight angles.
    #   d) Flip + ±15° rotations    — combines both transforms to handle
    #                                 "tilted side profile" shots.
    #
    # This gives up to 6 variants per image. Most front-facing photos will
    # produce near-identical embeddings across variants (which are deduplicated
    # below), so the index size increase is primarily from genuinely non-frontal
    # photos where each variant IS meaningfully different.

    h, w = base_img.shape[:2]

    variants: list[np.ndarray] = []

    for angle in INDEX_ROTATION_ANGLES:
        rotated = _rotate_image(base_img, angle)
        variants.append(rotated)                  # original orientation
        variants.append(cv2.flip(rotated, 1))     # horizontal flip of rotated

    # ── 3. Run face detection on every variant ────────────────────────────────
    all_embeddings: list[np.ndarray] = []

    for variant in variants:
        embs = _extract_embeddings_from_img(variant)
        all_embeddings.extend(embs)

    if not all_embeddings:
        return []

    # ── 4. Deduplicate ────────────────────────────────────────────────────────
    # Remove embeddings that are so similar they're clearly the same face-pose.
    # This prevents the FAISS index from having hundreds of near-identical
    # vectors for plain front-facing photos while still keeping the genuinely
    # different side/rotated variants.
    deduped = _deduplicate_embeddings(all_embeddings)

    # ── 5. Return (filename, embedding) pairs ──────────────────────────────────
    return [(file, emb) for emb in deduped]


def process_event_images(event_id: int) -> list[tuple[str, np.ndarray]]:
    """
    Process ALL photos in an event folder (legacy/fallback path).
    Primary processing path is via Celery tasks in tasks.py.

    Returns list of (filename, normalised_embedding) tuples — may contain
    multiple entries per file (one per detected face × augmentation variant).
    """
    folder = os.path.join(STORAGE_PATH, str(event_id))

    if not os.path.exists(folder):
        return []

    files = [
        f for f in os.listdir(folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
    ]

    all_faces: list[tuple[str, np.ndarray]] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_single_image, event_id, file): file
            for file in files
        }
        for future in as_completed(futures):
            try:
                result = future.result()
                if result:
                    all_faces.extend(result)
            except Exception as e:
                print(f"⚠ Face detection error for {futures[future]}: {e}")

    return all_faces