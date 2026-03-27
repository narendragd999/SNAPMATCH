"""
app/workers/tasks.py  —  Batch Celery processing with object-storage support.

KEY CHANGE vs original: Batch processing replaces 1-task-per-photo fan-out.

WHY BATCH IS FASTER
─────────────────────
Original:  N photos → N Celery tasks → N Redis round-trips → N task pickles
           Each task: serialize args → queue → dequeue → deserialize → run
           For 500 photos → 500 round-trips, 500 broker messages, high overhead.

Batch:     N photos → ceil(N/BATCH_SIZE) tasks → far fewer round-trips.
           Each task processes BATCH_SIZE photos in a tight loop.
           InsightFace model is loaded once per worker, reused across all photos
           in the batch without any serialization boundary.

BATCH_SIZE tuning:
  - Too small  (< 5):  overhead not reduced enough
  - Too large  (> 50): task takes too long, soft-time-limit risks, poor progress
  - Recommended: 10–20 for CPU workers, 30–50 for GPU workers
  Set via env var CELERY_PHOTO_BATCH_SIZE (default: 15)

Progress tracking: Redis counters updated after each batch completes
                   (not per-photo), still drives the frontend progress bar.

Everything else (clustering, FAISS, Redis progress, bulk DB updates) is
identical to the existing implementation.
"""
import os
import time
import pickle
import base64
import shutil
import math
import numpy as np
import faiss
import redis as redis_lib

from celery import chord, group
from celery.exceptions import SoftTimeLimitExceeded
from datetime import datetime
from sqlalchemy import text

from app.workers.celery_worker import celery
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.cluster import Cluster
from app.models.photo import Photo
from app.core.config import INDEXES_PATH
from app.services import storage_service
from app.services.image_pipeline import process_image
from app.services.clustering_service import cluster_embeddings
from app.services.faiss_manager import FaissManager, EventFaissIndex

PHOTO_QUEUE    = "photo_processing"
FINALIZE_QUEUE = "event_finalize"
AI_QUEUE       = "ai_enrichment"
THRESHOLD      = 0.72

# ── Batch size: tune per deployment ──────────────────────────────────────────
# CPU workers (concurrency=2): 10–15 is ideal
# GPU workers (concurrency=1 GPU): 30–50 for maximum throughput
BATCH_SIZE = int(os.getenv("CELERY_PHOTO_BATCH_SIZE", "15"))

_redis = None
def _get_redis():
    global _redis
    if _redis is None:
        _redis = redis_lib.Redis.from_url(
            os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"),
            decode_responses=True
        )
    return _redis


# ─────────────────────────────────────────────────────────────────────────────
# TASK 1 — ORCHESTRATOR  (now dispatches batches instead of individual photos)
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue="photo_processing")
def process_event(self, event_id: int):
    """
    Dispatch batch tasks instead of one task per photo.

    For 500 photos with BATCH_SIZE=15:
      Old: 500 individual tasks → 500 Redis messages
      New: 34 batch tasks       → 34 Redis messages  (14.7x fewer)

    Each batch task processes BATCH_SIZE photos sequentially in a tight loop,
    reusing the InsightFace model already loaded into the worker's memory.
    """
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return {"status": "event_not_found"}

        photos = db.query(Photo).filter(
            Photo.event_id == event_id,
            Photo.status == "uploaded",
            Photo.approval_status == "approved",
        ).all()

        if not photos:
            return {"status": "no_photos_to_process"}

        event.processing_status   = "processing"
        event.processing_progress = 10
        event.process_count       = (event.process_count or 0) + 1
        event.processing_started_at = datetime.utcnow()
        db.commit()

        total_photos = len(photos)

        # ── Build batches ──────────────────────────────────────────────────────
        # Each batch is a list of (photo_id, stored_filename) tuples.
        # Passing minimal data keeps Redis message size small.
        photo_tuples = [(p.id, p.stored_filename) for p in photos]
        batches = [
            photo_tuples[i : i + BATCH_SIZE]
            for i in range(0, total_photos, BATCH_SIZE)
        ]
        num_batches = len(batches)

        print(
            f"\n📦 Event {event_id}: {total_photos} photos → "
            f"{num_batches} batches (BATCH_SIZE={BATCH_SIZE})"
        )

        # ── Redis progress tracking ────────────────────────────────────────────
        r = _get_redis()
        r.set(f"event:{event_id}:total",     total_photos, ex=86400)
        r.set(f"event:{event_id}:completed", 0,            ex=86400)
        r.set(f"event:{event_id}:phase",     "face_detection", ex=86400)

        # ── Dispatch chord of batch tasks ──────────────────────────────────────
        tasks = chord(
            [
                process_photo_batch.s(batch, event_id)
                for batch in batches
            ],
            finalize_event.s(event_id),
        )
        tasks.apply_async()

        return {
            "status": "dispatched",
            "photo_count": total_photos,
            "batch_count": num_batches,
            "batch_size": BATCH_SIZE,
        }

    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# TASK 2 — BATCH PHOTO WORKER  (replaces process_single_photo)
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(
    bind=True,
    queue=PHOTO_QUEUE,
    # Generous limits: BATCH_SIZE=15 @ ~8s/photo on CPU = 120s max per batch
    soft_time_limit=300,
    time_limit=420,
)
def process_photo_batch(self, photo_batch: list, event_id: int):
    """
    Process a batch of photos in a single task.

    photo_batch: list of [photo_id, stored_filename] pairs

    Returns a list of per-photo result dicts (same schema as the old
    process_single_photo) so finalize_event needs zero changes.

    Speed gains vs 1-task-per-photo:
      • No broker serialization/deserialization per photo
      • InsightFace model stays hot in L3 cache across all photos in batch
      • ONNX runtime avoids session initialization overhead between photos
      • Fewer Redis ACKs / heartbeats
    """
    from app.services.face_service import process_single_image

    batch_start = time.time()
    results = []

    for photo_id, raw_filename in photo_batch:
        t_photo_start = time.time()
        try:
            # ── Image pipeline (optimize + resize) ────────────────────────────
            optimized_name, face_np = process_image(raw_filename, event_id)

            if not optimized_name:
                results.append(_photo_result(photo_id, "pipeline_failed"))
                continue

            t_opt = time.time() - t_photo_start

            # ── Face detection (reuses already-loaded InsightFace model) ───────
            face_results = process_single_image(event_id, optimized_name, face_np)

            serialised_faces = [
                {
                    "image_name":    optimized_name,
                    "embedding_b64": base64.b64encode(pickle.dumps(emb)).decode(),
                }
                for _filename, emb in face_results
            ]

            t_total = time.time() - t_photo_start
            results.append(_photo_result(
                photo_id, "ok", optimized_name, serialised_faces, t_opt, t_total
            ))

        except SoftTimeLimitExceeded:
            # Mark remaining photos in this batch as timed out
            results.append(_photo_result(photo_id, "timeout"))
            # Add skipped results for the rest of the batch
            current_idx = [pid for pid, _ in photo_batch].index(photo_id)
            for skip_id, _ in photo_batch[current_idx + 1:]:
                results.append(_photo_result(skip_id, "timeout"))
            break

        except Exception as exc:
            print(f"❌ Photo {photo_id} ({raw_filename}) failed: {exc}")
            import traceback; traceback.print_exc()
            results.append(_photo_result(photo_id, "error"))

    # ── Update Redis progress counter once per batch ───────────────────────────
    # One Redis call per batch vs one per photo = massive reduction at scale.
    try:
        r = _get_redis()
        completed_in_batch = sum(1 for res in results if res["status"] == "ok")
        r.incrby(f"event:{event_id}:completed", len(results))  # increment by batch size
        r.expire(f"event:{event_id}:completed", 86400)
    except Exception:
        pass  # Redis failure is non-fatal for processing

    batch_elapsed = time.time() - batch_start
    ok_count      = sum(1 for r in results if r["status"] == "ok")
    print(
        f"✅ Batch done: {ok_count}/{len(photo_batch)} OK "
        f"in {batch_elapsed:.1f}s "
        f"({batch_elapsed/len(photo_batch):.1f}s/photo)"
    )

    return results


def _photo_result(photo_id, status, optimized_name=None, faces=None, t_opt=0.0, t_total=0.0):
    return {
        "photo_id":       photo_id,
        "status":         status,
        "optimized_name": optimized_name,
        "faces":          faces or [],
        "t_opt":          t_opt,
        "t_total":        t_total,
    }


# ─────────────────────────────────────────────────────────────────────────────
# TASK 3 — FINALIZER  (unchanged — accepts flat list from chord)
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=FINALIZE_QUEUE)
def finalize_event(self, batch_results: list, event_id: int):
    """
    Chord callback.

    batch_results is now a list-of-lists (one inner list per batch task).
    We flatten it before processing — everything else is identical to the
    original single-photo implementation.
    """
    db = SessionLocal()
    event_start = time.time()
    r = _get_redis()

    try:
        # ── Flatten list-of-lists → flat list of per-photo results ────────────
        photo_results = []
        for batch in batch_results:
            if isinstance(batch, list):
                photo_results.extend(batch)
            elif isinstance(batch, dict):
                # Safety: handle case where a batch task returned a single dict
                photo_results.append(batch)

        # ── Phase: clustering ─────────────────────────────────────────────────
        r.set(f"event:{event_id}:phase", "clustering", ex=86400)
        _db_update_event(db, event_id, processing_progress=73)

        total_new       = len(photo_results)
        total_optimized = sum(1 for res in photo_results if res["status"] == "ok")

        print(f"\n📊 Finalizing event {event_id}: {total_optimized}/{total_new} photos OK")

        # Bulk UPDATE photo statuses
        _bulk_update_photos(db, photo_results)

        # Deserialise embeddings
        new_faces: list[tuple[str, np.ndarray, int]] = []
        for res in photo_results:
            if res["status"] != "ok":
                continue
            for f in res["faces"]:
                emb = pickle.loads(base64.b64decode(f["embedding_b64"]))
                new_faces.append((f["image_name"], emb, res["photo_id"]))

        print(f"📸 {total_optimized}/{total_new} optimized, {len(new_faces)} faces")

        if not new_faces:
            r.set(f"event:{event_id}:phase", "done", ex=86400)
            _finalize_complete(db, event_id, total_new, 0, 0, event_start)
            _redis_cleanup(event_id)
            _release_lock(event_id)
            return {"status": "completed_no_new_faces"}

        # ── CLUSTERING (unchanged) ────────────────────────────────────────────
        _db_update_event(db, event_id, processing_progress=75)

        os.makedirs(INDEXES_PATH, exist_ok=True)

        existing_clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
        dim = len(new_faces[0][1])
        cluster_index = faiss.IndexFlatIP(dim)
        cluster_map: list[int] = []
        current_cluster = 0

        if existing_clusters:
            seed_embs = []
            for c in existing_clusters:
                try:
                    seed_embs.append(pickle.loads(c.embedding))
                    cluster_map.append(c.cluster_id)
                except Exception:
                    pass
            if seed_embs:
                seed_matrix = np.array(seed_embs, dtype="float32")
                faiss.normalize_L2(seed_matrix)
                cluster_index.add(seed_matrix)
            current_cluster = max((c.cluster_id for c in existing_clusters), default=-1) + 1

        new_cluster_rows: list[Cluster] = []
        for image_name, emb, photo_id in new_faces:
            emb_norm = emb.astype("float32")
            faiss.normalize_L2(emb_norm.reshape(1, -1))

            assigned = current_cluster
            if cluster_index.ntotal > 0:
                D, I = cluster_index.search(emb_norm.reshape(1, -1), min(3, cluster_index.ntotal))
                for score, idx in zip(D[0], I[0]):
                    if idx >= 0 and score >= THRESHOLD:
                        assigned = cluster_map[idx]
                        break

            if assigned == current_cluster:
                cluster_index.add(emb_norm.reshape(1, -1))
                cluster_map.append(current_cluster)
                current_cluster += 1

            new_cluster_rows.append(Cluster(
                event_id=event_id,
                cluster_id=assigned,
                image_name=image_name,
                embedding=pickle.dumps(emb),
            ))

        _db_update_event(db, event_id, processing_progress=83)
        db.bulk_save_objects(new_cluster_rows)
        db.commit()

        # ── Phase: building index ─────────────────────────────────────────────
        r.set(f"event:{event_id}:phase", "building_index", ex=86400)
        _db_update_event(db, event_id, processing_progress=88)

        _merge_clusters(db, event_id, dim)

        _db_update_event(db, event_id, processing_progress=92)
        _rebuild_faiss(db, event_id)

        total_clusters = db.query(Cluster.cluster_id).filter(
            Cluster.event_id == event_id
        ).distinct().count()

        total_faces = sum(len(res.get("faces") or []) for res in photo_results)

        # ── Phase: building co-occurrence index ─────────────────────────────────
        # Group/Family Detection - identify people who appear together
        r.set(f"event:{event_id}:phase", "co_occurrence", ex=86400)
        _db_update_event(db, event_id, processing_progress=94)
        
        try:
            from app.services.co_occurrence_service import build_co_occurrence_index
            co_occurrence_count = build_co_occurrence_index(db, event_id)
            print(f"👥 Co-occurrence: {co_occurrence_count} relationships indexed")
        except Exception as co_err:
            # Non-fatal - log but continue
            print(f"⚠️ Co-occurrence indexing failed (non-fatal): {co_err}")

        # ── Phase: enriching ──────────────────────────────────────────────────
        r.set(f"event:{event_id}:phase", "enriching", ex=86400)
        _finalize_complete(db, event_id, total_new, total_clusters, total_faces, event_start)

        enrich_event_photos.apply_async(args=[event_id], queue=AI_QUEUE)

        r.set(f"event:{event_id}:phase", "done", ex=86400)
        _redis_cleanup(event_id)
        _release_lock(event_id)

        return {"status": "completed", "total_clusters": total_clusters}

    except Exception as exc:
        r.set(f"event:{event_id}:phase", "failed", ex=86400)
        print(f"❌ finalize_event failed: {exc}")
        import traceback; traceback.print_exc()
        _db_update_event(db, event_id, processing_status="failed")
        db.commit()
        _release_lock(event_id)
        raise

    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# TASK 4 — AI ENRICHMENT  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=AI_QUEUE)
def enrich_event_photos(self, event_id: int):
    """Run Places365 + YOLO on all approved photos."""
    from app.workers.ai_enrichment_task import ai_enrich_event
    ai_enrich_event.apply_async(args=[event_id], queue=AI_QUEUE)


# ─────────────────────────────────────────────────────────────────────────────
# TASK 5 — CLEANUP EXPIRED EVENTS  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@celery.task
def cleanup_expired_events():
    db = SessionLocal()
    try:
        from app.services.storage_cleanup import delete_event_storage

        now     = datetime.utcnow()
        expired = db.query(Event).filter(
            Event.expires_at != None,
            Event.expires_at < now,
        ).all()

        event_assets = [(e.id, e.cover_image) for e in expired]

        for event in expired:
            print(f"🗑 Cleaning expired event {event.id}")
            db.query(Cluster).filter(Cluster.event_id == event.id).delete()
            db.query(Photo).filter(Photo.event_id == event.id).delete()
            db.delete(event)

        db.commit()
        print(f"✅ Deleted {len(event_assets)} expired event DB records")

        for event_id, cover_image in event_assets:
            delete_event_storage(event_id, cover_image=cover_image)

        print("✅ Expired events cleanup done")

    except Exception as e:
        db.rollback()
        print(f"❌ Cleanup error: {e}")
        raise e
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers (unchanged from original)
# ─────────────────────────────────────────────────────────────────────────────

def _db_update_event(db, event_id, **kwargs):
    db.query(Event).filter(Event.id == event_id).update(kwargs)
    db.commit()


def _bulk_update_photos(db, photo_results):
    mappings = []
    for r in photo_results:
        m = {"id": r["photo_id"], "status": "processed" if r["status"] == "ok" else "failed"}
        if r.get("optimized_name"):
            m["optimized_filename"] = r["optimized_name"]
        m["faces_detected"] = len(r.get("faces") or [])
        mappings.append(m)
    db.bulk_update_mappings(Photo, mappings)
    db.commit()


def _merge_clusters(db, event_id, dim):
    """Post-clustering merge: combine very similar cluster centroids."""
    clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
    if not clusters:
        return

    from collections import defaultdict
    cluster_embeddings_map: dict[int, list[np.ndarray]] = defaultdict(list)
    for c in clusters:
        try:
            cluster_embeddings_map[c.cluster_id].append(pickle.loads(c.embedding))
        except Exception:
            pass

    centroids = {}
    for cid, embs in cluster_embeddings_map.items():
        mat = np.array(embs, dtype="float32")
        faiss.normalize_L2(mat)
        centroids[cid] = mat.mean(axis=0)

    cids = list(centroids.keys())
    if len(cids) < 2:
        return

    mat = np.array([centroids[c] for c in cids], dtype="float32")
    faiss.normalize_L2(mat)
    idx = faiss.IndexFlatIP(dim)
    idx.add(mat)

    merge_map: dict[int, int] = {}
    MERGE_THRESH = 0.82

    for i, cid in enumerate(cids):
        if cid in merge_map:
            continue
        D, I = idx.search(mat[i:i+1], len(cids))
        for score, j in zip(D[0], I[0]):
            if j == i or score < MERGE_THRESH:
                continue
            other = cids[j]
            if other not in merge_map:
                merge_map[other] = cid

    if merge_map:
        for old_cid, new_cid in merge_map.items():
            db.query(Cluster).filter(
                Cluster.event_id == event_id,
                Cluster.cluster_id == old_cid,
            ).update({"cluster_id": new_cid})
        db.commit()


def _rebuild_faiss(db, event_id):
    """Rebuild the FAISS search index from all cluster rows."""
    all_clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
    if not all_clusters:
        return

    embs = []
    ids  = []
    for c in all_clusters:
        try:
            embs.append(pickle.loads(c.embedding))
            ids.append(c.id)
        except Exception:
            pass

    if not embs:
        return

    dim    = len(embs[0])
    matrix = np.array(embs, dtype="float32")
    faiss.normalize_L2(matrix)

    index  = faiss.IndexFlatIP(dim)
    index.add(matrix)

    index_path = os.path.join(INDEXES_PATH, f"event_{event_id}.index")
    map_path   = os.path.join(INDEXES_PATH, f"event_{event_id}_map.npy")
    faiss.write_index(index, index_path)
    np.save(map_path, np.array(ids))

    FaissManager.reload_index(event_id)


def _finalize_complete(db, event_id, total_new, total_clusters, total_faces, event_start):
    elapsed = time.time() - event_start
    db.query(Event).filter(Event.id == event_id).update({
        "processing_status":       "completed",
        "processing_progress":     100,
        "processing_completed_at": datetime.utcnow(),
        "total_clusters":          total_clusters,
        "total_faces":             total_faces,
    })
    db.commit()
    print(
        f"✅ Event {event_id} complete in {elapsed:.1f}s — "
        f"{total_clusters} clusters, {total_faces} faces"
    )


def _redis_cleanup(event_id):
    try:
        r = _get_redis()
        r.delete(f"event:{event_id}:total")
        r.delete(f"event:{event_id}:completed")
        r.expire(f"event:{event_id}:phase", 3600)
    except Exception:
        pass


def _release_lock(event_id):
    try:
        r = _get_redis()
        r.delete(f"event:{event_id}:lock")
    except Exception:
        pass
