"""
app/workers/tasks.py  —  Celery task fan-out with object-storage support.

Key change: process_single_photo now uses image_pipeline.process_image()
which internally handles storage_service (local / minio / r2).

cleanup_expired_events uses storage_service.delete_event_folder() instead
of shutil.rmtree.

Everything else (clustering, FAISS, Redis progress, bulk DB updates) is
identical to the existing implementation.
"""
import os
import time
import pickle
import base64
import shutil
import numpy as np
import faiss
import redis as redis_lib

from celery import chord
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
# TASK 1 — ORCHESTRATOR
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue="photo_processing")
def process_event(self, event_id: int):
    """
    Dispatch one process_single_photo task per unprocessed photo,
    then attach finalize_event as a chord callback.
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

        # ── FIX 3: Redis keys with 24hr TTL ──────────────────────────────────
        r = _get_redis()
        r.set(f"event:{event_id}:total",     len(photos), ex=86400)  # ← was no TTL
        r.set(f"event:{event_id}:completed", 0,           ex=86400)
        r.set(f"event:{event_id}:phase",     "face_detection", ex=86400)  # ← NEW

        tasks = chord(
            [process_single_photo.s(photo.id, photo.stored_filename, event_id)
             for photo in photos],
            finalize_event.s(event_id),
        )
        tasks.apply_async()

        return {"status": "dispatched", "photo_count": len(photos)}

    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# TASK 2 — PER-PHOTO WORKER
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=PHOTO_QUEUE, soft_time_limit=300, time_limit=420)
def process_single_photo(self, photo_id: int, raw_filename: str, event_id: int):
    """
    1. Optimise image (pyvips → Pillow fallback)
    2. Run InsightFace face detection
    3. Return result dict (no DB writes here)
    
    Time limits increased to handle:
    - HEIC conversion (can take 60-90s for large files)
    - Large resolution images (4K+)
    - Network latency for MinIO/R2 downloads
    """
    from app.services.face_service import process_single_image

    t_start = time.time()

    try:
        # ── Image pipeline ────────────────────────────────────────────────────
        optimized_name, face_np = process_image(raw_filename, event_id)

        if not optimized_name:
            return _photo_result(photo_id, "pipeline_failed")

        t_opt = time.time() - t_start

        # ── Face detection ────────────────────────────────────────────────────
        # process_single_image(event_id, file, face_np) returns:
        #   list of (filename, normalised_embedding) tuples.
        # Pass face_np when available to skip the disk read inside the service.
        face_results = process_single_image(event_id, optimized_name, face_np)

        serialised_faces = []
        for _filename, emb in face_results:
            serialised_faces.append({
                "image_name":    optimized_name,
                "embedding_b64": base64.b64encode(pickle.dumps(emb)).decode(),
            })

        # Redis progress increment — refresh TTL each time
        r = _get_redis()
        r.incr(f"event:{event_id}:completed")
        r.expire(f"event:{event_id}:completed", 86400)   # ← keep TTL alive

        t_total = time.time() - t_start
        return _photo_result(photo_id, "ok", optimized_name, serialised_faces, t_opt, t_total)

    except SoftTimeLimitExceeded:
        print(f"⏰ Photo {photo_id} timed out after {time.time() - t_start:.1f}s")
        return _photo_result(photo_id, "timeout")
    except Exception as exc:
        print(f"❌ Photo {photo_id} failed after {time.time() - t_start:.1f}s: {exc}")
        import traceback; traceback.print_exc()
        return _photo_result(photo_id, "error")


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
# TASK 3 — FINALIZER
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=FINALIZE_QUEUE)
def finalize_event(self, photo_results: list[dict], event_id: int):
    """
    Chord callback. Bulk DB writes + clustering + FAISS rebuild.
    """
    db = SessionLocal()
    event_start = time.time()
    r = _get_redis()   # ← ADD: needed for phase tracking

    try:
        # ── Phase: clustering ─────────────────────────────────────────────────
        r.set(f"event:{event_id}:phase", "clustering", ex=86400)       # ← ADD
        _db_update_event(db, event_id, processing_progress=73)

        total_new       = len(photo_results)
        total_optimized = sum(1 for res in photo_results if res["status"] == "ok")

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

        print(f"\n📸 {total_optimized}/{total_new} optimized, {len(new_faces)} faces")

        if not new_faces:
            r.set(f"event:{event_id}:phase", "done", ex=86400)         # ← ADD
            _finalize_complete(db, event_id, total_new, 0, 0, event_start)
            _redis_cleanup(event_id)
            _release_lock(event_id)
            return {"status": "completed_no_new_faces"}

        # ── CLUSTERING ────────────────────────────────────────────────────────
        _db_update_event(db, event_id, processing_progress=75)

        os.makedirs(INDEXES_PATH, exist_ok=True)
        cluster_index_path = os.path.join(INDEXES_PATH, f"event_{event_id}_cluster.index")
        cluster_map_path   = os.path.join(INDEXES_PATH, f"event_{event_id}_cluster_map.npy")

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

        # Assign each new face to existing cluster or create new
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
                # New cluster
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

        # Bulk insert cluster rows
        db.bulk_save_objects(new_cluster_rows)
        db.commit()

        # ── Phase: building index ─────────────────────────────────────────────
        r.set(f"event:{event_id}:phase", "building_index", ex=86400)   # ← ADD
        _db_update_event(db, event_id, processing_progress=88)

        # Post-clustering merge pass
        _merge_clusters(db, event_id, dim)

        # Rebuild FAISS search index
        _db_update_event(db, event_id, processing_progress=92)
        _rebuild_faiss(db, event_id)

        total_clusters = db.query(Cluster.cluster_id).filter(
            Cluster.event_id == event_id
        ).distinct().count()

        # FIX: sum face counts across all processed photos for the event
        total_faces = sum(len(res.get("faces") or []) for res in photo_results)

        # ── Phase: enriching ──────────────────────────────────────────────────
        r.set(f"event:{event_id}:phase", "enriching", ex=86400)        # ← ADD
        _finalize_complete(db, event_id, total_new, total_clusters, total_faces, event_start)

        # Queue AI enrichment
        enrich_event_photos.apply_async(args=[event_id], queue=AI_QUEUE)

        # ── Phase: done ───────────────────────────────────────────────────────
        r.set(f"event:{event_id}:phase", "done", ex=86400)             # ← ADD

        _redis_cleanup(event_id)
        _release_lock(event_id)

        return {"status": "completed", "total_clusters": total_clusters}

    except Exception as exc:
        r.set(f"event:{event_id}:phase", "failed", ex=86400)           # ← ADD
        print(f"❌ finalize_event failed: {exc}")
        import traceback; traceback.print_exc()
        _db_update_event(db, event_id, processing_status="failed")
        db.commit()
        _release_lock(event_id)
        raise

    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# TASK 4 — AI ENRICHMENT
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=AI_QUEUE)
def enrich_event_photos(self, event_id: int):
    """Run Places365 + YOLO on all approved photos — delegates to ai_enrichment_task."""
    from app.workers.ai_enrichment_task import ai_enrich_event
    ai_enrich_event.apply_async(args=[event_id], queue=AI_QUEUE)


# ─────────────────────────────────────────────────────────────────────────────
# TASK 5 — CLEANUP EXPIRED EVENTS
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# PATCH: Replace cleanup_expired_events in app/workers/tasks.py
#
# CHANGE: swap shutil.rmtree + os.remove for storage_service.delete_event_folder
#         so expired events are cleaned from MinIO/R2 too, not just local disk.
#
# HOW TO APPLY:
#   In tasks.py, add this import near the top (after existing imports):
#
#       from app.services.storage_cleanup import delete_event_storage
#
#   Then replace the entire cleanup_expired_events function with:
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

        # Capture storage info before deleting DB records
        event_assets = [(e.id, e.cover_image) for e in expired]

        for event in expired:
            print(f"🗑 Cleaning expired event {event.id}")
            db.query(Cluster).filter(Cluster.event_id == event.id).delete()
            db.query(Photo).filter(Photo.event_id == event.id).delete()
            db.delete(event)

        db.commit()
        print(f"✅ Deleted {len(event_assets)} expired event DB records")

        # ── STORAGE: delete FAISS + files (local/MinIO/R2) after DB commit ────
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
# Helpers
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
        # ── FIX: persist face count so the UI "Faces" stat is populated ──────
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
    cluster_embeddings: dict[int, list[np.ndarray]] = defaultdict(list)
    for c in clusters:
        try:
            cluster_embeddings[c.cluster_id].append(pickle.loads(c.embedding))
        except Exception:
            pass

    centroids  = {}
    for cid, embs in cluster_embeddings.items():
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
        # ── FIX: persist total face count so UI "Faces" stat is populated ──
        "total_faces":             total_faces,
    })
    db.commit()
    print(f"✅ Event {event_id} complete in {elapsed:.1f}s — {total_clusters} clusters, {total_faces} faces")
    
    # ── GUEST NOTIFICATION: Notify guests if configured ───────────────────────
    # This is graceful - if no guests exist or notifications are disabled, nothing happens
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if event and getattr(event, 'notify_on_processing_complete', True):
            from app.models.guest import Guest
            pending_guests = db.query(Guest).filter(
                Guest.event_id == event_id,
                Guest.email_sent == False
            ).count()
            
            if pending_guests > 0:
                # Trigger notification task asynchronously
                notify_guests_task.apply_async(args=[event_id], queue="photo_processing")
                print(f"📧 Queued notification for {pending_guests} guests")
    except Exception as e:
        # Don't fail processing if notification fails
        print(f"⚠️ Guest notification trigger failed (non-fatal): {e}")


# ─────────────────────────────────────────────────────────────────────────────
# TASK 6 — GUEST NOTIFICATIONS
# ─────────────────────────────────────────────────────────────────────────────

@celery.task
def notify_guests_task(event_id: int):
    """
    Send 'Photos Ready' notifications to guests.
    Graceful: Does nothing if no guests or if notifications are disabled.
    """
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return {"status": "event_not_found"}
        
        # Get guests who haven't been notified
        from app.models.guest import Guest
        guests = db.query(Guest).filter(
            Guest.event_id == event_id,
            Guest.email_sent == False
        ).all()
        
        if not guests:
            return {"status": "no_guests_to_notify"}
        
        # Get owner info
        from app.models.user import User
        owner = db.query(User).filter(User.id == event.owner_id).first()
        photographer_name = owner.name or owner.email if owner else "the photographer"
        
        # Build event URL (use environment variable or default)
        base_url = os.getenv("FRONTEND_URL", "https://snapmatch.com")
        event_url = f"{base_url}/public/{event.public_token}"
        
        # Import email functions
        from app.api.guest_routes import send_bulk_photos_ready_emails
        
        # Send emails
        emails = [g.email for g in guests]
        results = send_bulk_photos_ready_emails(
            emails=emails,
            event_name=event.name,
            photo_count=event.image_count or 0,
            event_url=event_url,
            photographer_name=photographer_name,
            db=db,
        )
        
        # Update guest records
        for guest in guests:
            if results['sent'] > 0:
                guest.mark_email_sent()
        
        if results['sent'] > 0:
            event.record_notification_sent()
        
        db.commit()
        
        print(f"📧 Sent {results['sent']} notifications for event {event_id}")
        return {"status": "success", "sent": results['sent'], "failed": results['failed']}
        
    except Exception as e:
        print(f"❌ notify_guests_task failed: {e}")
        import traceback; traceback.print_exc()
        return {"status": "error", "message": str(e)}
    finally:
        db.close()


def _redis_cleanup(event_id):
    try:
        r = _get_redis()
        r.delete(f"event:{event_id}:total")
        r.delete(f"event:{event_id}:completed")
        # Keep phase key for 1 hour so frontend can read final state
        r.expire(f"event:{event_id}:phase", 3600)
    except Exception:
        pass


def _release_lock(event_id):
    try:
        r = _get_redis()
        r.delete(f"event:{event_id}:lock")
    except Exception:
        pass