"""
app/services/search_service.py (FIXED)

Face search service — FAISS nearest-neighbour lookup with rotation-aware augmentation.

Key improvements:
  1. extract_all_embeddings() now includes rotation variants (90°, 180°, 270°)
  2. Handles portrait/landscape mismatches during guest selfie search
  3. Merged bucket selection (returns ALL matches, not just highest tier)
  4. Thread-safe lazy model loading with get_face_app()
"""

import numpy as np
import cv2
from sqlalchemy.orm import Session
from app.models.cluster import Cluster
from app.services.faiss_manager import FaissManager
from app.services.face_model import get_face_app

face_app = get_face_app()


# ── Thresholds ────────────────────────────────────────────────────────────────
# Used for display tier labeling only.
# ALL results above MIN_THRESHOLD are returned to the caller.

STRICT_THRESHOLD   = 0.68   # high-confidence — "definitely this person"
NORMAL_THRESHOLD   = 0.55   # good match     — "very likely"
FALLBACK_THRESHOLD = 0.40   # lower confidence — "possible match"
MIN_THRESHOLD      = FALLBACK_THRESHOLD  # nothing below this is returned

# ── Search config ─────────────────────────────────────────────────────────────
MAX_RESULTS = 1000   # FAISS top-K candidates per embedding query
MAX_DIM     = 640    # resize selfie before detection — matches face_service.py


# ── Embedding extraction ──────────────────────────────────────────────────────

def extract_all_embeddings(image_bytes: bytes) -> list[np.ndarray]:
    """
    Extract embeddings from selfie with rotation-aware augmentation.
    
    Generates variants to handle:
      - Original orientation (already correct via EXIF in face_service)
      - Horizontal flip (mirrored photos)
      - 90°/180°/270° rotations (catches portrait/landscape mismatches)
      - Brightness/contrast variations (lighting differences)
    
    Returns:
        List of normalized face embeddings (512-dim each)
        Empty list if no faces detected in any variant
    """
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img    = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        print("❌ Failed to decode selfie image")
        return []

    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img   = cv2.resize(img, (int(w * scale), int(h * scale)), 
                           interpolation=cv2.INTER_AREA)

    # Generate 8 variants covering major orientations & conditions
    variants = [
        ("original", img),
        ("h_flip", cv2.flip(img, 1)),                    # horizontal mirror
        ("rot_90_cw", cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)),
        ("rot_180", cv2.rotate(img, cv2.ROTATE_180)),
        ("rot_90_ccw", cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)),
        ("brightness_up", cv2.convertScaleAbs(img, alpha=1.15, beta=15)),
        ("contrast_high", cv2.convertScaleAbs(img, alpha=1.25, beta=5)),
        ("center_crop", img[10:-10, 10:-10] if h > 30 and w > 30 else img),
    ]

    all_embeddings = []
    seen_norms = set()

    for variant_name, variant in variants:
        try:
            faces = face_app.get(variant)
            
            if not faces:
                continue
            
            for i, face in enumerate(faces):
                emb  = face.embedding
                norm = np.linalg.norm(emb)
                if norm == 0:
                    continue
                
                normalized = emb / norm
                
                # Deduplicate near-identical embeddings (keep first 2 decimals)
                key = round(float(normalized[0]), 2)
                if key not in seen_norms:
                    seen_norms.add(key)
                    all_embeddings.append(normalized)
                    print(f"✓ Face {i} detected in {variant_name} variant")
        
        except Exception as e:
            print(f"⚠ Variant {variant_name} failed: {e}")
            continue

    if not all_embeddings:
        print(f"❌ No faces detected in any of {len(variants)} variants")
    else:
        print(f"✓ Extracted {len(all_embeddings)} embeddings from {len(seen_norms)} unique faces")
    
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

    Args:
        event_id: Event to search
        embeddings: List of face embeddings from guest's selfie
        db: Database session
    
    Returns:
        (matched_photos, matched_cluster_ids)
        matched_photos: list of {image_name, cluster_id, similarity, tier}
        matched_cluster_ids: list of unique cluster IDs that matched
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
                # Below fallback threshold — skip
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
    
    Returns THREE types of results:
    - matched_photos: ALL photos where user appears (solo + group)
    - friends_photos: Photos where user appears WITH OTHERS (group photos only)
    - matched_cluster_ids: Cluster IDs that matched user's face
    
    Args:
        event_id: Event to search
        file: Uploaded selfie (multipart file)
        db: Database session
    
    Returns:
        {
            "matched_photos": [...],
            "matched_cluster_ids": [...],
            "friends_photos": [...],
            "companion_stats": {...}
        }
    """
    contents   = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected in selfie"}

    matched_photos, matched_cluster_ids = perform_search(event_id, embeddings, db)
    
    # ── Get group photos for "With Friends" tab ───────────────────────────────
    from app.services.co_occurrence_service import (
        get_friends_photos,
        get_companion_stats
    )
    
    friends_photos = get_friends_photos(
        event_id,
        matched_photos,
        matched_cluster_ids,
        db
    )
    
    companion_stats = get_companion_stats(
        event_id,
        matched_photos,
        matched_cluster_ids,
        db
    )

    return {
        "matched_photos":      matched_photos,
        "matched_cluster_ids": matched_cluster_ids,
        "friends_photos":      friends_photos,
        "companion_stats":     companion_stats,
    }


# ── Owner search endpoint ─────────────────────────────────────────────────────

async def search_face(event_id: int, file, db: Session) -> dict:
    """
    Search endpoint for event owners. Returns total match count + full match list.
    
    Args:
        event_id: Event to search
        file: Uploaded image (multipart file)
        db: Database session
    
    Returns:
        {
            "total_matches": int,
            "matches": [...]
        }
    """
    contents   = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected in image"}

    matched_photos, _ = perform_search(event_id, embeddings, db)

    return {
        "total_matches": len(matched_photos),
        "matches":       matched_photos,
    }