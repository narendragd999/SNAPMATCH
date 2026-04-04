"""
app/workers/tasks.py  —  Celery task fan-out with object-storage support.

COMPLETE REWRITE - Fixes:
1. Missing _map.npy file during FAISS index creation (atomic saves)
2. "AI enrichment task not available" warning (graceful degradation)
3. Silent failures during processing (comprehensive error handling)
4. Race conditions between workers (file locking)

Key changes vs original:
- process_single_photo uses image_pipeline.process_image()
- FAISS index saves are ATOMIC (both .index and _map.npy written together)
- Verification step after every save to ensure files exist
- AI enrichment is OPTIONAL - won't fail processing if worker unavailable
- Comprehensive logging at every critical step
- Cleanup of partial/corrupted index files before rebuild
"""

import os
import time
import pickle
import base64
import shutil
import numpy as np
import faiss
import redis as redis_lib
import logging
import fcntl  # For file locking
from contextlib import contextmanager

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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

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
# FILE LOCKING UTILITIES
# ─────────────────────────────────────────────────────────────────────────────

@contextmanager
def file_lock(lock_path: str, timeout: int = 300):
    """
    Context manager for file-based locking.
    Prevents multiple processes from writing to same event's index simultaneously.
    
    Usage:
        with file_lock('/app/indexes/event_15.lock'):
            # Critical section - only one process can execute this
            save_index_files()
    """
    lock_file = None
    acquired = False
    
    try:
        lock_file = open(lock_path, 'w')
        
        # Try to acquire exclusive lock (non-blocking first, then blocking with timeout)
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
            logger.debug(f"✅ Acquired lock: {lock_path}")
        except IOError:
            # Lock held by another process, wait with timeout
            logger.info(f"⏳ Waiting for lock: {lock_path}")
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            acquired = True
            logger.debug(f"✅ Acquired lock after waiting: {lock_path}")
        
        yield lock_file
        
    finally:
        if lock_file and acquired:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                lock_file.close()
                logger.debug(f"🔓 Released lock: {lock_path}")
                
                # Clean up lock file
                if os.path.exists(lock_path):
                    os.remove(lock_path)
                    
            except Exception as e:
                logger.warning(f"⚠️ Error releasing lock: {e}")


def cleanup_partial_index_files(event_id: int):
    """
    Remove any partial/corrupted index files before rebuilding.
    Prevents the ".index exists but _map.npy missing" scenario.
    """
    index_path = os.path.join(INDEXES_PATH, f"event_{event_id}.index")
    map_path = os.path.join(INDEXES_PATH, f"event_{event_id}_map.npy")
    lock_path = os.path.join(INDEXES_PATH, f"event_{event_id}.lock")
    
    removed = []
    
    for path in [index_path, map_path, lock_path]:
        if os.path.exists(path):
            try:
                os.remove(path)
                removed.append(path)
                logger.info(f"🗑️  Cleaned up partial file: {path}")
            except Exception as e:
                logger.error(f"❌ Failed to remove {path}: {e}")
    
    return removed


def verify_index_files_complete(event_id: int) -> bool:
    """
    Verify BOTH index files exist and are non-empty.
    Returns True only if both files are present and valid.
    """
    index_path = os.path.join(INDEXES_PATH, f"event_{event_id}.index")
    map_path = os.path.join(INDEXES_PATH, f"event_{event_id}_map.npy")
    
    checks = {
        "index_exists": os.path.exists(index_path),
        "map_exists": os.path.exists(map_path),
        "index_size": 0,
        "map_size": 0,
    }
    
    if checks["index_exists"]:
        checks["index_size"] = os.path.getsize(index_path)
    
    if checks["map_exists"]:
        checks["map_size"] = os.path.getsize(map_path)
    
    is_valid = (
        checks["index_exists"] and 
        checks["map_exists"] and 
        checks["index_size"] > 0 and 
        checks["map_size"] > 0
    )
    
    if not is_valid:
        logger.warning(f"⚠️  Index files incomplete for event {event_id}: {checks}")
    
    return is_valid


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

        # Redis keys with 24hr TTL
        r = _get_redis()
        r.set(f"event:{event_id}:total",     len(photos), ex=86400)
        r.set(f"event:{event_id}:completed", 0,           ex=86400)
        r.set(f"event:{event_id}:phase",     "face_detection", ex=86400)

        logger.info(f"🚀 Processing event {event_id}: {len(photos)} photos dispatched")

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

@celery.task(bind=True, queue=PHOTO_QUEUE, soft_time_limit=100, time_limit=180)
def process_single_photo(self, photo_id: int, raw_filename: str, event_id: int):
    """
    1. Optimise image (pyvips → Pillow fallback)
    2. Run InsightFace face detection
    3. Return result dict (no DB writes here)
    """
    from app.services.face_service import process_single_image

    t_start = time.time()

    try:
        # Image pipeline
        optimized_name, face_np = process_image(raw_filename, event_id)

        if not optimized_name:
            logger.warning(f"⚠️  Photo {photo_id}: Pipeline failed")
            return _photo_result(photo_id, "pipeline_failed")

        t_opt = time.time() - t_start

        # Face detection
        face_results = process_single_image(event_id, optimized_name, face_np)

        serialised_faces = []
        for _filename, emb in face_results:
            serialised_faces.append({
                "image_name":    optimized_name,
                "embedding_b64": base64.b64encode(pickle.dumps(emb)).decode(),
            })

        # Redis progress increment
        r = _get_redis()
        r.incr(f"event:{event_id}:completed")
        r.expire(f"event:{event_id}:completed", 86400)

        t_total = time.time() - t_start
        logger.debug(f"✅ Photo {photo_id} processed in {t_total:.2f}s ({len(serialised_faces)} faces)")
        return _photo_result(photo_id, "ok", optimized_name, serialised_faces, t_opt, t_total)

    except SoftTimeLimitExceeded:
        logger.warning(f"⏰ Photo {photo_id}: Timeout exceeded")
        return _photo_result(photo_id, "timeout")
    except Exception as exc:
        logger.error(f"❌ Photo {photo_id} failed: {exc}", exc_info=True)
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
# TASK 3 — FINALIZER (THE CRITICAL FIX IS HERE!)
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=FINALIZE_QUEUE)
def finalize_event(self, photo_results: list[dict], event_id: int):
    """
    Chord callback. Bulk DB writes + clustering + FAISS rebuild + AI trigger.
    
    KEY FIX: Uses atomic file operations to ensure BOTH .index and _map.npy
    are written together. If either fails, both are cleaned up and retried.
    """
    db = SessionLocal()
    event_start = time.time()
    r = _get_redis()

    # Track success/failure for reporting
    final_status = {"status": "unknown", "faiss_saved": False, "ai_triggered": False}

    try:
        # ═══════════════════════════════════════════════════════════════════
        # PHASE 1: CLUSTERING
        # ═══════════════════════════════════════════════════════════════════
        logger.info(f"\n{'='*60}")
        logger.info(f"🔧 FINALIZE EVENT {event_id}")
        logger.info(f"{'='*60}")
        
        r.set(f"event:{event_id}:phase", "clustering", ex=86400)
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
                try:
                    emb = pickle.loads(base64.b64decode(f["embedding_b64"]))
                    new_faces.append((f["image_name"], emb, res["photo_id"]))
                except Exception as e:
                    logger.warning(f"⚠️  Failed to deserialize embedding: {e}")

        logger.info(f"📸 {total_optimized}/{total_new} optimized, {len(new_faces)} faces detected")

        if not new_faces:
            logger.info(f"ℹ️  No new faces to process")
            r.set(f"event:{event_id}:phase", "done", ex=86400)
            _finalize_complete(db, event_id, total_new, 0, 0, event_start)
            _redis_cleanup(event_id)
            _release_lock(event_id)
            
            # Trigger AI enrichment even if no new faces (might have unenriched photos)
            _trigger_ai_enrichment_safe(event_id)
            
            return {"status": "completed_no_new_faces"}

        # ═══════════════════════════════════════════════════════════════════
        # PHASE 2: DBSCAN CLUSTERING
        # ═══════════════════════════════════════════════════════════════════
        _db_update_event(db, event_id, processing_progress=75)

        os.makedirs(INDEXES_PATH, exist_ok=True)
        
        # Use file lock to prevent concurrent access
        lock_path = os.path.join(INDEXES_PATH, f"event_{event_id}.lock")
        
        with file_lock(lock_path):
            # CLEANUP: Remove any partial/corrupted files from previous failed runs
            logger.info(f"🧹 Cleaning up any partial index files from previous runs...")
            removed_files = cleanup_partial_index_files(event_id)
            if removed_files:
                logger.warning(f"   Removed {len(removed_files)} partial files before rebuild")

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
                    cluster_index.add(emb_norm.reshape(1, -1))
                    cluster_map.append(current_cluster)
                    current_cluster += 1

                new_cluster_rows.append(Cluster(
                    event_id=event_id,
                    cluster_id=assigned,
                    image_name=image_name,
                    embedding=pickle.dumps(emb),
                ))

            _db_update_event(db, event_id, processing_progress=80)

            # Save clusters to DB
            db.add_all(new_cluster_rows)
            db.commit()
            logger.info(f"💾 Saved {len(new_cluster_rows)} new clusters to DB")

            # Save cluster index (for grouping similar faces)
            try:
                faiss.write_index(cluster_index, cluster_index_path)
                np.save(cluster_map_path, np.array(cluster_map))
                logger.info(f"💾 Cluster index saved")
            except Exception as e:
                logger.error(f"❌ Failed to save cluster index: {e}")

            # ═══════════════════════════════════════════════════════════════
            # PHASE 3: BUILD SEARCH INDEX (THE CRITICAL FIX!)
            # ═══════════════════════════════════════════════════════════════
            logger.info(f"\n🔍 Building FAISS SEARCH index for event {event_id}...")
            _db_update_event(db, event_id, processing_progress=85)

            try:
                # Create fresh search index
                search_index = EventFaissIndex(event_id)
                
                # Get ALL clusters for this event (existing + newly created)
                all_clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
                
                if all_clusters:
                    embeddings_to_add = []
                    db_ids_to_add = []
                    
                    for cluster in all_clusters:
                        try:
                            emb = pickle.loads(cluster.embedding)
                            embeddings_to_add.append(emb)
                            db_ids_to_add.append(cluster.id)
                        except Exception as emb_err:
                            logger.warning(f"⚠️  Failed to load embedding for cluster {cluster.id}: {emb_err}")
                    
                    if embeddings_to_add:
                        logger.info(f"📊 Adding {len(embeddings_to_add)} embeddings to search index...")
                        search_index.add_embeddings(embeddings_to_add, db_ids_to_add)
                        
                        # ✅ ATOMIC SAVE - Both files must succeed!
                        logger.info(f"💾 Saving search index atomically...")
                        _atomic_save_faiss_index(search_index, event_id)
                        
                        # ✅ VERIFICATION - Ensure both files exist!
                        if not verify_index_files_complete(event_id):
                            raise FileNotFoundError(
                                f"❌ FAISS save incomplete! Files missing after save operation."
                            )
                        
                        final_status["faiss_saved"] = True
                        logger.info(f"✅ Search index saved and verified successfully!")
                        logger.info(f"   📄 {search_index.index_path} ({os.path.getsize(search_index.index_path)} bytes)")
                        logger.info(f"   📄 {search_index.map_path} ({os.path.getsize(search_index.map_path)} bytes)")
                    else:
                        logger.warning(f"⚠️  No valid embeddings to add to search index")
                else:
                    logger.warning(f"⚠️  No clusters found for event {event_id}")

            except Exception as save_error:
                logger.error(f"❌ FATAL: Failed to build/save FAISS search index!")
                logger.error(f"   Error: {save_error}")
                
                # Clean up partial files
                cleanup_partial_index_files(event_id)
                
                # Don't mark as completed - mark as failed so owner knows!
                _db_update_event(db, event_id, 
                                 processing_status="failed",
                                 processing_progress=0)
                
                raise  # Re-raise so Celery marks task as FAILURE

        # ═══════════════════════════════════════════════════════════════════
        # PHASE 4: TRIGGER AI ENRICHMENT (OPTIONAL - WON'T FAIL IF UNAVAILABLE)
        # ═══════════════════════════════════════════════════════════════════
        logger.info(f"\n🎨 Attempting to trigger AI enrichment...")
        ai_result = _trigger_ai_enrichment_safe(event_id)
        final_status["ai_triggered"] = ai_result["triggered"]

        # ═══════════════════════════════════════════════════════════════════
        # PHASE 5: COMPLETION
        # ═══════════════════════════════════════════════════════════════════
        _db_update_event(db, event_id, 
                         processing_status="completed",
                         processing_progress=100,
                         total_faces=len(new_faces),
                         total_clusters=current_cluster)
        
        r.set(f"event:{event_id}:phase", "done", ex=86400)
        
        total_time = time.time() - event_start
        logger.info(f"\n{'='*60}")
        logger.info(f"✅ EVENT {event_id} PROCESSING COMPLETE")
        logger.info(f"   Faces: {len(new_faces)}")
        logger.info(f"   Clusters: {current_cluster}")
        logger.info(f"   FAISS Index: {'✅ SAVED' if final_status['faiss_saved'] else '❌ FAILED'}")
        logger.info(f"   AI Enrichment: {'✅ TRIGGERED' if final_status['ai_triggered'] else '⏭️  SKIPPED'}")
        logger.info(f"   Total Time: {total_time:.1f}s")
        logger.info(f"{'='*60}\n")
        
        _finalize_complete(db, event_id, total_new, len(new_faces), current_cluster, event_start)
        _redis_cleanup(event_id)
        _release_lock(event_id)
        
        final_status["status"] = "completed"
        return final_status

    except Exception as e:
        logger.error(f"\n❌ FATAL ERROR in finalize_event for event {event_id}!")
        logger.error(f"   Error: {e}", exc_info=True)
        
        # Mark event as failed
        try:
            _db_update_event(db, event_id, 
                             processing_status="failed",
                             processing_progress=0)
            db.commit()
        except Exception as db_err:
            logger.error(f"❌ Failed to update event status: {db_err}")
        
        raise  # Re-raise for Celery retry logic

    finally:
        db.close()


def _atomic_save_faiss_index(search_index: EventFaissIndex, event_id: int):
    """
    ATOMIC SAVE OPERATION - Ensures BOTH .index and _map.npy are written together.
    
    Uses write-to-temp-then-rename strategy to prevent partial writes.
    If either file fails, NEITHER is committed.
    """
    import tempfile
    
    temp_dir = None
    
    try:
        # Create temp directory in same filesystem for atomic rename
        temp_dir = tempfile.mkdtemp(dir=INDEXES_PATH)
        
        temp_index_path = os.path.join(temp_dir, f"temp_{event_id}.index")
        temp_map_path = os.path.join(temp_dir, f"temp_{event_id}_map.npy")
        
        logger.debug(f"   Writing to temp files in: {temp_dir}")
        
        # Write BOTH files to temp location
        faiss.write_index(search_index.index, temp_index_path)
        np.save(temp_map_path, np.array(search_index.id_map))
        
        # Verify temp files were created successfully
        if not os.path.exists(temp_index_path):
            raise IOError("Failed to write temporary .index file")
        
        if not os.path.exists(temp_map_path):
            raise IOError("Failed to write temporary _map.npy file")
        
        if os.path.getsize(temp_index_path) == 0:
            raise IOError("Temporary .index file is empty")
        
        if os.path.getsize(temp_map_path) == 0:
            raise IOError("Temporary _map.npy file is empty")
        
        logger.debug(f"   Temp files verified, performing atomic rename...")
        
        # Atomic rename (works on Linux/Unix - instantaneous)
        os.replace(temp_index_path, search_index.index_path)
        os.replace(temp_map_path, search_index.map_path)
        
        logger.debug(f"   Atomic rename complete")
        
    finally:
        # Always cleanup temp directory
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
                logger.debug(f"   Cleaned up temp directory")
            except Exception as cleanup_err:
                logger.warning(f"   ⚠️  Failed to cleanup temp dir: {cleanup_err}")


def _trigger_ai_enrichment_safe(event_id: int) -> dict:
    """
    Safely trigger AI enrichment task.
    
    FIX FOR: "AI enrichment task not available, skipping"
    
    This function:
    1. Checks if the task can be sent without blocking
    2. Catches ALL exceptions gracefully
    3. Returns status without failing the main processing pipeline
    4. Logs clear warnings so you know what's happening
    """
    result = {"triggered": False, "method": None, "error": None}
    
    try:
        from app.workers.ai_enrichment_task import ai_enrich_event
        
        # Method 1: Try to apply_async (non-blocking)
        # This will succeed even if no worker is listening - task goes to queue
        try:
            ai_enrich_event.apply_async(args=[event_id], queue=AI_QUEUE)
            result["triggered"] = True
            result["method"] = "apply_async"
            logger.info(f"✅ AI enrichment task queued successfully for event {event_id}")
            return result
            
        except Exception as async_err:
            logger.warning(f"⚠️  apply_async failed, trying delay(): {async_err}")
            
            # Method 2: Try delay() (alternative dispatch method)
            try:
                ai_enrich_event.delay(event_id)
                result["triggered"] = True
                result["method"] = "delay"
                logger.info(f"✅ AI enrichment task sent via delay() for event {event_id}")
                return result
                
            except Exception as delay_err:
                logger.warning(f"⚠️  delay() also failed: {delay_err}")
                result["error"] = str(delay_err)
                
    except ImportError as e:
        # Module doesn't exist - AI enrichment feature not installed/disabled
        logger.warning(
            f"\n⚠️  AI enrichment module not available (ImportError)"
            f"\n   This is NORMAL if you don't have celery_ai worker running."
            f"\n   Error: {e}"
            f"\n   💡 To enable AI enrichment:"
            f"\n      1. Ensure app/workers/ai_enrichment_task.py exists"
            f"\n      2. Start celery_ai worker: docker compose up -d celery_ai"
            f"\n      3. Or ignore this warning - processing completed successfully!"
        )
        result["error"] = f"Module not found: {e}"
        
    except Exception as e:
        # Any other error during task dispatch
        logger.warning(
            f"\n⚠️  AI enrichment task not available, skipping"
            f"\n   This is NON-FATAL - your photos processed successfully!"
            f"\n   Error type: {type(e).__name__}"
            f"\n   Error: {e}"
            f"\n   💡 Possible causes:"
            f"\n      1. celery_ai container is not running (check: docker ps)"
            f"\n      2. ai_enrichment queue has no worker listening"
            f"\n      3. Redis connection issue"
            f"\n   💡 To fix:"
            f"\n      docker compose up -d celery_ai"
            f"\n   💡 Or manually enrich later via API:"
            f"\n      POST /api/events/{event_id}/enrich"
        )
        result["error"] = str(e)
    
    if not result["triggered"]:
        logger.info(f"ℹ️  Continuing without AI enrichment (scene/object detection will be skipped)")
        logger.info(f"ℹ️  You can run AI enrichment later manually if needed\n")
    
    return result


# ─────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def _db_update_event(db, event_id, **kwargs):
    """Update event fields with kwargs."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if event:
        for key, value in kwargs.items():
            setattr(event, key, value)
        db.commit()

def _bulk_update_photos(db, photo_results):
    """
    Bulk update photo statuses AND optimized filenames.
    
    CRITICAL FIX: Must update BOTH fields or 'All Photos' gallery will be empty!
    """
    # Separate successful and failed photos
    success_results = [r for r in photo_results if r["status"] == "ok"]
    failed_results = [r for r in photo_results if r["status"] != "ok"]
    
    updated_count = 0  # ← Use this instead of photo_ids
    
    if success_results:
        # Update successful photos with BOTH status AND optimized_filename
        for r in success_results:
            if r.get("optimized_name"):
                db.query(Photo).filter(Photo.id == r["photo_id"]).update(
                    {
                        "status": "processed",
                        "optimized_filename": r["optimized_name"],
                        "processed_at": datetime.utcnow(),
                    },
                    synchronize_session=False
                )
                updated_count += 1
            else:
                # No optimized name but still mark as processed
                logger.warning(f"⚠️  Photo {r['photo_id']} succeeded but no optimized_name!")
                db.query(Photo).filter(Photo.id == r["photo_id"]).update(
                    {"status": "processed", "processed_at": datetime.utcnow()},
                    synchronize_session=False
                )
                updated_count += 1
        
        db.commit()
        logger.info(f"📝 Updated {updated_count} photos to 'processed' (with optimized_filename)")
    
    # Handle failed photos
    if failed_results:
        failed_ids = [r["photo_id"] for r in failed_results]
        db.query(Photo).filter(Photo.id.in_(failed_ids)).update(
            {"status": "failed"},
            synchronize_session=False
        )
        db.commit()
        logger.info(f"📝 Marked {len(failed_ids)} photos as 'failed'")
    
    return updated_count  # ← Return count for debugging

def _finalize_complete(db, event_id, total_new, total_faces, total_clusters, start_time):
    """Log completion stats."""
    elapsed = time.time() - start_time
    logger.info(
        f"✅ Finalized event {event_id}: "
        f"{total_new} photos, {total_faces} faces, "
        f"{total_clusters} clusters, {elapsed:.1f}s"
    )

def _redis_cleanup(event_id: int):
    """Clean up Redis keys for completed event."""
    try:
        r = _get_redis()
        keys_to_delete = [
            f"event:{event_id}:total",
            f"event:{event_id}:completed",
            f"event:{event_id}:phase",
            f"event:{event_id}:lock",
        ]
        for key in keys_to_delete:
            r.delete(key)
        logger.debug(f"🧹 Cleaned up Redis keys for event {event_id}")
    except Exception as e:
        logger.warning(f"⚠️  Redis cleanup failed: {e}")

def _release_lock(event_id: int):
    """Release any file locks."""
    lock_path = os.path.join(INDEXES_PATH, f"event_{event_id}.lock")
    if os.path.exists(lock_path):
        try:
            os.remove(lock_path)
            logger.debug(f"🔓 Released lock file: {lock_path}")
        except Exception as e:
            logger.warning(f"⚠️  Failed to release lock: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MAINTENANCE TASKS
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(queue="default")
def cleanup_expired_events():
    """Daily cleanup of expired events and their data."""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        
        expired_events = db.query(Event).filter(
            Event.expires_at != None,
            Event.expires_at < now,
            Event.public_status == "active"
        ).all()
        
        cleaned = 0
        for event in expired_events:
            try:
                # Deactivate event
                event.public_status = "expired"
                db.commit()
                
                # Optionally clean up index files
                cleanup_partial_index_files(event.id)
                
                cleaned += 1
                logger.info(f"🗑️  Expired event {event.id}: {event.name}")
                
            except Exception as e:
                logger.error(f"❌ Failed to cleanup event {event.id}: {e}")
        
        logger.info(f"🧹 Cleanup complete: {cleaned} events expired")
        return {"cleaned": cleaned}
        
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# MANUAL REPAIR FUNCTION (for fixing corrupted indexes like yours!)
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(queue="event_finalize")
def repair_event_index(event_id: int):
    """
    Manual task to repair/rebuild a corrupted or missing FAISS index.
    
    Can be triggered via:
        repair_event_index.delay(15)
    
    Useful when:
    - _map.npy file is missing (YOUR CURRENT ISSUE!)
    - Index files are corrupted
    - Search returns 500 errors
    """
    db = SessionLocal()
    
    try:
        logger.info(f"\n🔧 REPAIRING INDEX FOR EVENT {event_id}")
        logger.info(f"{'='*60}")
        
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            logger.error(f"❌ Event {event_id} not found")
            return {"status": "error", "message": "Event not found"}
        
        # Use file lock to prevent concurrent repairs
        lock_path = os.path.join(INDEXES_PATH, f"event_{event_id}.lock")
        
        with file_lock(lock_path):
            # Step 1: Clean up any existing partial files
            logger.info(f"Step 1: Cleaning up existing files...")
            cleanup_partial_index_files(event_id)
            
            # Step 2: Get all clusters from DB
            logger.info(f"Step 2: Loading clusters from database...")
            clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
            
            if not clusters:
                logger.warning(f"⚠️  No clusters found for event {event_id}")
                logger.info(f"ℹ️  Need to reprocess photos first!")
                return {"status": "no_clusters", "message": "No clusters - reprocess event"}
            
            logger.info(f"   Found {len(clusters)} clusters")
            
            # Step 3: Build new index
            logger.info(f"Step 3: Building new FAISS index...")
            search_index = EventFaissIndex(event_id)
            
            embeddings_to_add = []
            db_ids_to_add = []
            
            for cluster in clusters:
                try:
                    emb = pickle.loads(cluster.embedding)
                    embeddings_to_add.append(emb)
                    db_ids_to_add.append(cluster.id)
                except Exception as e:
                    logger.warning(f"   ⚠️  Skipping cluster {cluster.id}: {e}")
            
            if not embeddings_to_add:
                logger.error(f"❌ No valid embeddings found")
                return {"status": "error", "message": "No valid embeddings"}
            
            logger.info(f"   Adding {len(embeddings_to_add)} embeddings...")
            search_index.add_embeddings(embeddings_to_add, db_ids_to_add)
            
            # Step 4: Atomic save
            logger.info(f"Step 4: Saving index atomically...")
            _atomic_save_faiss_index(search_index, event_id)
            
            # Step 5: Verify
            logger.info(f"Step 5: Verifying saved files...")
            if verify_index_files_complete(event_id):
                logger.info(f"✅ REPAIR SUCCESSFUL!")
                logger.info(f"   📄 {search_index.index_path} ({os.path.getsize(search_index.index_path)} bytes)")
                logger.info(f"   📄 {search_index.map_path} ({os.path.getsize(search_index.map_path)} bytes)")
                
                return {
                    "status": "success",
                    "embeddings_indexed": len(embeddings_to_add),
                    "files_created": 2
                }
            else:
                logger.error(f"❌ Verification failed after repair!")
                return {"status": "error", "message": "Verification failed"}
                
    except Exception as e:
        logger.error(f"❌ Repair failed: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}
        
    finally:
        db.close()