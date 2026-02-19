from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.cluster import Cluster
from app.core.dependencies import get_current_user
from app.workers.tasks import process_images
from app.core.config import STORAGE_PATH
from app.services.search_service import search_face
from datetime import datetime, timedelta
from app.models.user import User
from app.core.plans import PLANS
from app.models.cluster import Cluster
import uuid
import secrets
import os
import shutil

router = APIRouter(prefix="/events", tags=["events"])
expires_at = datetime.utcnow() + timedelta(days=30)

# --------------------------------------------------
# Database Dependency
# --------------------------------------------------
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------
# Create Event
# --------------------------------------------------
@router.post("/")
def create_event(
    name: str = Form(...),
    description: str = Form(None),
    cover_image: UploadFile = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    # 📦 Get plan configuration
    plan = PLANS.get(current_user.plan_type, PLANS["free"])

    # 🚫 Enforce max events per plan
    user_event_count = db.query(Event).filter(
        Event.owner_id == current_user.id
    ).count()

    if user_event_count >= plan["max_events"]:
        raise HTTPException(
            status_code=403,
            detail="Event limit reached for your plan"
        )

    # ⏳ Plan-based expiry
    expires_at = datetime.utcnow() + timedelta(
        days=plan.get("event_validity_days", 30)
    )

    # 🔐 Ensure unique slug
    while True:
        slug = str(uuid.uuid4())[:8]
        existing = db.query(Event).filter(Event.slug == slug).first()
        if not existing:
            break

    public_token = secrets.token_urlsafe(16)

    # 📷 Handle cover image upload
    cover_filename = None

    if cover_image:
        os.makedirs("storage/covers", exist_ok=True)

        unique_name = f"{uuid.uuid4()}_{cover_image.filename}"
        file_path = f"storage/covers/{unique_name}"

        with open(file_path, "wb") as buffer:
            buffer.write(cover_image.file.read())

        cover_filename = unique_name

    # 🎯 Create event
    event = Event(
        name=name,
        description=description,
        cover_image=cover_filename,
        slug=slug,
        public_token=public_token,
        owner_id=current_user.id,
        processing_status="pending",
        processing_progress=0,
        expires_at=expires_at,
        public_status="disabled"
    )

    db.add(event)
    db.commit()
    db.refresh(event)

    return {
        "id": event.id,
        "name": event.name,
        "slug": event.slug,
        "public_token": event.public_token,
        "processing_status": event.processing_status,
        "expires_at": event.expires_at,
        "plan": current_user.plan_type,
        "description": event.description,
        "cover_image": event.cover_image
    }



# --------------------------------------------------
# Start Processing
# --------------------------------------------------
@router.post("/{event_id}/process")
def start_event_processing(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.processing_status == "processing":
        return {
            "message": "Already processing",
            "processing_status": "processing"
        }


    # Check images exist
    event_folder = os.path.join(STORAGE_PATH, str(event_id))

    if not os.path.exists(event_folder) or not os.listdir(event_folder):
        raise HTTPException(status_code=400, detail="No images uploaded")

    event.processing_status = "processing"
    event.process_count = (event.process_count or 0) + 1
    event.last_processed_at = datetime.utcnow()
    db.commit()

    task = process_images.delay(event_id)

    return {
        "message": "Processing started",
        "task_id": task.id,
        "processing_status": event.processing_status
    }


# --------------------------------------------------
# Get My Events
# --------------------------------------------------
@router.get("/my")
def get_my_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    try:
        events = db.query(Event).filter(
            Event.owner_id == current_user.id
        ).order_by(Event.created_at.desc()).all()

        return [
            {
                "id": e.id,
                "name": e.name,
                "slug": e.slug,
                "cover_image": e.cover_image,
                "public_status": e.public_status,
                "public_token": e.public_token,   # ✅ add this
                "image_count": e.image_count,
                "created_at": e.created_at,
                "expires_at": e.expires_at
            }
            for e in events
        ]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# --------------------------------------------------
# Get Event Details
# --------------------------------------------------
@router.get("/{event_id}")
def get_event_details(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return {
        "id": event.id,
        "name": event.name,
        "slug": event.slug,
        "public_token": event.public_token,
        "processing_status": event.processing_status,
        "processing_progress": event.processing_progress,
        "expires_at": event.expires_at,

        # 🔥 IMPORTANT FIELDS
        "image_count": event.image_count,
        "total_faces": event.total_faces,
        "total_clusters": event.total_clusters,
        "description": event.description,
        "cover_image": event.cover_image,
        "public_status": event.public_status,
    }





# --------------------------------------------------
# Get Clusters
# --------------------------------------------------
@router.get("/{event_id}/clusters")
def get_event_clusters(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    clusters = (
        db.query(Cluster)
        .filter(Cluster.event_id == event_id)
        .all()
    )

    if not clusters:
        return {
            "event_id": event_id,
            "total_clusters": 0,
            "total_images": 0,
            "clusters": []
        }

    cluster_map = {}

    for c in clusters:
        cluster_map.setdefault(c.cluster_id, []).append(c.image_name)

    cluster_list = [
        {
            "cluster_id": cid,
            "image_count": len(images),
            "preview_image": images[0],
            "images": images
        }
        for cid, images in cluster_map.items()
    ]

    cluster_list.sort(key=lambda x: x["image_count"], reverse=True)

    return {
        "event_id": event_id,
        "total_clusters": len(cluster_list),
        "total_images": sum(c["image_count"] for c in cluster_list),
        "clusters": cluster_list
    }



# --------------------------------------------------
# Delete Event
# --------------------------------------------------
@router.delete("/{event_id}")
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    try:
        # 🔥 Delete clusters
        db.query(Cluster).filter(
            Cluster.event_id == event_id
        ).delete()

        # 🔥 Delete faces if model exists
        # db.query(Face).filter(Face.event_id == event_id).delete()

        db.commit()

        # 🔥 Delete cover image file
        if event.cover_image:
            cover_path = f"storage/covers/{event.cover_image}"
            if os.path.exists(cover_path):
                os.remove(cover_path)

        # 🔥 Delete event image folder
        event_folder = f"storage/{event_id}"
        if os.path.exists(event_folder):
            shutil.rmtree(event_folder)

    except Exception as e:
        print("File deletion error:", e)

    # 🔥 Finally delete event record
    db.delete(event)
    db.commit()

    return {"message": "Event deleted successfully"}





# --------------------------------------------------
# Regenerate Public Link
# --------------------------------------------------
@router.post("/{event_id}/regenerate-link")
def regenerate_public_link(
    event_id: int,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user),
):

    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    event.public_token = secrets.token_urlsafe(16)
    db.commit()

    return {
        "public_token": event.public_token
    }

@router.post("/{event_id}/search")
async def search_face_in_event(
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user),
):

    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.processing_status != "completed":
        raise HTTPException(
            status_code=400,
            detail="Event not processed yet"
        )

    result = await search_face(event_id, file, db)

    return result

@router.post("/{event_id}/extend")
def extend_event(
    event_id: int,
    db: Session = Depends(get_db),
    user_id: int = Depends(get_current_user),
):

    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    from datetime import datetime, timedelta

    event.expires_at = datetime.utcnow() + timedelta(days=30)
    db.commit()

    return {"message": "Event extended"}


@router.get("/dashboard/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_events = db.query(Event).filter(
        Event.owner_id == current_user.id
    ).count()

    total_images = db.query(func.sum(Event.image_count)).filter(
        Event.owner_id == current_user.id
    ).scalar() or 0

    total_process_runs = db.query(
        func.sum(Event.process_count)
    ).filter(
        Event.owner_id == current_user.id
    ).scalar() or 0

    avg_progress = db.query(
        func.avg(Event.processing_progress)
    ).filter(
        Event.owner_id == current_user.id
    ).scalar() or 0

    plan = PLANS.get(current_user.plan_type, PLANS["free"])

    return {
        "total_events": total_events,
        "total_images": total_images,
        "total_process_runs": total_process_runs,
        "average_progress": int(avg_progress),
        "plan_type": current_user.plan_type,
        "max_events": plan.get("max_events", 0),
        "max_images_per_event": plan.get("max_images_per_event", 0),
    }


@router.post("/{event_id}/toggle-public")
def toggle_public(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    event.public_status = (
        "disabled" if event.public_status == "active" else "active"
    )

    db.commit()
    db.refresh(event)

    return {"public_status": event.public_status}
