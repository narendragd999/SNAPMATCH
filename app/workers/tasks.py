"""
app/workers/tasks.py — Celery task pipeline for SnapFind photo processing.

Pipeline:
  process_event (orchestrator)
      └─► [chord] process_single_photo × N  (fan-out)
              └─► finalize_event            (chord callback, runs once all photos done)
                      └─► enrich_event_photos  (AI enrichment, async)
                      └─► notify_guests_task   (guest email notifications, async)

Key features preserved from both versions:
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

        # ── Dispatch chord ────────────────────────────────────────────────────
        tasks = chord(
            [process_single_photo.s(photo.id, photo.stored_filename, event_id)
             for photo in photos],
            finalize_event.s(event_id),
        )
        tasks.apply_async()

        elapsed = round(time.time() - start, 2)
        print(f"\n✅ DISPATCH COMPLETE in {elapsed}s — {total} photos")

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
def process_single_photo(self, photo_id: int, raw_filename: str, event_id: int) -> dict:
    """
    Full per-photo pipeline:
      1. image_pipeline.process_image()
           downloads raw → optimizes → generates thumbnail → deletes raw
           returns (optimized_filename, face_np)
      2. face_service.process_single_image(event_id, optimized_name, face_np)
           InsightFace on in-memory face_np — no disk read
           returns list of (filename, normalized_embedding) tuples
      3. Serialize embeddings as base64(pickle(ndarray)) for Celery transport
      4. Increment Redis completed counter
    """
    t_start = time.time()
    print(f"\n📸 Photo #{photo_id} — {raw_filename} (Event #{event_id})")

    try:
        # ── Step 1: Image pipeline ─────────────────────────────────────────────
        optimized_name, face_np = process_image(raw_filename, event_id)

        if not optimized_name:
            print(f"   ❌ Image pipeline failed for #{photo_id}")
            return _photo_result(photo_id, "pipeline_failed")

        t_opt = time.time() - t_start
        print(f"   ✅ Optimized in {t_opt:.2f}s → {optimized_name}")

        # ── Step 2: Face detection ─────────────────────────────────────────────
        print(f"   🔍 Running face detection…")
        face_results = process_single_image(event_id, optimized_name, face_np)

        # ── Step 3: Serialize ─────────────────────────────────────────────────
        serialised_faces = []
        for _filename, emb in face_results:
            serialised_faces.append({
                "image_name":    optimized_name,
                "embedding_b64": base64.b64encode(pickle.dumps(emb)).decode(),
            })

        # ── Step 4: Redis progress ────────────────────────────────────────────
        r = _get_redis()
        r.incr(f"event:{event_id}:completed")
        r.expire(f"event:{event_id}:completed", ProcessingConfig.REDIS_TTL)

        t_total = time.time() - t_start
        faces   = len(serialised_faces)
        print(f"   ✅ Done in {t_total:.2f}s — {faces} face(s) detected")

        return _photo_result(photo_id, "ok", optimized_name, serialised_faces, t_opt, t_total)

    except SoftTimeLimitExceeded:
        print(f"   ⏰ Photo #{photo_id} timed out after {time.time() - t_start:.1f}s")
        return _photo_result(photo_id, "timeout")

    except Exception as exc:
        print(f"   ❌ Photo #{photo_id} failed: {exc}")
        traceback.print_exc()
        return _photo_result(photo_id, "error")


# ══════════════════════════════════════════════════════════════════════════════
# TASK 3 — FINALIZER  (chord callback)
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
    Chord callback — runs once ALL process_single_photo tasks complete.

    Idempotency guard: exits immediately if event already finalized.
    Safety-net results (status='safety_net') are filtered out.
    """
    db          = SessionLocal()
    event_start = time.time()
    r           = _get_redis()

    print(f"\n{'='*70}")
    print(f"🏁 FINALIZE — Event #{event_id}")
    print(f"{'='*70}")

    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return {"status": "event_not_found"}

        # ── Idempotency guard ─────────────────────────────────────────────────
        if event.processing_status in ("completed", "completed_with_errors", "failed"):
            print(f"ℹ️  Already finalized ({event.processing_status}) — skipping")
            return {"status": "already_finalized"}

        # Filter out safety-net placeholders
        real_results = [res for res in photo_results if res.get("status") != "safety_net"]
        if not real_results:
            print("ℹ️  Only safety-net results — real chord not done yet, exiting")
            return {"status": "safety_net_skipped"}

        # ── Phase: clustering ─────────────────────────────────────────────────
        _redis_set(event_id, "phase", "clustering")
        _db_update_event(db, event_id,
                         processing_progress=ProcessingConfig.PROGRESS_CLUSTERING)

        total_new       = len(real_results)
        total_optimized = sum(1 for r in real_results if r["status"] == "ok")
        print(f"📊 Results: {total_optimized}/{total_new} succeeded")

        # ── Bulk update photo rows ────────────────────────────────────────────
        _bulk_update_photos(db, real_results)

        # ── Deserialize embeddings ────────────────────────────────────────────
        new_faces: list = []   # (image_name, embedding_ndarray, photo_id)
        for res in real_results:
            if res["status"] != "ok":
                continue
            for f in res.get("faces", []):
                try:
                    emb = pickle.loads(base64.b64decode(f["embedding_b64"]))
                    new_faces.append((f["image_name"], emb, res["photo_id"]))
                except Exception as de:
                    print(f"   ⚠️  Embedding deserialize error: {de}")

        total_faces = len(new_faces)
        print(f"📸 {total_optimized}/{total_new} optimized  |  {total_faces} faces")

        if not new_faces:
            print("ℹ️  No faces — marking completed with 0 clusters")
            _redis_set(event_id, "phase", "done")
            _finalize_complete(db, event_id, total_new, 0, 0, event_start)
            _redis_cleanup(event_id)
            _release_lock(event_id)
            return {"status": "completed_no_faces"}

        # ── Incremental FAISS clustering ──────────────────────────────────────
        _db_update_event(db, event_id, processing_progress=78)
        os.makedirs(INDEXES_PATH, exist_ok=True)

        existing_clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
        dim           = len(new_faces[0][1])
        cluster_index = faiss.IndexFlatIP(dim)
        cluster_map: list = []
        current_cluster   = 0

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

        new_cluster_rows: list = []
        for image_name, emb, photo_id in new_faces:
            emb_norm = emb.astype("float32")
            faiss.normalize_L2(emb_norm.reshape(1, -1))

            assigned = current_cluster
            if cluster_index.ntotal > 0:
                D, I = cluster_index.search(
                    emb_norm.reshape(1, -1), min(3, cluster_index.ntotal)
                )
                for score, idx in zip(D[0], I[0]):
                    if idx >= 0 and score >= THRESHOLD:
                        assigned = cluster_map[idx]
                        break

            if assigned == current_cluster:
                cluster_index.add(emb_norm.reshape(1, -1))
                cluster_map.append(current_cluster)
                current_cluster += 1

            new_cluster_rows.append(Cluster(
                event_id   = event_id,
                cluster_id = assigned,       # ✅ integer — no more string error
                image_name = image_name,
                embedding  = pickle.dumps(emb),
            ))

        _db_update_event(db, event_id, processing_progress=83)
        db.bulk_save_objects(new_cluster_rows)
        db.commit()

        # ── Phase: building index ─────────────────────────────────────────────
        _redis_set(event_id, "phase", "building_index")
        _db_update_event(db, event_id,
                         processing_progress=ProcessingConfig.PROGRESS_INDEXING)

        _merge_clusters(db, event_id, dim)
        _rebuild_faiss(db, event_id)

        total_clusters = (
            db.query(Cluster.cluster_id)
            .filter(Cluster.event_id == event_id)
            .distinct()
            .count()
        )

        # ── Phase: enriching → done ───────────────────────────────────────────
        _redis_set(event_id, "phase", "enriching")
        _finalize_complete(db, event_id, total_new, total_clusters, total_faces, event_start)

        enrich_event_photos.apply_async(args=[event_id], queue=AI_QUEUE)

        _redis_set(event_id, "phase", "done", ttl=ProcessingConfig.REDIS_TTL_DONE)
        _redis_cleanup(event_id)
        _release_lock(event_id)

        print(f"\n🎉 DONE — {total_clusters} clusters, {total_faces} faces")
        return {
            "status":         "completed",
            "total_clusters": total_clusters,
            "total_faces":    total_faces,
        }

    except SoftTimeLimitExceeded:
        _redis_set(event_id, "phase", "failed")
        print(f"⏰ Finalize time limit — Event #{event_id}")
        try:
            _db_update_event(db, event_id, processing_status="failed")
        except Exception:
            pass
        _release_lock(event_id)
        raise

    except Exception as exc:
        _redis_set(event_id, "phase", "failed")
        print(f"❌ finalize_event failed: {exc}")
        traceback.print_exc()
        try:
            _db_update_event(db, event_id, processing_status="failed")
        except Exception:
            pass
        _release_lock(event_id)
        raise

    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 4 — AI ENRICHMENT
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    bind=True,
    queue=AI_QUEUE,
    acks_late=True,
    name="app.workers.tasks.enrich_event_photos",
)
def enrich_event_photos(self, event_id: int):
    """Delegate to ai_enrichment_task for Places365 + YOLOv8 labels."""
    try:
        from app.workers.ai_enrichment_task import ai_enrich_event
        ai_enrich_event.apply_async(args=[event_id], queue=AI_QUEUE)
    except Exception as e:
        print(f"⚠️  AI enrichment dispatch failed (non-fatal): {e}")


# ══════════════════════════════════════════════════════════════════════════════
# TASK 5 — GUEST NOTIFICATIONS
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(
    name="app.workers.tasks.notify_guests_task",
    acks_late=True,
)
def notify_guests_task(event_id: int):
    """
    Send 'Photos Ready' emails to all unnotified guests.
    Graceful — does nothing if no guests or notifications disabled.
    """
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return {"status": "event_not_found"}

        from app.models.guest import Guest
        guests = db.query(Guest).filter(
            Guest.event_id == event_id,
            Guest.email_sent == False,
        ).all()

        if not guests:
            return {"status": "no_guests_to_notify"}

        from app.models.user import User
        owner = db.query(User).filter(User.id == event.owner_id).first()
        photographer_name = (owner.name or owner.email) if owner else "the photographer"

        base_url  = os.getenv("FRONTEND_URL", "https://snapmatch.com")
        event_url = f"{base_url}/public/{event.public_token}"

        from app.api.guest_routes import send_bulk_photos_ready_emails
        emails  = [g.email for g in guests]
        results = send_bulk_photos_ready_emails(
            emails            = emails,
            event_name        = event.name,
            photo_count       = event.image_count or 0,
            event_url         = event_url,
            photographer_name = photographer_name,
            db                = db,
        )

        for guest in guests:
            if results["sent"] > 0:
                guest.mark_email_sent()

        if results["sent"] > 0:
            event.record_notification_sent()

        db.commit()
        print(f"📧 Sent {results['sent']} notifications for Event #{event_id}")
        return {"status": "success", "sent": results["sent"], "failed": results["failed"]}

    except Exception as exc:
        print(f"❌ notify_guests_task failed: {exc}")
        traceback.print_exc()
        return {"status": "error", "message": str(exc)}
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════════
# TASK 6 — CLEANUP EXPIRED EVENTS  (Celery Beat — daily)
# ══════════════════════════════════════════════════════════════════════════════

@celery.task(name="app.workers.tasks.cleanup_expired_events")
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