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
    ],
)

# ─────────────────────────────────────────────
# TASK ROUTING (CRITICAL)
# ─────────────────────────────────────────────
celery.conf.task_routes = {

    # 1️⃣ Orchestrator (dispatches chord only)
    "app.workers.tasks.process_event": {
        "queue": "orchestrator"
    },

    # 2️⃣ Heavy ML per-photo processing
    "app.workers.tasks.process_single_photo": {
        "queue": "photo_processing"
    },

    # 3️⃣ Final clustering step
    "app.workers.tasks.finalize_event": {
        "queue": "event_finalize"
    },

    # 4️⃣ AI enrichment tasks
    "app.workers.ai_enrichment_task.ai_enrich_event": {
        "queue": "ai_enrichment"
    },
    "app.workers.ai_enrichment_task.ai_enrich_photo": {
        "queue": "ai_enrichment"
    },

    # 5️⃣ Cleanup + default
    "app.workers.tasks.cleanup_expired_events": {
        "queue": "default"
    },
}

celery.conf.task_default_queue = "default"

# ─────────────────────────────────────────────
# BEAT SCHEDULE
# ─────────────────────────────────────────────
celery.conf.beat_schedule = {
    "cleanup-expired-events-daily": {
        "task": "app.workers.tasks.cleanup_expired_events",
        "schedule": crontab(hour=3, minute=0),
    },
}

celery.conf.timezone = "UTC"
celery.conf.task_track_started = True

# Optional but recommended
celery.conf.worker_prefetch_multiplier = 1
celery.conf.task_acks_late = True