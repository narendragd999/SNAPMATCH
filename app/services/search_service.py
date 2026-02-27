import numpy as np
import cv2
from sqlalchemy.orm import Session
from app.models.cluster import Cluster
from app.services.faiss_manager import FaissManager
from app.services.face_model import face_app


# ------------------------------------------
# Tuned Similarity Levels
# ------------------------------------------
STRICT_THRESHOLD = 0.62
NORMAL_THRESHOLD = 0.55
FALLBACK_THRESHOLD = 0.48

MAX_RESULTS = 50
MAX_DIM = 800


# ------------------------------------------
# Extract ALL embeddings (same as indexing)
# ------------------------------------------
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

    faces = face_app.get(img)

    embeddings = []

    for face in faces:
        emb = face.embedding
        norm = np.linalg.norm(emb)
        if norm == 0:
            continue
        embeddings.append(emb / norm)

    return embeddings


# ------------------------------------------
# INTERNAL MATCHING ENGINE
# ------------------------------------------
def perform_search(event_id: int, embeddings, db: Session):

    faiss_index = FaissManager.get_index(event_id)

    strict_matches = {}
    normal_matches = {}
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
            score = item["score"]

            target_dict = None

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
                    "similarity": round(score, 4)
                }

    # Priority selection
    if strict_matches:
        selected = strict_matches
    elif normal_matches:
        selected = normal_matches
    else:
        selected = fallback_matches

    # Sort by similarity descending
    selected_list = sorted(
        selected.values(),
        key=lambda x: x["similarity"],
        reverse=True
    )

    matched_cluster_ids = list(
        {v["cluster_id"] for v in selected_list}
    )

    return selected_list, matched_cluster_ids


# ------------------------------------------
# PUBLIC SEARCH
# ------------------------------------------
async def public_search_face(event_id: int, file, db: Session):

    contents = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected"}

    matched_photos, matched_cluster_ids = perform_search(
        event_id,
        embeddings,
        db
    )

    return {
        "matched_photos": matched_photos,
        "matched_cluster_ids": matched_cluster_ids
    }


# ------------------------------------------
# OWNER SEARCH
# ------------------------------------------
async def search_face(event_id: int, file, db: Session):

    contents = await file.read()
    embeddings = extract_all_embeddings(contents)

    if not embeddings:
        return {"error": "No face detected"}

    matched_photos, _ = perform_search(
        event_id,
        embeddings,
        db
    )

    return {
        "total_matches": len(matched_photos),
        "matches": matched_photos
    }