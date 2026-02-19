from celery import Celery
from celery.schedules import crontab
import os

celery = Celery(
    "event_ai",
    broker=os.getenv("CELERY_BROKER_URL"),
    backend=os.getenv("CELERY_BROKER_URL"),
    include=["app.workers.tasks"]
)

celery.conf.beat_schedule = {
    "cleanup-expired-events-daily": {
        "task": "app.workers.tasks.cleanup_expired_events",
        "schedule": crontab(hour=3, minute=0),  # runs daily at 3 AM
    },
}

celery.conf.timezone = "UTC"

celery.conf.task_track_started = True

