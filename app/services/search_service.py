import numpy as np
import cv2
from sqlalchemy.orm import Session
from app.models.cluster import Cluster
from app.services.faiss_manager import FaissManager
from app.services.face_model import face_app


# ── Similarity Thresholds ─────────────────────────────────────────────────────
# These were too high when det_size was (256,256) causing search to always
# return null. With (640,640) embeddings are higher quality AND we use
# more generous thresholds to catch real matches at varied angles/lighting.
#
# Tuning guide:
#   STRICT  → near-identical match (front-facing, good lighting)
#   NORMAL  → confident match (slight angle, different expression)
#   FALLBACK→ possible match (side angle, lighting change, aged photo)
#
# Lower = more results but more false positives
# Higher = fewer results but more precise
STRICT_THRESHOLD   = 0.55   # was 0.62 — now catches more real matches
NORMAL_THRESHOLD   = 0.45   # was 0.55
FALLBACK_THRESHOLD = 0.35   # was 0.48 — was causing null results entirely

MAX_RESULTS = 50
MAX_DIM     = 1024   # was 800 — larger selfie input = better detection


# ── Extract ALL face embeddings from uploaded selfie ─────────────────────────
def extract_all_embeddings(image_bytes: bytes):

    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if img is None:
        return []

    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img = cv2.resize(
            img,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA
        )

    # Try both orientations to handle rotated selfies
    faces = face_app.get(img)

    # If no face found, try with flipped image (some selfie cameras mirror)
    if not faces:
        flipped = cv2.flip(img, 1)
        faces = face_app.get(flipped)

    embeddings = []
    for face in faces:
        emb = face.embedding
        norm = np.linalg.norm(emb)
        if norm == 0:
            continue
        embeddings.append(emb / norm)

    return embeddings


# ── Core matching engine ──────────────────────────────────────────────────────
def perform_search(event_id: int, embeddings, db: Session):

    try:
        faiss_index = FaissManager.get_index(event_id)
    except Exception as e:
        print(f"❌ Failed to load FAISS index for event {event_id}: {e}")
        return [], []

    if faiss_index.index.ntotal == 0:
        print(f"⚠ FAISS index for event {event_id} is empty — event may not be processed yet")
        return [], []

    strict_matches   = {}
    normal_matches   = {}
    fallback_matches = {}

    for embedding in embeddings:

        results = faiss_index.search(embedding, MAX_RESULTS)

        for item in results:

            cluster = db.query(Cluster).filter(
                Cluster.id == item["db_id"]
            ).first()

            if not cluster:
                continue

            image_name = cluster.image_name
            score      = item["score"]

            if score >= STRICT_THRESHOLD:
                target_dict = strict_matches
            elif score >= NORMAL_THRESHOLD:
                target_dict = normal_matches
            elif score >= FALLBACK_THRESHOLD:
                target_dict = fallback_matches
            else:
                continue

            # Keep best score per image
            if (
                image_name not in target_dict
                or score > target_dict[image_name]["similarity"]
            ):
                target_dict[image_name] = {
                    "image_name": image_name,
                    "cluster_id": cluster.cluster_id,
                    "similarity": round(score, 4),
                }

    # Priority: use strictest tier that has results
    if strict_matches:
        selected = strict_matches
    elif normal_matches:
        selected = normal_matches
    else:
        selected = fallback_matches

    selected_list = sorted(
        selected.values(),
        key=lambda x: x["similarity"],
        reverse=True,
    )

    matched_cluster_ids = list({v["cluster_id"] for v in selected_list})

    return selected_list, matched_cluster_ids


# ── Public selfie search ──────────────────────────────────────────────────────
async def public_search_face(event_id: int, file, db: Session):

    contents = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        print(f"⚠ No face detected in uploaded selfie for event {event_id}")
        return {"error": "No face detected", "matched_photos": [], "friends_photos": []}

    matched_photos, matched_cluster_ids = perform_search(event_id, embeddings, db)

    return {
        "matched_photos":      matched_photos,
        "friends_photos":      [],   # populated by cluster logic if needed
        "matched_cluster_ids": matched_cluster_ids,
    }


# ── Owner face search ─────────────────────────────────────────────────────────
async def search_face(event_id: int, file, db: Session):

    contents = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected", "total_matches": 0, "matches": []}

    matched_photos, _ = perform_search(event_id, embeddings, db)

    return {
        "total_matches": len(matched_photos),
        "matches":       matched_photos,
    }