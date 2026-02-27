"""
Phase 3: AI Enrichment Celery Task

Runs AFTER process_images completes. Detects scenes (Places365) and objects (YOLOv8n)
for each photo, stores results in Photo.scene_label, Photo.objects_detected.

This runs on a SEPARATE Celery queue ('ai_enrichment') so it doesn't block
face processing. Configure in celery_worker.py with task_routes.

How it's triggered:
    1. process_images() completes → emits ai_enrich_event.delay(event_id)
    2. OR call POST /events/{id}/enrich manually (admin/organizer)

Performance expectations:
    Places365 (CPU): ~50-150ms per image
    YOLOv8n (CPU): ~100-300ms per image
    Total for 200 images: ~5-10 minutes on CPU

PERFORMANCE NOTES (changes from original):
    • db.commit() was called after EVERY photo → ~5000 individual DB round-trips
      for 994 photos.  Now commits are batched every ENRICH_BATCH_SIZE photos,
      reducing round-trips by ~25×.
    • db.rollback() on a single photo error no longer discards the entire
      accumulated batch — the bad photo is marked individually and the loop
      continues accumulating.
"""

from app.workers.celery_worker import celery
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.services.scene_service import detect_scene, load_scene_model
from app.services.object_service import detect_objects, load_yolo_model
from datetime import datetime
import time
import os


# PERF: Commit every N photos rather than after each one.
# Reduces ~5000 DB round-trips for 994 photos down to ~40.
ENRICH_BATCH_SIZE = 25


@celery.task(queue="ai_enrichment")
def ai_enrich_event(event_id: int):
    """
    Run scene + object detection on all processed photos for an event.
    Only enriches photos that haven't been enriched yet (scene_label is None).
    """
    # Load models (idempotent — won't reload if already loaded)
    load_scene_model()
    load_yolo_model()

    db = SessionLocal()
    start_time = time.time()

    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return {"status": "event_not_found"}

        photos_to_enrich = db.query(Photo).filter(
            Photo.event_id == event_id,
            Photo.status == "processed",
            Photo.scene_label == None,
            Photo.optimized_filename != None,
        ).all()

        total = len(photos_to_enrich)
        print(f"\n🎨 AI Enrichment: event {event_id}, {total} photos to enrich")

        if total == 0:
            return {"status": "nothing_to_enrich"}

        enriched = 0
        errors = 0
        pending_batch = 0  # photos mutated since last commit

        for idx, photo in enumerate(photos_to_enrich):
            try:
                filename = photo.optimized_filename

                # Scene detection
                scene_result = detect_scene(event_id, filename)

                # Object detection
                obj_result = detect_objects(event_id, filename)

                # Store results on the ORM object (not yet committed)
                photo.scene_label = scene_result.get("scene_label")
                photo.scene_confidence = (
                    str(scene_result.get("scene_confidence"))
                    if scene_result.get("scene_confidence") else None
                )
                photo.objects_detected = obj_result.get("raw_json", "[]")

                enriched += 1
                pending_batch += 1

            except Exception as e:
                print(f"⚠ Enrichment error for photo {photo.id}: {e}")
                errors += 1
                # Don't rollback the whole batch — just skip this photo.
                # The ORM object was not mutated successfully; move on.
                continue

            # PERF: Batch commit every ENRICH_BATCH_SIZE photos.
            if pending_batch >= ENRICH_BATCH_SIZE:
                try:
                    db.commit()
                    pending_batch = 0
                except Exception as commit_err:
                    print(f"⚠ Batch commit error: {commit_err}")
                    db.rollback()
                    pending_batch = 0

            if (idx + 1) % 20 == 0:
                elapsed = time.time() - start_time
                print(f"📊 Enriched {idx+1}/{total} photos in {elapsed:.1f}s")

        # Flush any remaining uncommitted photos
        if pending_batch > 0:
            try:
                db.commit()
            except Exception as commit_err:
                print(f"⚠ Final batch commit error: {commit_err}")
                db.rollback()

        total_elapsed = time.time() - start_time

        print(
            f"\n✅ AI Enrichment complete for event {event_id}"
            f"\n   Enriched: {enriched}/{total}"
            f"\n   Errors: {errors}"
            f"\n   Time: {total_elapsed:.1f}s"
        )

        return {
            "status": "completed",
            "enriched": enriched,
            "errors": errors,
            "elapsed_seconds": round(total_elapsed, 1)
        }

    except Exception as e:
        db.rollback()
        print(f"❌ Enrichment task error: {e}")
        raise e

    finally:
        db.close()


@celery.task(queue="ai_enrichment")
def ai_enrich_photo(event_id: int, photo_id: int):
    """Enrich a single photo. Useful for re-enrichment or testing."""
    load_scene_model()
    load_yolo_model()

    db = SessionLocal()

    try:
        photo = db.query(Photo).filter(
            Photo.id == photo_id,
            Photo.event_id == event_id
        ).first()

        if not photo or not photo.optimized_filename:
            return {"status": "photo_not_found"}

        scene_result = detect_scene(event_id, photo.optimized_filename)
        obj_result = detect_objects(event_id, photo.optimized_filename)

        photo.scene_label = scene_result.get("scene_label")
        photo.scene_confidence = (
            str(scene_result.get("scene_confidence"))
            if scene_result.get("scene_confidence") else None
        )
        photo.objects_detected = obj_result.get("raw_json", "[]")

        db.commit()

        return {
            "status": "enriched",
            "scene": scene_result,
            "objects": obj_result.get("objects", [])
        }

    finally:
        db.close()