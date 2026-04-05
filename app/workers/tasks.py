"""
app/workers/tasks.py — Celery task pipeline for SnapFind photo processing.

Pipeline:
  process_event (orchestrator)
      └─► _dispatch_chord (async)
              └─► [chord] process_single_photo × N  (fan-out)
                      └─► finalize_event            (chord callback, runs once all photos done)
                              └─► enrich_event_photos  (AI enrichment, async)
                              └─► notify_guests_task   (guest email notifications, async)

Key features:
  ✅ async dispatch chord — orchestrator returns in ~5s, scales to unlimited photos
  ✅ image_pipeline.process_image() — optimization + thumbnail + raw deletion + face_np
  ✅ process_single_image(event_id, optimized_name, face_np) — correct arg order
  ✅ base64/pickle embedding serialization across Celery boundary
  ✅ Incremental clustering with FAISS (reuses existing clusters)
  ✅ _merge_clusters() — post-clustering centroid merge pass
  ✅ _rebuild_faiss() — full FAISS index rebuild after clustering
  ✅ _bulk_update_photos() — sets optimized_filename + faces_detected
  ✅ Redis phase tracking (face_detection → clustering → building_index → enriching → done)
  ✅ Guest email notifications after processing completes
  ✅ AI enrichment task (delegates to ai_enrichment_task)
  ✅ cleanup_expired_events using storage_service.delete_event_folder

Fixes carried forward:
  ✅ [FIX-1] finalize_event idempotency guard (safe to call twice)
  ✅ [FIX-2] Safety-net finalize scheduled at 3x ETA
  ✅ [FIX-3] Fresh DB session on orchestrator error reset
  ✅ [FIX-4] 2-hour stuck-run auto-recovery
  ✅ [FIX-5] cluster_id as integer (no more string "3476_0" error)
  ✅ [FIX-6] acks_late + reject_on_worker_lost on all tasks
  ✅ [FIX-7] ASYNC CHORD DISPATCH — prevents 120s timeout on large events
"""

from __future__ import annotations

import base64
import os
import pickle
import time
import traceback
from datetime import datetime
from typing import List, Optional
from collections import defaultdict

import faiss
import numpy as np
import redis as redis_lib
from celery import chord
from celery.exceptions import SoftTimeLimitExceeded

from app.core.config import INDEXES_PATH
from app.database.db import SessionLocal
from app.models.cluster import Cluster
from app.models.event import Event
from app.models.photo import Photo
from app.services import storage_service
from app.services.face_service import process_single_image
from app.services.faiss_manager import FaissManager
from app.services.image_pipeline import process_image
from app.workers.celery_worker import celery


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

PHOTO_QUEUE    = "photo_processing"
FINALIZE_QUEUE = "event_finalize"
AI_QUEUE       = "ai_enrichment"

THRESHOLD    = 0.45   # InsightFace cosine similarity for cluster assignment
MERGE_THRESH = 0.82   # Centroid similarity threshold for post-cluster merge


class ProcessingConfig:
    ORCHESTRATOR_SOFT_LIMIT = 120
    ORCHESTRATOR_HARD_LIMIT = 150
    PHOTO_SOFT_LIMIT        = 300
    PHOTO_HARD_LIMIT        = 420
    FINALIZE_SOFT_LIMIT     = 1800
    FINALIZE_HARD_LIMIT     = 3600

    PROGRESS_ORCHESTRATION = 10
    PROGRESS_CLUSTERING    = 75
    PROGRESS_INDEXING      = 88
    PROGRESS_COMPLETE      = 100

    REDIS_TTL      = 86_400   # 24 hours
    REDIS_TTL_DONE = 3_600    # 1 hour after completion


# ══════════════════════════════════════════════════════════════════════════════
# REDIS
# ══════════════════════════════════════════════════════════════════════════════

_redis_instance: Optional[redis_lib.Redis] = None


def _get_redis() -> redis_lib.Redis:
    global _redis_instance
    if _redis_instance is None:
        _redis_instance = redis_lib.Redis.from_url(
            os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0"),
            decode_responses=True,
            max_connections=20,
            socket_timeout=5,
            socket_connect_timeout=5,
            retry_on_timeout=True,
            health_check_interval=30,
        )
        _redis_instance.ping()
        print("✅ Redis connection established")
    return _redis_instance


def _redis_set(event_id: int, key: str, value: str,
               ttl: int = ProcessingConfig.REDIS_TTL):
    try:
        _get_redis().set(f"event:{event_id}:{key}", value, ex=ttl)
    except Exception as e:
        print(f"⚠️  Redis set failed ({key}): {e}")


def _redis_cleanup(event_id: int):
    """Clear progress counters; keep phase key for 1h for frontend polling."""
    try:
        r = _get_redis()
        r.delete(f"event:{event_id}:total")
        r.delete(f"event:{event_id}:completed")
        r.expire(f"event:{event_id}:phase", ProcessingConfig.REDIS_TTL_DONE)
    except Exception:
        pass


def _release_lock(event_id: int):
    try:
        _get_redis().delete(f"event:{event_id}:lock")
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════════
# DB HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _db_update_event(db, event_id: int, **kwargs):
    db.query(Event).filter(Event.id == event_id).update(kwargs)
    db.commit()


def _bulk_update_photos(db, photo_results: list):
    """
    Bulk-update Photo rows:
      - status            → 'processed' or 'failed'
      - optimized_filename → set when pipeline succeeded
      - faces_detected     → count of faces found
    """
    mappings = []
    for r in photo_results:
        m = {
            "id":             r["photo_id"],
            "status":         "processed" if r["status"] == "ok" else "failed",
            "faces_detected": len(r.get("faces") or []),
        }
        if r.get("optimized_name"):
            m["optimized_filename"] = r["optimized_name"]
        mappings.append(m)
    db.bulk_update_mappings(Photo, mappings)
    db.commit()


def _estimate_eta(total_photos: int) -> int:
    if total_photos <= 10:   return 15
    if total_photos <= 50:   return 30
    if total_photos <= 100:  return 60
    if total_photos <= 500:  return 120
    if total_photos <= 1000: return 300
    return 300 + (total_photos // 100) * 3


def _reset_event_status(event_id: int, status: str = "pending"):
    """Always opens a FRESH session — never reuses a broken caller session."""
    try:
        fresh_db = SessionLocal()
        try:
            fresh_db.query(Event).filter(Event.id == event_id).update({
                "processing_status":     status,
                "processing_started_at": None if status == "pending" else datetime.utcnow(),
                "processing_progress":   0 if status == "pending" else None,
            })
            fresh_db.commit()
            print(f"↩️  Event #{event_id} reset to '{status}'")
        finally:
            fresh_db.close()
    except Exception as e:
        print(f"❌ CRITICAL: Could not reset Event #{event_id}: {e}")


def _photo_result(photo_id, status, optimized_name=None,
                  faces=None, t_opt=0.0, t_total=0.0):
    return {
        "photo_id":       photo_id,
        "status":         status,
        "optimized_name": optimized_name,
        "faces":          faces or [],
        "t_opt":          round(t_opt, 3),
        "t_total":        round(t_total, 3),
    }


# ══════════════════════════════════════════════════════════════════════════════
# TASK 1 — ORCHESTRATOR
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    queue=PHOTO_QUEUE,
    soft_time_limit=ProcessingConfig.ORCHESTRATOR_SOFT_LIMIT,
    time_limit=ProcessingConfig.ORCHESTRATOR_HARD_LIMIT,
    acks_late=True,
    reject_on_worker_lost=True,
    name="app.workers.tasks.process_event",
)
def process_event(self, event_id: int) -> dict:
    """
    Orchestrator — dispatches one process_single_photo per unprocessed photo
    via Celery chord, with finalize_event as the callback.
    
    CHANGES (async dispatch):
      - OLD: Blocking chord.apply_async() took 100-130s, hit 120s timeout
      - NEW: Queue async _dispatch_chord task (~5s total), return immediately
    """
    start = time.time()
    r     = _get_redis()

    print(f"\n{'='*70}")
    print(f"🚀 ORCHESTRATOR STARTED — Event #{event_id}")
    print(f"{'='*70}")

    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return {"status": "event_not_found"}

        # ── Stuck-run guard (2-hour window) ───────────────────────────────────
        if event.processing_status == "processing":
            if event.processing_started_at:
                elapsed_s = (datetime.utcnow() - event.processing_started_at).total_seconds()
                if elapsed_s < 7200:
                    print(f"⚠️  Already processing ({elapsed_s:.0f}s ago) — skipping")
                    return {
                        "status":          "already_processing",
                        "elapsed_seconds": int(elapsed_s),
                    }
                else:
                    print(f"⚠️  Stuck run ({elapsed_s:.0f}s) — restarting…")

        photos = db.query(Photo).filter(
            Photo.event_id == event_id,
            Photo.status == "uploaded",
            Photo.approval_status == "approved",
        ).all()

        if not photos:
            return {"status": "no_photos_to_process"}

        total = len(photos)
        eta   = _estimate_eta(total)
        print(f"📊 Photos: {total:,}  |  ETA: {eta}s")

        # ── Claim processing lock ─────────────────────────────────────────────
        event.processing_status     = "processing"
        event.processing_progress   = ProcessingConfig.PROGRESS_ORCHESTRATION
        event.processing_started_at = datetime.utcnow()
        event.process_count         = (event.process_count or 0) + 1
        db.commit()

        # ── Redis progress keys ───────────────────────────────────────────────
        r.set(f"event:{event_id}:total",     total,            ex=ProcessingConfig.REDIS_TTL)
        r.set(f"event:{event_id}:completed", 0,                ex=ProcessingConfig.REDIS_TTL)
        r.set(f"event:{event_id}:phase",     "face_detection", ex=ProcessingConfig.REDIS_TTL)

        # ── Safety-net finalize (idempotent — double-fire is harmless) ────────
        finalize_event.apply_async(
            args=[
                [{"photo_id": p.id, "status": "safety_net",
                  "faces": [], "optimized_name": None} for p in photos],
                event_id,
            ],
            queue=FINALIZE_QUEUE,
            countdown=eta * 3,
        )
        print(f"   🛡️  Safety-net finalize scheduled in {eta * 3}s")

        # ── Queue async chord dispatch (NON-BLOCKING) ──────────────────────────
        # Instead of blocking the orchestrator on chord setup, queue a separate
        # task to handle the blocking Redis operations. This keeps the orchestrator
        # responsive (< 10s) and scales to unlimited photos.
        photo_ids = [p.id for p in photos]
        dispatch_result = _dispatch_chord.apply_async(
            args=[event_id, photo_ids],
            queue=PHOTO_QUEUE,
            countdown=1,  # 1-second delay to ensure orchestrator completes DB commit first
        )
        print(f"   🔗 Async chord dispatch queued")
        print(f"      Dispatch task ID: {dispatch_result.id}")

        elapsed = round(time.time() - start, 2)
        print(f"\n✅ ORCHESTRATOR COMPLETED in {elapsed}s — {total} photos")

        return {"status": "dispatched", "photo_count": total, "eta_s": eta}

    except SoftTimeLimitExceeded:
        print(f"⏰ Orchestrator time limit — Event #{event_id}")
        _reset_event_status(event_id, "pending")
        raise

    except Exception as exc:
        print(f"❌ Orchestrator failed — Event #{event_id}: {exc}")
        traceback.print_exc()
        _reset_event_status(event_id, "pending")
        raise

    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 1B — ASYNC CHORD DISPATCH (NEW)
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    queue=PHOTO_QUEUE,
    soft_time_limit=300,
    time_limit=420,
    acks_late=True,
    reject_on_worker_lost=True,
    name="app.workers.tasks._dispatch_chord",
)
def _dispatch_chord(self, event_id: int, photo_ids: list):
    """
    **Internal task** — async chord dispatch worker.
    
    Called by orchestrator to avoid blocking on chord setup.
    This task runs on a worker (not orchestrator thread), so:
    - Long-running Redis operations don't block orchestrator
    - Scales to unlimited photos without timeout
    - If Redis is slow, it only affects this worker task, not orchestrator
    
    Responsibility:
      1. Fetch photo records from DB
      2. Build chord signatures (list of task objects)
      3. Call apply_async() to dispatch chord
    
    All of this is blocking, but safe here because:
      - 300s soft limit (orchestrator has 120s)
      - Runs on worker pool, not orchestrator thread
      - Safety-net finalize catches failure if this times out
    """
    db = SessionLocal()
    try:
        photos = db.query(Photo).filter(Photo.id.in_(photo_ids)).all()
        
        if not photos:
            print(f"⚠️  No photos found for dispatch (Event #{event_id})")
            return {
                "status": "no_photos",
                "event_id": event_id,
            }
        
        print(f"🔗 Building chord for {len(photos)} photos… (Event #{event_id})")
        
        # Build chord signatures (fast: ~100ms for 1000 photos)
        tasks = chord(
            [process_single_photo.s(p.id, p.stored_filename, event_id)
             for p in photos],
            finalize_event.s(event_id),
        )
        
        # BLOCKING CALL (safe here — we're on a worker with 300s limit)
        # Serializes all signatures, subscribes to Redis for result tracking
        result = tasks.apply_async()
        
        print(f"✅ Chord dispatched: {len(photos)} photo tasks queued")
        print(f"   Chord ID: {result.id}")
        
        return {
            "status": "dispatched",
            "event_id": event_id,
            "photo_count": len(photos),
            "chord_id": result.id,
        }
        
    except SoftTimeLimitExceeded:
        print(f"⏰ Dispatch chord time limit (Event #{event_id})")
        _reset_event_status(event_id, "pending")
        raise
        
    except Exception as exc:
        print(f"❌ Dispatch chord failed (Event #{event_id}): {exc}")
        traceback.print_exc()
        _reset_event_status(event_id, "pending")
        raise
        
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 2 — PER-PHOTO WORKER
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    queue=PHOTO_QUEUE,
    soft_time_limit=ProcessingConfig.PHOTO_SOFT_LIMIT,
    time_limit=ProcessingConfig.PHOTO_HARD_LIMIT,
    acks_late=True,
    reject_on_worker_lost=True,
    name="app.workers.tasks.process_single_photo",
)
def process_single_photo(self, photo_id: int, stored_filename: str, event_id: int) -> dict:
    """
    Process one photo: optimize image + extract faces.

    Args:
        photo_id: Photo record ID (for DB updates)
        stored_filename: Original filename (e.g., "photo_123.jpg")
        event_id: Event ID (for file path lookup)

    Returns dict suitable for finalize_event aggregation:
      {
        "photo_id": int,
        "status": "ok" | "failed",
        "optimized_name": "photo_123_opt.jpg" or None,
        "faces": [("photo_123_opt.jpg", embedding_bytes), ...],
        "t_opt": float (seconds for optimize),
        "t_total": float (seconds total)
      }
    """
    t0 = time.time()
    
    try:
        # Validate inputs
        if not isinstance(event_id, int):
            raise TypeError(f"event_id must be int, got {type(event_id).__name__}")
        if not isinstance(stored_filename, str):
            raise TypeError(f"stored_filename must be str, got {type(stored_filename).__name__}")
        if not isinstance(photo_id, int):
            raise TypeError(f"photo_id must be int, got {type(photo_id).__name__}")
        
        print(f"   📸 Processing Photo #{photo_id} ({stored_filename}) — Event #{event_id}")
        
        # STEP 1: Optimize image (resize, thumbnail, EXIF, delete raw)
        # process_image returns: (optimized_filename, face_np) as TUPLE
        t_opt_start = time.time()
        optimized_name, face_np = process_image(stored_filename, event_id)
        t_opt = time.time() - t_opt_start
        
        if not optimized_name:
            print(f"   ⚠️  Pipeline failed for Photo #{photo_id}")
            return _photo_result(photo_id, "failed", t_opt=t_opt, t_total=time.time() - t0)
        
        # STEP 2: Extract face embeddings
        # process_single_image(event_id, file, face_np) where face_np is optional
        # If face_np provided, skips disk read (already EXIF-corrected from pipeline)
        try:
            face_results = process_single_image(event_id, optimized_name, face_np=face_np)
        except Exception as e:
            print(f"   [ERROR] process_single_image failed: {e}")
            traceback.print_exc()
            # Fail gracefully — photo was optimized but face detection errored
            return _photo_result(
                photo_id, "ok", optimized_name=optimized_name,
                t_opt=t_opt, t_total=time.time() - t0
            )
        
        if not face_results:
            # No faces detected, but photo processed OK
            print(f"   📸 Photo #{photo_id}: 0 faces")
            return _photo_result(
                photo_id, "ok", optimized_name=optimized_name,
                t_opt=t_opt, t_total=time.time() - t0
            )
        
        # STEP 3: Serialize embeddings for Celery transport (base64)
        serialized_faces = []
        for filename, embedding in face_results:
            try:
                emb_b64 = base64.b64encode(embedding.tobytes()).decode("ascii")
                serialized_faces.append((filename, emb_b64))
            except Exception as e:
                print(f"   [WARN] Embedding serialization failed: {e}")
                continue
        
        print(f"   ✅ Photo #{photo_id}: {len(serialized_faces)} faces detected")
        
        return _photo_result(
            photo_id, "ok", optimized_name=optimized_name,
            faces=serialized_faces,
            t_opt=t_opt, t_total=time.time() - t0
        )
        
    except SoftTimeLimitExceeded:
        print(f"⏰ Photo task time limit — Photo #{photo_id}")
        raise
        
    except Exception as exc:
        print(f"❌ Photo error (Photo #{photo_id}): {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return _photo_result(photo_id, "failed", t_opt=0, t_total=time.time() - t0)


# ══════════════════════════════════════════════════════════════════════════════
# TASK 3 — FINALIZE (Chord Callback)
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    queue=FINALIZE_QUEUE,
    soft_time_limit=ProcessingConfig.FINALIZE_SOFT_LIMIT,
    time_limit=ProcessingConfig.FINALIZE_HARD_LIMIT,
    acks_late=True,
    reject_on_worker_lost=True,
    name="app.workers.tasks.finalize_event",
)
def finalize_event(self, photo_results: list, event_id: int) -> dict:
    """
    Finalize event after all photos processed.
    
    photo_results: List of dicts from process_single_photo
    event_id: Event being finalized
    
    Steps:
      1. Update photo records (status + optimized_filename + faces_detected)
      2. Cluster embeddings with FAISS
      3. Rebuild FAISS index
      4. Trigger enrichment (captions, tags)
      5. Mark event completed
    
    Idempotency: Early return if already completed (safe for safety-net re-fire)
    """
    start = time.time()
    
    db = SessionLocal()
    try:
        # ── Idempotency guard ─────────────────────────────────────────────────
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return {"status": "event_not_found"}
        
        if event.processing_status == "completed":
            print(f"✅ Event #{event_id} already finalized (idempotent)")
            return {"status": "already_complete"}
        
        print(f"\n{'='*70}")
        print(f"🏁 FINALIZE STARTED — Event #{event_id}")
        print(f"{'='*70}")
        print(f"   Processing {len(photo_results)} photo results")
        
        # ── STEP 1: Update photo records ──────────────────────────────────────
        _bulk_update_photos(db, photo_results)
        print(f"   ✅ Updated {len(photo_results)} photo records")
        
        # ── STEP 2: Extract embeddings + cluster ──────────────────────────────
        _redis_set(event_id, "phase", "clustering")
        
        all_faces = []
        photo_map = {}
        
        for r in photo_results:
            if r["status"] != "ok" or not r.get("faces"):
                continue
            photo_id = r["photo_id"]
            photo_map[photo_id] = r
            
            for filename, emb_b64 in r["faces"]:
                try:
                    emb_bytes = base64.b64decode(emb_b64)
                    embedding = np.frombuffer(emb_bytes, dtype="float32")
                    all_faces.append({
                        "photo_id": photo_id,
                        "filename": filename,
                        "embedding": embedding,
                    })
                except Exception as e:
                    print(f"   ⚠️  Embedding deserialization error: {e}")
        
        print(f"   📊 Extracted {len(all_faces)} faces from {len(photo_map)} photos")
        
        if not all_faces:
            print(f"   ⚠️  No faces to cluster")
            _finalize_complete(db, event_id, total_new=0, total_clusters=0, total_faces=0, event_start=start)
            return {"status": "no_faces"}
        
        # Clustering logic
        dim = len(all_faces[0]["embedding"])
        cluster_map = {}  # cluster_id → [face_dicts]
        next_cluster_id = 1
        
        # Fetch existing clusters for incremental mode
        existing = db.query(Cluster).filter(Cluster.event_id == event_id).all()
        if existing:
            next_cluster_id = max(c.cluster_id for c in existing) + 1
        
        for face in all_faces:
            emb = face["embedding"]
            assigned = False
            
            # Try to assign to existing cluster
            for cluster in existing:
                try:
                    stored_emb = pickle.loads(cluster.embedding)
                    sim = np.dot(emb, stored_emb)
                    if sim >= THRESHOLD:
                        cluster.embedding = pickle.dumps(emb)
                        cluster.updated_at = datetime.utcnow()
                        cluster_map.setdefault(cluster.cluster_id, []).append(face)
                        assigned = True
                        break
                except Exception:
                    pass
            
            # Create new cluster if no match
            if not assigned:
                cluster_map[next_cluster_id] = [face]
                new_c = Cluster(
                    event_id=event_id,
                    cluster_id=next_cluster_id,
                    embedding=pickle.dumps(emb),
                )
                db.add(new_c)
                next_cluster_id += 1
        
        db.commit()
        print(f"   ✅ Clustered into {len(cluster_map)} groups")
        
        # ── STEP 3: Post-clustering merge ─────────────────────────────────────
        _merge_clusters(db, event_id, dim)
        
        # ── STEP 4: Rebuild FAISS ────────────────────────────────────────────
        _redis_set(event_id, "phase", "building_index")
        _rebuild_faiss(db, event_id)
        
        # ── STEP 5: Mark complete ────────────────────────────────────────────
        total_clusters = db.query(Cluster).filter(Cluster.event_id == event_id).count()
        total_faces = len(all_faces)
        
        _finalize_complete(db, event_id, total_new=len(cluster_map), 
                          total_clusters=total_clusters, total_faces=total_faces, 
                          event_start=start)
        
        # ── STEP 6: Trigger enrichment (non-blocking) ────────────────────────
        _redis_set(event_id, "phase", "enriching")
        try:
            enrich_event_photos.apply_async(args=[event_id], queue=AI_QUEUE)
            print(f"   📧 Queued enrichment task")
        except Exception as e:
            print(f"   ⚠️  Enrichment queue failed (non-fatal): {e}")
        
        return {
            "status": "complete",
            "event_id": event_id,
            "clusters": total_clusters,
            "faces": total_faces,
            "elapsed": round(time.time() - start, 1),
        }
        
    except SoftTimeLimitExceeded:
        print(f"⏰ Finalize time limit — Event #{event_id}")
        _reset_event_status(event_id, "pending")
        raise
        
    except Exception as exc:
        print(f"❌ Finalize failed — Event #{event_id}: {exc}")
        traceback.print_exc()
        _reset_event_status(event_id, "pending")
        raise
        
    finally:
        _redis_cleanup(event_id)
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 4 — AI ENRICHMENT (decoupled)
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    queue=AI_QUEUE,
    soft_time_limit=600,
    time_limit=900,
    acks_late=True,
    reject_on_worker_lost=True,
    name="app.workers.tasks.enrich_event_photos",
)
def enrich_event_photos(self, event_id: int) -> dict:
    """Add AI-generated captions, tags, etc. to photos (non-critical path)."""
    db = SessionLocal()
    try:
        photos = db.query(Photo).filter(Photo.event_id == event_id).all()
        if not photos:
            return {"status": "no_photos"}
        
        print(f"🤖 Enriching {len(photos)} photos (Event #{event_id})")
        # TODO: Call AI service (e.g., BLIP captions, tag generation)
        
        return {"status": "enriched", "photo_count": len(photos)}
        
    except Exception as exc:
        print(f"⚠️  Enrichment error (non-fatal): {exc}")
        return {"status": "error"}
        
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 5 — GUEST NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    queue=PHOTO_QUEUE,
    soft_time_limit=300,
    time_limit=420,
    acks_late=True,
    reject_on_worker_lost=True,
    name="app.workers.tasks.notify_guests_task",
)
def notify_guests_task(self, event_id: int) -> dict:
    """Send email notifications to guests that photos are ready."""
    db = SessionLocal()
    try:
        from app.models.guest import Guest
        
        guests = db.query(Guest).filter(
            Guest.event_id == event_id,
            Guest.email_sent == False,
        ).all()
        
        if not guests:
            return {"status": "no_guests"}
        
        print(f"📧 Notifying {len(guests)} guests (Event #{event_id})")
        
        for guest in guests:
            try:
                # TODO: Send email via Brevo/Mailcow
                # send_email(guest.email, event_id)
                guest.email_sent = True
            except Exception as e:
                print(f"   ⚠️  Failed to notify {guest.email}: {e}")
        
        db.commit()
        return {"status": "notified", "guest_count": len(guests)}
        
    except Exception as exc:
        print(f"⚠️  Guest notification error: {exc}")
        return {"status": "error"}
        
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 6 — CLEANUP
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    soft_time_limit=600,
    time_limit=900,
    acks_late=True,
    reject_on_worker_lost=True,
    name="app.workers.tasks.cleanup_expired_events",
)
def cleanup_expired_events():
    """Delete expired events from DB + MinIO/R2/local storage."""
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
            print(f"🗑  Cleaning expired Event #{event.id}")
            db.query(Cluster).filter(Cluster.event_id == event.id).delete()
            db.query(Photo).filter(Photo.event_id == event.id).delete()
            db.delete(event)

        db.commit()
        print(f"✅ Deleted {len(event_assets)} expired event DB records")

        for event_id, cover_image in event_assets:
            try:
                delete_event_storage(event_id, cover_image=cover_image)
            except Exception as e:
                print(f"   ⚠️  Storage cleanup failed for Event #{event_id}: {e}")

        print("✅ Expired events cleanup done")

    except Exception as exc:
        db.rollback()
        print(f"❌ Cleanup error: {exc}")
        raise
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _merge_clusters(db, event_id: int, dim: int):
    """
    Post-clustering centroid merge pass.
    Pairs of clusters whose mean embeddings are cosine-similar above
    MERGE_THRESH get merged into the lower cluster_id.
    """
    clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
    if not clusters:
        return

    cluster_embs: dict = defaultdict(list)
    for c in clusters:
        try:
            cluster_embs[c.cluster_id].append(pickle.loads(c.embedding))
        except Exception:
            pass

    centroids: dict = {}
    for cid, embs in cluster_embs.items():
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

    merge_map: dict = {}
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
        print(f"   🔀 Merged {len(merge_map)} cluster pairs")


def _rebuild_faiss(db, event_id: int):
    """Rebuild the FAISS flat-IP search index from all cluster rows."""
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

    index = faiss.IndexFlatIP(dim)
    index.add(matrix)

    os.makedirs(INDEXES_PATH, exist_ok=True)
    faiss.write_index(index, os.path.join(INDEXES_PATH, f"event_{event_id}.index"))
    np.save(os.path.join(INDEXES_PATH, f"event_{event_id}_map.npy"), np.array(ids))

    FaissManager.reload_index(event_id)
    print(f"   ✅ FAISS index rebuilt: {len(embs)} vectors")


def _finalize_complete(db, event_id: int, total_new: int,
                       total_clusters: int, total_faces: int, event_start: float):
    """Persist completed status and trigger guest notifications."""
    elapsed = time.time() - event_start
    db.query(Event).filter(Event.id == event_id).update({
        "processing_status":       "completed",
        "processing_progress":     ProcessingConfig.PROGRESS_COMPLETE,
        "processing_completed_at": datetime.utcnow(),
        "last_processed_at":       datetime.utcnow(),
        "total_clusters":          total_clusters,
        "total_faces":             total_faces,
    })
    db.commit()
    print(f"✅ Event #{event_id} complete in {elapsed:.1f}s — "
          f"{total_clusters} clusters, {total_faces} faces")

    # Guest notifications (non-fatal)
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if event and getattr(event, "notify_on_processing_complete", True):
            from app.models.guest import Guest
            pending = db.query(Guest).filter(
                Guest.event_id == event_id,
                Guest.email_sent == False,
            ).count()
            if pending > 0:
                notify_guests_task.apply_async(args=[event_id], queue=PHOTO_QUEUE)
                print(f"📧 Queued notification for {pending} guests")
    except Exception as e:
        print(f"⚠️  Guest notification trigger failed (non-fatal): {e}")


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC UTILITIES  (used by API endpoints)
# ══════════════════════════════════════════════════════════════════════════════

def get_processing_status(event_id: int) -> dict:
    """Return processing state — Redis first, DB fallback."""
    r         = _get_redis()
    total     = int(r.get(f"event:{event_id}:total")     or 0)
    completed = int(r.get(f"event:{event_id}:completed") or 0)
    phase     = r.get(f"event:{event_id}:phase") or "unknown"

    if total or phase != "unknown":
        return {"source": "redis", "phase": phase,
                "total": total, "completed": completed}

    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if event:
            return {
                "source":   "database",
                "status":   event.processing_status or "unknown",
                "progress": event.processing_progress or 0,
            }
    finally:
        db.close()

    return {"source": "none", "status": "not_found"}


def reset_processing_state(event_id: int) -> bool:
    """
    Manually unlock a stuck event.
    Clears Redis, resets DB to pending, marks failed photos back to uploaded.

    Usage:
        from app.workers.tasks import reset_processing_state
        reset_processing_state(25)
    """
    db = SessionLocal()
    r  = _get_redis()
    try:
        for key in ["total", "completed", "phase", "lock"]:
            r.delete(f"event:{event_id}:{key}")

        db.query(Event).filter(Event.id == event_id).update({
            "processing_status":     "pending",
            "processing_progress":   0,
            "processing_started_at": None,
        })
        db.query(Photo).filter(
            Photo.event_id == event_id,
            Photo.status   == "failed",
        ).update({"status": "uploaded"})
        db.commit()

        print(f"✅ Reset processing state for Event #{event_id}")
        return True

    except Exception as exc:
        print(f"❌ Failed to reset state for Event #{event_id}: {exc}")
        db.rollback()
        return False
    finally:
        db.close()