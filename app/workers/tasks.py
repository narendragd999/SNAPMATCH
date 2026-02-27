"""
workers/tasks.py — True parallel photo processing via Celery task fan-out.

ARCHITECTURE:
  process_event(event_id)                   ← orchestrator
    ├── dispatch N × process_single_photo() ← one Celery task per photo (parallel)
    ├── chord callback → finalize_event()   ← runs AFTER all photos finish
    │     ├── incremental clustering
    │     ├── post-clustering merge pass
    │     └── FAISS rebuild (once per event)
    └── AI enrichment queued

═══════════════════════════════════════════════════════════════
DB CONTENTION FIXES (v4) — why the event page froze
═══════════════════════════════════════════════════════════════

ROOT CAUSE:
  232 photo tasks × 1 DB commit each = 232 concurrent UPDATE queries on
  the photos table + 232 UPDATE queries on the events table (progress).
  While those write locks were held, the API's SELECT queries for the
  event page (cluster counts, face counts, photo list) had to wait.
  On a single machine with CPU-heavy Celery workers, this caused the
  browser to time out.

FIXES APPLIED:

  FIX A — Progress updates via Redis only (no DB writes per photo)
    process_single_photo NO LONGER writes processing_progress to DB.
    Progress is tracked entirely in Redis. The API reads progress from
    Redis directly (add a /api/events/{id}/progress endpoint that reads
    the Redis counter). DB is only written at phase boundaries in
    finalize_event — 5 writes total instead of 232+.

  FIX B — Photo status batched in finalize_event
    process_single_photo NO LONGER commits photo.status per photo.
    It returns the result dict (already the case) and finalize_event
    does ONE bulk UPDATE for all photos at the start, using a single
    executemany / bulk update — 1 write instead of 232.

  FIX C — Cluster rows inserted in one bulk INSERT
    db.add_all() + single db.commit() was already correct but now
    uses bulk_insert_mappings for maximum throughput.

  FIX D — Event progress written only at phase boundaries (5 total)
    Removed the per-photo _db_update_event() call entirely.
    finalize_event writes progress at: 73%, 83%, 88%, 92%, 96%, 100%.

  FIX E — PostgreSQL connection pool tuned
    Workers use NullPool so each task gets its own short-lived connection
    and releases it immediately. No idle connections held between tasks.

PREVIOUS WRITE PATTERN (232 photos):
  232 × photo UPDATE  (status, optimized_filename, faces_detected ...)
  232 × event UPDATE  (processing_progress)
  135 × cluster INSERT
  = ~600 DB round-trips during processing, holding write locks

NEW WRITE PATTERN:
  1  × event UPDATE   (status=processing, progress=5)       ← process_event
  1  × bulk photo UPDATE  (all 232 in one statement)        ← finalize_event start
  5  × event UPDATE   (progress milestones)                 ← finalize_event
  1  × bulk cluster INSERT (all N rows)                     ← finalize_event
  1  × cluster UPDATE  (merge pass, if needed)              ← finalize_event
  1  × event UPDATE   (status=completed, progress=100)      ← finalize_event
  = ~10 DB round-trips total, all in finalize_event (no parallelism)

QUEUES:
  photo_processing  — high concurrency (prefork, 2 workers per container)
  event_finalize    — concurrency=1, pool=solo (clustering must never overlap)
  ai_enrichment     — existing queue, unchanged
"""

from __future__ import annotations

import os
import pickle
import shutil
import time
from datetime import datetime

import faiss
import numpy as np
from billiard.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from app.core.config import INDEXES_PATH, STORAGE_PATH
from app.database.db import SessionLocal
from app.models.cluster import Cluster
from app.models.event import Event
from app.models.photo import Photo
from app.services.faiss_manager import FaissManager

# ── Module-level imports — model loads ONCE at worker startup ─────────────────
from app.services.face_service import process_single_image
from app.services.image_pipeline import process_raw_image

from app.workers.celery_worker import celery

# ─────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────

CLUSTER_THRESHOLD  = 0.68
MERGE_THRESHOLD    = 0.72
PROGRESS_QUEUE     = "photo_processing"
FINALIZE_QUEUE     = "event_finalize"

# How many photos to accumulate before doing a bulk photo-status UPDATE.
# finalize_event does this once at the start — this constant is kept for
# reference and potential future chunking on very large events (5000+).
PHOTO_BULK_CHUNK   = 500


# ─────────────────────────────────────────────────────────────
# REDIS HELPERS  (all progress lives here, not in DB)
# ─────────────────────────────────────────────────────────────

def _redis():
    return celery.backend.client

def _key_done(event_id):    return f"event:{event_id}:photos_done"
def _key_total(event_id):   return f"event:{event_id}:photos_total"
def _key_lock(event_id):    return f"event:{event_id}:processing_lock"

def _redis_set_total(event_id: int, total: int):
    _redis().set(_key_total(event_id), total, ex=3600)

def _redis_increment_done(event_id: int) -> int:
    return _redis().incr(_key_done(event_id))

def _redis_get_progress(event_id: int) -> dict:
    """Called by API progress endpoint — zero DB queries needed."""
    r = _redis()
    done  = int(r.get(_key_done(event_id))  or 0)
    total = int(r.get(_key_total(event_id)) or 0)
    pct   = 5 + int((done / total) * 67) if total > 0 else 5
    return {"done": done, "total": total, "progress": min(pct, 72)}

def _redis_cleanup(event_id: int):
    r = _redis()
    r.delete(_key_done(event_id))
    r.delete(_key_total(event_id))

def _acquire_lock(event_id: int, ttl: int = 1800) -> bool:
    return bool(_redis().set(_key_lock(event_id), "1", nx=True, ex=ttl))

def _release_lock(event_id: int):
    _redis().delete(_key_lock(event_id))


# ─────────────────────────────────────────────────────────────
# DB HELPERS
# ─────────────────────────────────────────────────────────────

def _db_update_event(db, event_id: int, **fields):
    """
    Single-row UPDATE — no expire_all(), no re-fetch.
    Used only at phase boundaries (≤6 times per event total).
    """
    db.query(Event).filter(Event.id == event_id).update(
        fields, synchronize_session="fetch"
    )
    db.commit()


def _refresh_event(db, event_id: int) -> Event:
    db.expire_all()
    return db.query(Event).filter(Event.id == event_id).first()


def _bulk_update_photos(db, results: list[dict]):
    """
    FIX B: One bulk UPDATE for all photo statuses instead of 232 individual
    commits. Uses raw SQL executemany for minimal lock time.

    Builds two groups:
      - processed: set all fields for successfully processed photos
      - skipped:   set status=skipped for missing/corrupt/timeout/error photos
    """
    if not results:
        return

    now = datetime.utcnow()

    processed = [
        {
            "id":                 r["photo_id"],
            "status":             "processed",
            "optimized_filename": r["optimized_name"],
            "faces_detected":     len(r["faces"]),
            "optimized_at":       now,
            "processed_at":       now,
        }
        for r in results if r["status"] == "ok"
    ]

    skipped = [
        {"id": r["photo_id"], "processed_at": now}
        for r in results if r["status"] != "ok"
    ]

    if processed:
        db.execute(
            text("""
                UPDATE photos SET
                    status = :status,
                    optimized_filename = :optimized_filename,
                    faces_detected = :faces_detected,
                    optimized_at = :optimized_at,
                    processed_at = :processed_at
                WHERE id = :id
            """),
            processed,
        )

    if skipped:
        db.execute(
            text("""
                UPDATE photos SET
                    status = 'skipped',
                    processed_at = :processed_at
                WHERE id = :id
            """),
            skipped,
        )

    db.commit()


# ─────────────────────────────────────────────────────────────
# TASK 1 — ORCHESTRATOR
# ─────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=PROGRESS_QUEUE)
def process_event(self, event_id: int):
    """
    Entry point. Fetches unprocessed photos, fans them out as individual
    Celery tasks, wires a chord so finalize_event() runs exactly once
    after every photo task completes (success or failure).

    Flow:
        process_event(event_id)
          └─ chord([process_single_photo(photo_id) × N])
                └─ finalize_event(results, event_id)
    """
    from celery import chord as celery_chord

    # Idempotency lock — prevents duplicate chord dispatch
    if not _acquire_lock(event_id):
        print(f"⚠ Event {event_id} already processing — blocked duplicate")
        return {"status": "already_processing"}

    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            _release_lock(event_id)
            return {"status": "event_not_found"}

        _db_update_event(
            db, event_id,
            processing_status="processing",
            processing_started_at=datetime.utcnow(),
            processing_progress=5,
        )

        unprocessed = (
            db.query(Photo)
            .filter(
                Photo.event_id == event_id,
                Photo.status == "uploaded",
                Photo.approval_status == "approved",
            )
            .all()
        )
        photo_ids = [p.id for p in unprocessed]
        total = len(photo_ids)

        print(f"\n📋 EVENT {event_id}: {total} new photos to process")

        if total == 0:
            _db_update_event(
                db, event_id,
                processing_status="completed",
                processing_progress=100,
                processing_completed_at=datetime.utcnow(),
            )
            _release_lock(event_id)
            return {"status": "no_new_photos"}

        # Store total in Redis for progress API
        _redis_cleanup(event_id)
        _redis_set_total(event_id, total)

        header = [
            process_single_photo.s(photo_id, event_id, total)
            for photo_id in photo_ids
        ]
        callback = finalize_event.s(event_id).set(queue=FINALIZE_QUEUE)
        job = celery_chord(header)(callback)

        print(f"🚀 Dispatched chord: {total} photo tasks → finalize_event")
        return {"status": "dispatched", "total_photos": total, "chord_id": job.id}

    except Exception as exc:
        db.rollback()
        _release_lock(event_id)
        try:
            _db_update_event(db, event_id,
                             processing_status="failed", processing_progress=0)
        except Exception:
            pass
        raise exc
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────
# TASK 2 — PER-PHOTO WORKER  (runs in parallel)
# ─────────────────────────────────────────────────────────────

@celery.task(
    bind=True,
    queue=PROGRESS_QUEUE,
    max_retries=0,
    acks_late=True,
)
def process_single_photo(self, photo_id: int, event_id: int, total: int):
    """
    Optimize + face-detect ONE photo.

    FIX A + FIX B:
      - NO DB writes for photo status (done in bulk in finalize_event)
      - NO DB writes for event progress (Redis counter only)
      - Only reads photo.stored_filename from DB, then closes connection

    Returns a plain dict — no ORM objects, no numpy arrays.
    Embeddings are pickled → base64 for Celery result backend transport.

    Result schema:
        {
            "photo_id":       int,
            "status":         "ok" | "missing" | "corrupt" | "timeout" | "error",
            "optimized_name": str | None,
            "faces": [{"image_name": str, "embedding_b64": str}],
            "t_opt":   float,
            "t_total": float,
        }
    """
    import base64

    t_start = time.time()

    # ── Minimal DB read — get filename then close connection immediately ──
    db = SessionLocal()
    try:
        photo = db.query(Photo).filter(Photo.id == photo_id).first()
        if not photo:
            return _photo_result(photo_id, "missing")
        stored_filename = photo.stored_filename
    finally:
        db.close()   # ← release connection before any CPU-heavy work

    folder   = os.path.join(STORAGE_PATH, str(event_id))
    raw_path = os.path.join(folder, stored_filename)

    if not os.path.exists(raw_path):
        return _photo_result(photo_id, "missing")

    try:
        # ── Optimize ─────────────────────────────────────────────────────
        optimized_name, face_np = process_raw_image(raw_path, folder)
        if not optimized_name:
            return _photo_result(photo_id, "corrupt")

        t_opt = time.time() - t_start

        try:
            os.remove(raw_path)
        except Exception:
            pass

        # ── Face detect + embed ───────────────────────────────────────────
        faces = process_single_image(event_id, optimized_name, face_np=face_np)
        t_total = time.time() - t_start

        # ── Progress: Redis only, zero DB writes ──────────────────────────
        done = _redis_increment_done(event_id)

        # ── Serialise embeddings ──────────────────────────────────────────
        serialised_faces = [
            {
                "image_name":    img_name,
                "embedding_b64": base64.b64encode(pickle.dumps(emb)).decode(),
            }
            for img_name, emb in faces
        ]

        print(
            f"✅ {done}/{total}: {len(faces)} face(s) | "
            f"opt={t_opt:.2f}s total={t_total:.2f}s — {optimized_name}"
        )

        return _photo_result(
            photo_id, "ok",
            optimized_name=optimized_name,
            faces=serialised_faces,
            t_opt=t_opt,
            t_total=t_total,
        )

    except SoftTimeLimitExceeded:
        print(f"⏱ Soft time limit — photo {photo_id} skipped")
        return _photo_result(photo_id, "timeout")

    except Exception as exc:
        print(f"❌ Photo {photo_id} failed: {exc}")
        import traceback; traceback.print_exc()
        return _photo_result(photo_id, "error")


def _photo_result(
    photo_id: int,
    status: str,
    optimized_name: str | None = None,
    faces: list | None = None,
    t_opt: float = 0.0,
    t_total: float = 0.0,
) -> dict:
    return {
        "photo_id":       photo_id,
        "status":         status,
        "optimized_name": optimized_name,
        "faces":          faces or [],
        "t_opt":          t_opt,
        "t_total":        t_total,
    }


# ─────────────────────────────────────────────────────────────
# TASK 3 — FINALIZER  (runs once, after all photo tasks done)
# ─────────────────────────────────────────────────────────────

@celery.task(bind=True, queue=FINALIZE_QUEUE)
def finalize_event(self, photo_results: list[dict], event_id: int):
    """
    Chord callback — receives the list of all photo task results.

    ALL DB writes happen here, sequentially, with no parallel contention:
      1.  Bulk UPDATE photos (one statement, all 232 rows)
      2.  Incremental clustering (pure Python + FAISS, no DB)
      3.  Bulk INSERT cluster rows (one statement)
      4.  Post-clustering merge pass
      5.  Rebuild FAISS search index
      6.  Final event UPDATE (status=completed)
      7.  Queue AI enrichment
      8.  Redis cleanup + lock release
    """
    import base64

    db = SessionLocal()
    event_start = time.time()

    try:
        # ── Progress milestone 1 ──────────────────────────────────────────
        _db_update_event(db, event_id, processing_progress=73)

        total_new       = len(photo_results)
        total_optimized = sum(1 for r in photo_results if r["status"] == "ok")

        # ── FIX B: Bulk UPDATE all photo statuses in one statement ────────
        print(f"💾 Bulk updating {total_new} photo statuses...")
        _bulk_update_photos(db, photo_results)

        # ── Deserialise face embeddings ───────────────────────────────────
        new_faces: list[tuple[str, np.ndarray, int]] = []
        for r in photo_results:
            if r["status"] != "ok":
                continue
            for f in r["faces"]:
                emb = pickle.loads(base64.b64decode(f["embedding_b64"]))
                new_faces.append((f["image_name"], emb, r["photo_id"]))

        print(
            f"\n📸 Pipeline done: {total_optimized}/{total_new} optimized, "
            f"{len(new_faces)} face embeddings"
        )

        if not new_faces:
            _finalize_complete(db, event_id, total_new, 0, event_start)
            _redis_cleanup(event_id)
            _release_lock(event_id)
            return {"status": "completed_no_new_faces"}

        # ── CLUSTERING: pure Python + FAISS, zero DB reads ────────────────
        _db_update_event(db, event_id, processing_progress=75)

        os.makedirs(INDEXES_PATH, exist_ok=True)
        cluster_index_path = os.path.join(INDEXES_PATH, f"event_{event_id}_cluster.index")
        cluster_map_path   = os.path.join(INDEXES_PATH, f"event_{event_id}_cluster_map.npy")

        existing_clusters = (
            db.query(Cluster).filter(Cluster.event_id == event_id).all()
        )

        dim             = len(new_faces[0][1])
        cluster_index   = faiss.IndexFlatIP(dim)
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
                seed_mat = np.array(seed_embs).astype("float32")
                faiss.normalize_L2(seed_mat)
                cluster_index.add(seed_mat)
                current_cluster = max(cluster_map) + 1
            print(
                f"🔄 Cluster index rebuilt from DB: "
                f"{len(seed_embs)} faces, {current_cluster} clusters so far"
            )
        else:
            print(f"🆕 Fresh cluster index (dim={dim})")

        new_cluster_assignments: list[int] = []

        for (image_name, emb, photo_id) in new_faces:
            try:
                emb_np = np.array([emb]).astype("float32")
                faiss.normalize_L2(emb_np)

                if cluster_index.ntotal == 0:
                    cluster_index.add(emb_np)
                    cluster_map.append(current_cluster)
                    new_cluster_assignments.append(current_cluster)
                    current_cluster += 1
                    continue

                k = min(5, cluster_index.ntotal)
                D, I = cluster_index.search(emb_np, k)

                if float(D[0][0]) >= CLUSTER_THRESHOLD:
                    assigned = cluster_map[int(I[0][0])]
                    new_cluster_assignments.append(assigned)
                    cluster_index.add(emb_np)
                    cluster_map.append(assigned)
                else:
                    cluster_index.add(emb_np)
                    cluster_map.append(current_cluster)
                    new_cluster_assignments.append(current_cluster)
                    current_cluster += 1

            except Exception as e:
                print(f"❌ Clustering error: {e}")
                new_cluster_assignments.append(current_cluster)
                current_cluster += 1

        faiss.write_index(cluster_index, cluster_index_path)
        np.save(cluster_map_path, np.array(cluster_map))

        _db_update_event(db, event_id, processing_progress=83)

        # ── FIX C: Bulk INSERT all cluster rows in one statement ──────────
        if new_cluster_assignments:
            cluster_mappings = [
                {
                    "event_id":   event_id,
                    "cluster_id": int(cluster_id),
                    "image_name": image_name,
                    "embedding":  pickle.dumps(embedding),
                }
                for (image_name, embedding, photo_id), cluster_id
                in zip(new_faces, new_cluster_assignments)
            ]
            db.bulk_insert_mappings(Cluster, cluster_mappings)
            db.commit()
            print(f"💾 Bulk inserted {len(cluster_mappings)} cluster rows")

        _db_update_event(db, event_id, processing_progress=88)

        # ── POST-CLUSTERING MERGE PASS ────────────────────────────────────
        try:
            all_cluster_rows = (
                db.query(Cluster).filter(Cluster.event_id == event_id).all()
            )

            cid_to_embs: dict[int, list] = {}
            for row in all_cluster_rows:
                try:
                    cid_to_embs.setdefault(
                        int(row.cluster_id), []
                    ).append(pickle.loads(row.embedding))
                except Exception:
                    pass

            unique_cids = sorted(cid_to_embs.keys())
            n_clusters  = len(unique_cids)

            if n_clusters >= 2:
                representatives = {
                    cid: _mean_normalized(cid_to_embs[cid])
                    for cid in unique_cids
                }
                mat = np.stack([representatives[c] for c in unique_cids])
                sim = mat @ mat.T

                parent = {cid: cid for cid in unique_cids}

                def _find(x: int) -> int:
                    while parent[x] != x:
                        parent[x] = parent[parent[x]]
                        x = parent[x]
                    return x

                merge_pairs = 0
                for i in range(n_clusters):
                    for j in range(i + 1, n_clusters):
                        if sim[i, j] >= MERGE_THRESHOLD:
                            ri, rj = _find(unique_cids[i]), _find(unique_cids[j])
                            if ri != rj:
                                parent[max(ri, rj)] = min(ri, rj)
                                merge_pairs += 1

                merges_applied = 0
                if merge_pairs > 0:
                    for cid in unique_cids:
                        root = _find(cid)
                        if root != cid:
                            db.query(Cluster).filter(
                                Cluster.event_id == event_id,
                                Cluster.cluster_id == cid,
                            ).update({"cluster_id": root}, synchronize_session=False)
                            merges_applied += 1

                    db.flush()

                    seen_keys: set[tuple[int, str]] = set()
                    dupe_ids: list[int] = []
                    for row in db.query(Cluster).filter(
                        Cluster.event_id == event_id
                    ).all():
                        key = (int(row.cluster_id), str(row.image_name))
                        if key in seen_keys:
                            dupe_ids.append(row.id)
                        else:
                            seen_keys.add(key)

                    if dupe_ids:
                        db.query(Cluster).filter(
                            Cluster.id.in_(dupe_ids)
                        ).delete(synchronize_session=False)

                    db.commit()
                    print(
                        f"🔀 Merge pass: {merge_pairs} pair(s) merged → "
                        f"{merges_applied} absorbed, {len(dupe_ids)} dupes removed"
                    )
                else:
                    print(f"✅ Merge pass: no near-duplicates (threshold={MERGE_THRESHOLD})")

        except Exception as e:
            db.rollback()
            print(f"⚠ Merge pass error (non-fatal): {e}")
            import traceback; traceback.print_exc()

        _db_update_event(db, event_id, processing_progress=92)

        # ── REBUILD FAISS SEARCH INDEX ────────────────────────────────────
        try:
            all_clusters = db.query(Cluster).filter(
                Cluster.event_id == event_id
            ).all()

            all_embeddings, all_ids = [], []
            for c in all_clusters:
                try:
                    all_embeddings.append(pickle.loads(c.embedding))
                    all_ids.append(c.id)
                except Exception as e:
                    print(f"⚠ Skipping cluster {c.id}: {e}")

            search_index_path = os.path.join(INDEXES_PATH, f"event_{event_id}.index")
            search_map_path   = os.path.join(INDEXES_PATH, f"event_{event_id}_map.npy")

            if all_embeddings:
                emb_matrix  = np.array(all_embeddings).astype("float32")
                faiss.normalize_L2(emb_matrix)
                fresh_index = faiss.IndexFlatIP(len(all_embeddings[0]))
                fresh_index.add(emb_matrix)
                faiss.write_index(fresh_index, search_index_path)
                np.save(search_map_path, np.array(all_ids))
                print(
                    f"🔍 FAISS rebuilt: {fresh_index.ntotal} vectors, "
                    f"{len(all_ids)} id_map entries"
                )
            else:
                empty = faiss.IndexFlatIP(512)
                faiss.write_index(empty, search_index_path)
                np.save(search_map_path, np.array([], dtype=np.int64))
                print("⚠ No embeddings — empty FAISS index written")

            FaissManager.remove_index(event_id)

        except Exception as e:
            print(f"❌ FAISS rebuild error: {e}")
            import traceback; traceback.print_exc()

        _db_update_event(db, event_id, processing_progress=96)

        # ── FINAL STATUS ──────────────────────────────────────────────────
        total_faces = db.query(Cluster).filter(
            Cluster.event_id == event_id
        ).count()
        total_clusters = db.query(Cluster.cluster_id).filter(
            Cluster.event_id == event_id
        ).distinct().count()

        _finalize_complete(
            db, event_id, total_new, len(new_faces), event_start,
            total_faces=total_faces, total_clusters=total_clusters,
        )

        # ── AI ENRICHMENT ─────────────────────────────────────────────────
        try:
            from app.workers.ai_enrichment_task import ai_enrich_event
            ai_enrich_event.apply_async(
                args=[event_id], queue="ai_enrichment", countdown=2
            )
            print(f"🎨 AI enrichment queued for event {event_id}")
        except Exception as e:
            print(f"⚠ Failed to queue AI enrichment: {e}")

        # ── REDIS CLEANUP ─────────────────────────────────────────────────
        _redis_cleanup(event_id)
        _release_lock(event_id)

        return {
            "status":               "completed",
            "new_photos_processed": total_new,
            "new_faces_found":      len(new_faces),
            "total_faces":          total_faces,
            "total_clusters":       total_clusters,
        }

    except Exception as exc:
        db.rollback()
        try:
            _db_update_event(db, event_id,
                             processing_status="failed", processing_progress=0)
        except Exception:
            pass
        _release_lock(event_id)
        print(f"❌ FATAL error in finalize_event {event_id}: {exc}")
        import traceback; traceback.print_exc()
        raise exc
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────
# PRIVATE HELPERS
# ─────────────────────────────────────────────────────────────

def _mean_normalized(embs: list) -> np.ndarray:
    mean = np.mean(embs, axis=0).astype("float32")
    norm = np.linalg.norm(mean)
    return mean / norm if norm > 0 else mean


def _finalize_complete(
    db,
    event_id: int,
    total_new: int,
    new_faces_count: int,
    event_start: float,
    total_faces: int | None = None,
    total_clusters: int | None = None,
):
    if total_faces is None:
        total_faces = db.query(Cluster).filter(
            Cluster.event_id == event_id
        ).count()
    if total_clusters is None:
        total_clusters = db.query(Cluster.cluster_id).filter(
            Cluster.event_id == event_id
        ).distinct().count()

    event = _refresh_event(db, event_id)
    event.total_faces             = total_faces
    event.total_clusters          = total_clusters
    event.processing_status       = "completed"
    event.processing_progress     = 100
    event.processing_completed_at = datetime.utcnow()
    db.commit()

    elapsed = time.time() - event_start
    print(
        f"\n🚀 EVENT {event_id} COMPLETE"
        f"\n   New photos:     {total_new}"
        f"\n   New faces:      {new_faces_count}"
        f"\n   Total faces:    {total_faces}"
        f"\n   Total clusters: {total_clusters}"
        f"\n   Time:           {elapsed:.1f}s"
    )


def _refresh_event(db, event_id: int) -> Event:
    db.expire_all()
    return db.query(Event).filter(Event.id == event_id).first()


# ─────────────────────────────────────────────────────────────
# PROGRESS API HELPER  (call this from your API route)
# ─────────────────────────────────────────────────────────────

def get_event_progress(event_id: int) -> dict:
    """
    Zero-DB progress check — reads from Redis only.
    Add an API endpoint that calls this instead of querying the DB:

        @router.get("/events/{event_id}/progress")
        def event_progress(event_id: int):
            return get_event_progress(event_id)

    Returns:
        {"done": 145, "total": 232, "progress": 47}
    """
    return _redis_get_progress(event_id)


# ─────────────────────────────────────────────────────────────
# CLEANUP TASK
# ─────────────────────────────────────────────────────────────

@celery.task
def cleanup_expired_events():
    db = SessionLocal()
    try:
        now     = datetime.utcnow()
        expired = db.query(Event).filter(
            Event.expires_at != None,
            Event.expires_at < now,
        ).all()

        for event in expired:
            print(f"🗑 Cleaning expired event {event.id}")
            db.query(Cluster).filter(Cluster.event_id == event.id).delete()
            db.query(Photo).filter(Photo.event_id == event.id).delete()

            FaissManager.remove_index(event.id)

            for fname in [
                f"event_{event.id}.index",
                f"event_{event.id}_map.npy",
                f"event_{event.id}_cluster.index",
                f"event_{event.id}_cluster_map.npy",
            ]:
                path = os.path.join(INDEXES_PATH, fname)
                if os.path.exists(path):
                    os.remove(path)

            event_folder = os.path.join(STORAGE_PATH, str(event.id))
            if os.path.exists(event_folder):
                shutil.rmtree(event_folder)

            db.delete(event)

        db.commit()
        print("✅ Expired events cleanup done")

    except Exception as e:
        db.rollback()
        print(f"❌ Cleanup error: {e}")
        raise e
    finally:
        db.close()