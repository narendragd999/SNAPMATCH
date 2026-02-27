from celery import Celery
from celery.schedules import crontab
import os

# celery_worker.py
celery = Celery(
    "event_ai",
    broker=os.getenv("CELERY_BROKER_URL"),
    backend=os.getenv("CELERY_BROKER_URL"),
    include=[
        "app.workers.tasks",
        "app.workers.ai_enrichment_task",   # ← ADD THIS
    ]
)

# ── Task routing ───────────────────────────────────────
# process_images  → celery_face worker (has insightface volume)
# ai_enrich_event → celery_ai   worker (has models volume)
# everything else → celery_default
celery.conf.task_routes = {
    "app.workers.tasks.process_images":              {"queue": "face_processing"},
    "app.workers.ai_enrichment_task.ai_enrich_event": {"queue": "ai_enrichment"},   # ← FIXED path
    "app.workers.ai_enrichment_task.ai_enrich_photo": {"queue": "ai_enrichment"},   # ← ADD this too
    "app.workers.tasks.cleanup_expired_events":       {"queue": "default"},
}

celery.conf.task_default_queue = "default"

celery.conf.beat_schedule = {
    "cleanup-expired-events-daily": {
        "task": "app.workers.tasks.cleanup_expired_events",
        "schedule": crontab(hour=3, minute=0),  # runs daily at 3 AM UTC
    },
}

celery.conf.timezone = "UTC"
celery.conf.task_track_started = True