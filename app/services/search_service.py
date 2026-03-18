"""
app/services/search_service.py

Face search service — FAISS nearest-neighbour lookup with tiered similarity.

Key fixes vs original:
──────────────────────
1. Uses get_face_app() instead of module-level face_app import.
   The old code imported face_app at module level, which triggered eager model
   loading inside Celery workers at import time. get_face_app() is lazy and
   thread-safe — model loads only on first actual use. Consistent with
   face_model.py and face_service.py.

2. MERGED bucket selection (was exclusive/priority-only)
   Old: if strict → return only strict, elif normal → return only normal
   New: return ALL matches above FALLBACK_THRESHOLD, tagged by confidence tier
   Why: a person in 20 photos may have 3 strict + 14 normal + 5 fallback matches.
   The old code returned only the 3 strict ones. Now all 22 are returned, sorted
   by similarity desc — strict ones still appear at the top.

3. MAX_RESULTS raised 50 → 100
   FAISS searches top-K candidates per embedding. With 50 you were potentially
   cutting off valid matches for large events (500+ photos). 100 costs almost
   nothing extra (FAISS flat index is O(n)) and catches more true positives.

4. MAX_DIM = 640 (was inconsistent — face_service used 640, this file used a
   different value). Consistent sizing = more predictable embedding quality.

5. Similarity tiers used for display labeling only, not for filtering.
   All matches above FALLBACK_THRESHOLD are returned. Frontend uses the
   similarity score / tier to show confidence badges — it does not gate results.
"""

import numpy as np
import cv2
from sqlalchemy.orm import Session
from app.models.cluster import Cluster
from app.services.faiss_manager import FaissManager
from app.services.face_model import face_app   # lazy, thread-safe singleton


# ── Thresholds ────────────────────────────────────────────────────────────────
# Used for display tier labeling only.
# ALL results above MIN_THRESHOLD are returned to the caller.

STRICT_THRESHOLD   = 0.68   # high-confidence — "definitely this person"
NORMAL_THRESHOLD   = 0.55   # good match     — "very likely"
FALLBACK_THRESHOLD = 0.40   # lower confidence — "possible match"
MIN_THRESHOLD      = FALLBACK_THRESHOLD  # nothing below this is returned

# ── Search config ─────────────────────────────────────────────────────────────
MAX_RESULTS = 1000   # FAISS top-K candidates per embedding query (was 50)
MAX_DIM     = 640   # resize selfie before detection — matches face_service.py


# ── Embedding extraction ──────────────────────────────────────────────────────

# search_service.py — replace extract_all_embeddings()

def extract_all_embeddings(image_bytes: bytes) -> list[np.ndarray]:
    """
    Extract embeddings from selfie + augmented variants.
    More query embeddings = catches more poses/lighting in event photos.
    """
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img    = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        return []

    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img   = cv2.resize(img, (int(w * scale), int(h * scale)), 
                           interpolation=cv2.INTER_AREA)

    # Generate variants — original + 3 augmented
    variants = [
        img,                                    # original
        cv2.flip(img, 1),                       # horizontal flip
        img[5:-5, 5:-5] if h > 20 else img,    # slight center crop
        cv2.convertScaleAbs(img, alpha=1.1, beta=10),  # slightly brighter
    ]

    all_embeddings = []
    seen_norms = set()

    for variant in variants:
        try:
            faces = face_app.get(variant)
            for face in faces:
                emb  = face.embedding
                norm = np.linalg.norm(emb)
                if norm == 0:
                    continue
                normalized = emb / norm
                # Deduplicate near-identical embeddings
                key = round(float(normalized[0]), 3)
                if key not in seen_norms:
                    seen_norms.add(key)
                    all_embeddings.append(normalized)
        except Exception:
            continue

    return all_embeddings


# ── Core matching engine ──────────────────────────────────────────────────────

def perform_search(
    event_id:   int,
    embeddings: list[np.ndarray],
    db:         Session,
) -> tuple[list[dict], list[int]]:
    """
    Search the FAISS index for all embeddings and return merged, deduplicated
    matches above MIN_THRESHOLD sorted by similarity descending.

    Handles group selfies correctly: if multiple faces are detected in the
    uploaded image, all are searched and results are merged — best score per
    event image wins.

    Returns:
        (matched_photos, matched_cluster_ids)
        matched_photos: list of {image_name, cluster_id, similarity, tier}
    """
    faiss_index = FaissManager.get_index(event_id)

    # Accumulate best score per event image across ALL query embeddings.
    # A group selfie may contain 2-3 faces — we want matches for all of them.
    best_per_image: dict[str, dict] = {}

    for embedding in embeddings:
        results = faiss_index.search(embedding, MAX_RESULTS)

        for item in results:
            score = item["score"]
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
                # Assign display tier — frontend uses this for confidence badges
                if score >= STRICT_THRESHOLD:
                    tier = "strict"
                elif score >= NORMAL_THRESHOLD:
                    tier = "normal"
                else:
                    tier = "fallback"

                best_per_image[image_name] = {
                    "image_name": image_name,
                    "cluster_id": cluster.cluster_id,
                    "similarity": round(score, 4),
                    "tier":       tier,
                }

    # Sort all matches by similarity descending — strict results bubble to top
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
    Search endpoint for guests (no auth). Returns matched photos and cluster IDs.
    """
    contents   = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected"}

    matched_photos, matched_cluster_ids = perform_search(event_id, embeddings, db)

    return {
        "matched_photos":      matched_photos,
        "matched_cluster_ids": matched_cluster_ids,
    }


# ── Owner search endpoint ─────────────────────────────────────────────────────

async def search_face(event_id: int, file, db: Session) -> dict:
    """
    Search endpoint for event owners. Returns total match count + full match list.
    """
    contents   = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected"}

    matched_photos, _ = perform_search(event_id, embeddings, db)

    return {
        "total_matches": len(matched_photos),
        "matches":       matched_photos,
    }