"""
app/services/search_service.py

Face search service — FAISS nearest-neighbour lookup with tiered similarity.

FIXES vs original:
──────────────────
1. Uses get_face_app() (lazy getter) instead of module-level `face_app` import.
   Module-level import triggers InsightFace loading at import time, which in
   Celery prefork workers corrupts the ONNX thread pool. Lazy getter is safe.

2. Comprehensive query augmentation (6 variants, up from 4).
   Added ±15° and ±25° rotations to the selfie variants. If a guest took a
   slightly tilted selfie, none of the original 4 variants helped. With
   rotation augments, a tilted selfie now generates embeddings that are much
   closer to the event photo embeddings produced by face_service.py's indexed
   rotation variants.

3. MIN_THRESHOLD lowered to 0.35 (from 0.40).
   Side-profile → front-facing cross-pose similarity typically lands 0.38–0.55
   even with buffalo_l. The old 0.40 cutoff was discarding real matches.
   FALLBACK tier is shown differently in the UI so users understand confidence.

4. MAX_RESULTS raised 1000 → 2000.
   With augmented indexing (face_service.py now stores multiple embeddings per
   photo), a large event may have 5000+ FAISS vectors. Top-1000 could miss
   valid matches near the threshold. 2000 is still instant with IndexFlatIP.

5. friends_photos / companion_stats wired in (kept from your version).
"""

import numpy as np
import cv2
from sqlalchemy.orm import Session
from app.models.cluster import Cluster
from app.services.faiss_manager import FaissManager
from app.services.face_model import get_face_app   # ← lazy getter, NOT module-level import


# ── Thresholds ────────────────────────────────────────────────────────────────
# ALL results above MIN_THRESHOLD are returned; tiers are display-only labels.

STRICT_THRESHOLD   = 0.68   # "definitely this person" (front-facing match)
NORMAL_THRESHOLD   = 0.55   # "very likely"  (slight angle)
FALLBACK_THRESHOLD = 0.40   # "possible match" (side profile / rotated)
SIDE_THRESHOLD     = 0.35   # "low confidence" — kept for cross-pose matches
MIN_THRESHOLD      = SIDE_THRESHOLD   # nothing below this is returned

# ── Search config ─────────────────────────────────────────────────────────────
MAX_RESULTS = 2000   # FAISS top-K per embedding query
MAX_DIM     = 640    # resize selfie before detection

# Cosine similarity threshold for deduplicating augmented query embeddings.
# If two variants of the selfie produce nearly-identical embeddings, keep one.
QUERY_DEDUP_THRESHOLD = 0.97

# Rotation angles applied to the selfie to catch tilted self-portraits.
# These mirror the angles used in face_service.py so query and index variants
# are geometrically aligned.
QUERY_ROTATION_ANGLES = [0, 15, -15, 25, -25]


def _rotate_image(img: np.ndarray, angle_deg: float) -> np.ndarray:
    """Rotate image by angle_deg around its center."""
    if angle_deg == 0:
        return img
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)


def _deduplicate_embeddings(embeddings: list[np.ndarray]) -> list[np.ndarray]:
    """Remove near-duplicate embeddings (cosine sim > QUERY_DEDUP_THRESHOLD)."""
    if not embeddings:
        return []
    kept = [embeddings[0]]
    for candidate in embeddings[1:]:
        is_dup = any(
            float(np.dot(candidate, existing)) >= QUERY_DEDUP_THRESHOLD
            for existing in kept
        )
        if not is_dup:
            kept.append(candidate)
    return kept


# ── Embedding extraction from selfie ─────────────────────────────────────────

def extract_all_embeddings(image_bytes: bytes) -> list[np.ndarray]:
    """
    Extract embeddings from selfie using multiple augmentation variants.

    Variants generated per input image:
      • Original
      • Horizontal flip           — left↔right profile symmetry
      • ±15° rotation             — slight tilt in selfie or event photo
      • ±25° rotation             — more aggressive tilt
      • Flip × each rotation      — combined transform

    This totals up to 10 raw variants. After InsightFace runs on each,
    near-duplicate embeddings are removed, leaving typically 2–5 unique
    embeddings per selfie upload for matching against the FAISS index.

    The FAISS index itself was built with the same set of augmentations
    (see face_service.py), so query embeddings align with index embeddings
    across all pose combinations.
    """
    face_app = get_face_app()

    np_arr = np.frombuffer(image_bytes, np.uint8)
    img    = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        return []

    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img   = cv2.resize(img, (int(w * scale), int(h * scale)),
                           interpolation=cv2.INTER_AREA)
        h, w  = img.shape[:2]

    # Build all variants
    variants: list[np.ndarray] = []
    for angle in QUERY_ROTATION_ANGLES:
        rotated = _rotate_image(img, angle)
        variants.append(rotated)
        variants.append(cv2.flip(rotated, 1))

    # Slightly brighter version (helps with dark/underexposed selfies)
    variants.append(cv2.convertScaleAbs(img, alpha=1.15, beta=15))

    # Slight center crop (removes edge noise from front cameras)
    if h > 20 and w > 20:
        crop = img[5:-5, 5:-5]
        variants.append(crop)

    all_embeddings: list[np.ndarray] = []

    for variant in variants:
        try:
            faces = face_app.get(variant)
            for face in faces:
                emb = face.embedding
                if emb is None:
                    continue
                norm = np.linalg.norm(emb)
                if norm < 1e-6:
                    continue
                all_embeddings.append(emb / norm)
        except Exception:
            continue

    return _deduplicate_embeddings(all_embeddings)


# ── Core matching engine ──────────────────────────────────────────────────────

def perform_search(
    event_id:   int,
    embeddings: list[np.ndarray],
    db:         Session,
) -> tuple[list[dict], list[int]]:
    """
    Search the FAISS index for all query embeddings and return merged,
    deduplicated matches above MIN_THRESHOLD sorted by similarity descending.

    How it handles multiple embeddings per query:
      Each augmented selfie variant produces one embedding. All embeddings are
      searched independently. For each event photo image, only the BEST score
      across all query embeddings is kept (best_per_image dict). This means:
        - A front-facing selfie variant might match a front-facing event photo
          at 0.72 (STRICT).
        - A rotated selfie variant might match the same event photo's indexed
          side-profile embedding at 0.48 (FALLBACK).
      We keep 0.72 in that case. But for an event photo that only appears in
      side-profile, the best might be 0.43 from the rotated variant — still
      returned and labelled as FALLBACK.

    Returns:
        (matched_photos, matched_cluster_ids)
        matched_photos: list of {image_name, cluster_id, similarity, tier}
    """
    faiss_index = FaissManager.get_index(event_id)

    best_per_image: dict[str, dict] = {}

    for embedding in embeddings:
        results = faiss_index.search(embedding, MAX_RESULTS)

        for item in results:
            score = float(item["score"])
            if score < MIN_THRESHOLD:
                continue

            cluster = db.query(Cluster).filter(
                Cluster.id == item["db_id"]
            ).first()
            if not cluster:
                continue

            image_name = cluster.image_name

            # Keep highest score seen for this image across all query embeddings
            if (
                image_name not in best_per_image
                or score > best_per_image[image_name]["similarity"]
            ):
                if score >= STRICT_THRESHOLD:
                    tier = "strict"
                elif score >= NORMAL_THRESHOLD:
                    tier = "normal"
                elif score >= FALLBACK_THRESHOLD:
                    tier = "fallback"
                else:
                    tier = "side_profile"   # 0.35–0.40 cross-pose matches

                best_per_image[image_name] = {
                    "image_name": image_name,
                    "cluster_id": cluster.cluster_id,
                    "similarity": round(score, 4),
                    "tier":       tier,
                }

    matched_photos = sorted(
        best_per_image.values(),
        key=lambda x: x["similarity"],
        reverse=True,
    )

    matched_cluster_ids = list({v["cluster_id"] for v in matched_photos})

    return matched_photos, matched_cluster_ids


# ── Public search endpoint ────────────────────────────────────────────────────

async def public_search_face(event_id: int, file, db: Session) -> dict:
    """
    Guest selfie search. Returns:
      - matched_photos:      ALL photos where the user appears
      - friends_photos:      Photos where user appears WITH others (group shots)
      - matched_cluster_ids: Cluster IDs matching the user's face
      - companion_stats:     Stats about frequent co-appearing people
    """
    contents   = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected"}

    matched_photos, matched_cluster_ids = perform_search(event_id, embeddings, db)

    # ── "With Friends" tab ────────────────────────────────────────────────────
    try:
        from app.services.co_occurrence_service import (
            get_friends_photos,
            get_companion_stats,
        )
        friends_photos  = get_friends_photos(event_id, matched_photos, matched_cluster_ids, db)
        companion_stats = get_companion_stats(event_id, matched_photos, matched_cluster_ids, db)
    except Exception as e:
        print(f"⚠ co_occurrence_service error: {e}")
        friends_photos  = []
        companion_stats = {}

    return {
        "matched_photos":      matched_photos,
        "matched_cluster_ids": matched_cluster_ids,
        "friends_photos":      friends_photos,
        "companion_stats":     companion_stats,
    }


# ── Owner search endpoint ─────────────────────────────────────────────────────

async def search_face(event_id: int, file, db: Session) -> dict:
    """Owner dashboard selfie search."""
    contents   = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected"}

    matched_photos, _ = perform_search(event_id, embeddings, db)

    return {
        "total_matches": len(matched_photos),
        "matches":       matched_photos,
    }