from celery import Celery
from celery.schedules import crontab
import os

celery = Celery(
    "event_ai",
    broker=os.getenv("CELERY_BROKER_URL"),
    backend=os.getenv("CELERY_BROKER_URL"),
    include=[
        "app.workers.tasks",
        "app.workers.ai_enrichment_task",
    ]
)

celery.conf.task_routes = {
    # ── Processing pipeline ─────────────────────────────────
    "app.workers.tasks.process_event":               {"queue": "photo_processing"},  # ← ADD
    "app.workers.tasks.process_single_photo":        {"queue": "photo_processing"},  # ← ADD
    "app.workers.tasks.finalize_event":              {"queue": "event_finalize"},     # ← ADD

    # ── AI enrichment ───────────────────────────────────────
    "app.workers.ai_enrichment_task.ai_enrich_event": {"queue": "ai_enrichment"},
    "app.workers.ai_enrichment_task.ai_enrich_photo": {"queue": "ai_enrichment"},

    # ── Maintenance ─────────────────────────────────────────
    "app.workers.tasks.cleanup_expired_events":       {"queue": "default"},
}

celery.conf.task_default_queue = "default"

celery.conf.beat_schedule = {
    "cleanup-expired-events-daily": {
        "task": "app.workers.tasks.cleanup_expired_events",
        "schedule": crontab(hour=3, minute=0),
    },
}

celery.conf.timezone = "UTC"
celery.conf.task_track_started = True
celery.conf.worker_prefetch_multiplier = 1
celery.conf.task_acks_late = True

# ADD these lines to celery.conf:
celery.conf.task_acks_late = True                    # FIX-6: Global setting
celery.conf.task_reject_on_worker_lost = True         # FIX-6: Global setting
celery.conf.task_time_limit = 3600                    # 1 hour max
celery.conf.task_soft_time_limit = 3300               # Soft limit
celery.conf.worker_prefetch_multiplier = 1            # Don't prefetch too many