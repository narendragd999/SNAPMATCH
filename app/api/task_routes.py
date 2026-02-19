from fastapi import APIRouter
from app.workers.celery_worker import celery

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/{task_id}")
def get_task_status(task_id: str):

    task = celery.AsyncResult(task_id)

    return {
        "task_id": task_id,
        "status": task.status,
        "result": task.result
    }
