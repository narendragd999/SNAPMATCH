import os
from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.orm import Session
from typing import List

from app.database.db import get_db
from app.models.event import Event
from app.models.cluster import Cluster
from app.workers.tasks import process_images
from app.services.search_service import search_face

router = APIRouter()


# 1️⃣ Create Event
@router.post("/create-event/")
def create_event(name: str, db: Session = Depends(get_db)):
    event = Event(name=name)
    db.add(event)
    db.commit()
    db.refresh(event)

    os.makedirs(f"uploads/{event.id}", exist_ok=True)

    return {"event_id": event.id}


# 2️⃣ Upload Multiple Images
@router.post("/upload/{event_id}")
async def upload_images(
    event_id: int,
    files: List[UploadFile] = File(...)
):
    folder = f"uploads/{event_id}"
    os.makedirs(folder, exist_ok=True)

    uploaded_files = []

    for file in files:
        filepath = os.path.join(folder, file.filename)

        with open(filepath, "wb") as f:
            f.write(await file.read())

        uploaded_files.append(file.filename)

    return {
        "message": "Images uploaded successfully",
        "files": uploaded_files
    }


# 3️⃣ Start Background Processing
@router.post("/process/")
def start_processing(event_id: int):
    task = process_images.delay(event_id)
    return {"task_id": task.id}


# 4️⃣ Check Task Status
@router.get("/task/{task_id}")
def get_status(task_id: str):
    task = process_images.AsyncResult(task_id)
    return {"status": task.status}


# 5️⃣ Get Clustering Results
@router.get("/clusters/{event_id}")
def get_clusters(event_id: int, db: Session = Depends(get_db)):

    clusters = (
        db.query(Cluster)
        .filter(Cluster.event_id == event_id)
        .all()
    )

    if not clusters:
        return {
            "event_id": event_id,
            "total_clusters": 0,
            "clusters": []
        }

    cluster_map = {}

    for c in clusters:
        if c.cluster_id not in cluster_map:
            cluster_map[c.cluster_id] = []

        cluster_map[c.cluster_id].append(c.image_name)

    cluster_list = []

    for cluster_id, images in cluster_map.items():

        cluster_list.append({
            "cluster_id": cluster_id,
            "image_count": len(images),
            "preview_image": images[0],
            "images": images
        })

    # Sort by biggest cluster first
    cluster_list = sorted(
        cluster_list,
        key=lambda x: x["image_count"],
        reverse=True
    )

    return {
        "event_id": event_id,
        "total_clusters": len(cluster_list),
        "total_images": sum(c["image_count"] for c in cluster_list),
        "clusters": cluster_list
    }




# 6️⃣ Face Search Endpoint
@router.post("/search/{event_id}")
async def search(
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    result = await search_face(event_id, file, db)
    return result
