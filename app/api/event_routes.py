"""
api/event_routes.py

Owner-only event management endpoints.

WORKFLOW:
  1. Owner uploads photos  → POST /upload/{event_id}
       - Files saved to disk
       - Photo rows created (status='uploaded', approval_status='approved')
       - event.processing_status → 'queued'
       - Processing NOT auto-triggered (owner clicks button)

  2. Owner clicks Process  → POST /events/{event_id}/process  (this file)
       - Finds Photo rows: status='uploaded' AND approval_status='approved'
       - Fires process_images Celery task
       - event.processing_status → 'processing'

  3. Guest uploads photos  → POST /public/events/{token}/contribute
       - Photo rows created (status='uploaded', approval_status='pending')
       - event.image_count NOT incremented yet

  4. Owner approves guests → POST /events/{event_id}/guest-uploads/bulk-approve
       - approval_status → 'approved', image_count incremented
       - process_images Celery task fired (incremental — skips already-processed)

  5. process_images task runs incrementally:
       - Only touches Photo rows: status='uploaded' AND approval_status='approved'
       - Previously processed photos (status='processed'/'skipped') untouched
       - FAISS search index rebuilt with all clusters (old + new)
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from typing import List
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.cluster import Cluster
from app.models.photo import Photo
from app.core.dependencies import get_current_user
#from app.workers.tasks import process_images
from app.workers.tasks import process_event
from app.core.config import STORAGE_PATH
from app.services.search_service import search_face
from datetime import datetime, timedelta
from app.models.user import User
from app.core.plans import PLANS
import uuid
import secrets
import os
import shutil

router = APIRouter(prefix="/events", tags=["events"])


def _user_from_token(token: str, db) -> "User | None":
    """
    Decode a JWT passed as a query param (?token=...) and return the User.
    Used by image/thumbnail endpoints since <img src> tags are plain browser
    GETs and cannot send Authorization headers.
    Tries to import SECRET_KEY/ALGORITHM from dependencies, then falls back
    to reading directly from env so it works regardless of how dependencies.py
    exposes them.
    """
    try:
        from jose import jwt as jose_jwt
        # Try dependencies first, fall back to env
        try:
            from app.core.dependencies import SECRET_KEY, ALGORITHM
        except ImportError:
            import os
            SECRET_KEY = os.getenv("SECRET_KEY", "")
            ALGORITHM  = os.getenv("ALGORITHM", "HS256")

        if not token or not SECRET_KEY:
            return None

        payload = jose_jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            return None
        return db.query(User).filter(User.id == int(user_id)).first()
    except Exception:
        return None


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
    plan = PLANS.get(current_user.plan_type, PLANS["free"])

    user_event_count = db.query(Event).filter(
        Event.owner_id == current_user.id
    ).count()

    if user_event_count >= plan["max_events"]:
        raise HTTPException(status_code=403, detail="Event limit reached for your plan")

    expires_at = datetime.utcnow() + timedelta(days=plan.get("event_validity_days", 30))

    while True:
        slug = str(uuid.uuid4())[:8]
        if not db.query(Event).filter(Event.slug == slug).first():
            break

    public_token = secrets.token_urlsafe(16)
    cover_filename = None

    if cover_image:
        os.makedirs("storage/covers", exist_ok=True)
        unique_name = f"{uuid.uuid4()}_{cover_image.filename}"
        file_path = f"storage/covers/{unique_name}"
        with open(file_path, "wb") as buffer:
            buffer.write(cover_image.file.read())
        cover_filename = unique_name

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
# Start Processing  ← Manual "Process" button on event detail page
# --------------------------------------------------
@router.post("/{event_id}/process")
def start_event_processing(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Owner manually triggers processing after uploading photos.
    Also safe to call after guest approvals — task runs incrementally.

    Only dispatches the Celery task when there are Photo rows that are:
      - status='uploaded'          (not yet processed)
      - approval_status='approved' (not pending/rejected guest photos)
    """
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

    # ── FIX: MUST include approval_status filter ──────────────────────────────
    # Without it, pending guest photos are counted as "unprocessed", the task
    # is dispatched, but the task filters them out → finds 0 photos → marks
    # event "completed" immediately with nothing actually processed.
    unprocessed_count = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.status == "uploaded",
        Photo.approval_status == "approved",   # ← CRITICAL: exclude pending guests
    ).count()

    if unprocessed_count == 0:
        total_photos = db.query(Photo).filter(Photo.event_id == event_id).count()
        if total_photos == 0:
            raise HTTPException(status_code=400, detail="No images uploaded yet")

        # All photos already processed — check if there are pending guest uploads
        pending_guests = db.query(Photo).filter(
            Photo.event_id == event_id,
            Photo.uploaded_by == "guest",
            Photo.approval_status == "pending",
        ).count()

        if pending_guests > 0:
            return {
                "message": f"All uploaded photos are processed. {pending_guests} guest photo(s) still pending approval.",
                "processing_status": event.processing_status,
                "unprocessed_count": 0,
                "pending_guest_uploads": pending_guests,
            }

        return {
            "message": "All photos already processed",
            "processing_status": event.processing_status,
            "unprocessed_count": 0,
        }

    event.processing_status = "processing"
    event.process_count = (event.process_count or 0) + 1
    event.last_processed_at = datetime.utcnow()
    db.commit()

    #task = process_images.apply_async(args=[event_id], queue="face_processing")
    task = process_event.apply_async(args=[event_id], queue="photo_processing")

    return {
        "message": f"Processing started for {unprocessed_count} photo(s)",
        "task_id": task.id,
        "processing_status": event.processing_status,
        "unprocessed_count": unprocessed_count,
    }


# --------------------------------------------------
# Get My Events
# --------------------------------------------------
@router.get("/my")
def get_my_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
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
            "public_token": e.public_token,
            "image_count": e.image_count,
            "created_at": e.created_at,
            "expires_at": e.expires_at
        }
        for e in events
    ]


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

    # Per-status photo counts (for UI progress display)
    photo_status_counts = dict(
        db.query(Photo.status, func.count(Photo.id))
        .filter(Photo.event_id == event_id)
        .group_by(Photo.status)
        .all()
    )

    # Only count approved+uploaded as "ready to process" — matches the process endpoint logic
    unprocessed = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.status == "uploaded",
        Photo.approval_status == "approved",
    ).count()

    pending_guest_uploads = db.query(Photo).filter(
        Photo.event_id == event_id,
        Photo.uploaded_by == "guest",
        Photo.approval_status == "pending",
    ).count()

    return {
        "id": event.id,
        "name": event.name,
        "slug": event.slug,
        "public_token": event.public_token,
        "processing_status": event.processing_status,
        "processing_progress": event.processing_progress,
        "expires_at": event.expires_at,
        "image_count": event.image_count,
        "total_faces": event.total_faces,
        "total_clusters": event.total_clusters,
        "description": event.description,
        "cover_image": event.cover_image,
        "public_status": event.public_status,
        "plan_type": current_user.plan_type,
        "photo_status": photo_status_counts,
        "unprocessed_count": unprocessed,
        "has_new_photos": unprocessed > 0,
        "pending_guest_uploads": pending_guest_uploads,
    }


# --------------------------------------------------
# Get Clusters  ← paginated, sorted largest first
# GET /events/{event_id}/clusters?page=1&page_size=20
# --------------------------------------------------
@router.get("/{event_id}/clusters")
def get_event_clusters(
    event_id: int,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from collections import Counter

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Clamp page_size to a safe maximum
    page_size = min(max(page_size, 1), 100)
    page = max(page, 1)

    # ── Step 1: aggregate query — just IDs + counts, no image data ──────────
    agg_rows = (
        db.query(Cluster.cluster_id, func.count(Cluster.id).label("cnt"))
        .filter(Cluster.event_id == event_id)
        .group_by(Cluster.cluster_id)
        .order_by(func.count(Cluster.id).desc())
        .all()
    )

    if not agg_rows:
        return {
            "event_id": event_id,
            "total_clusters": 0,
            "total_images": 0,
            "page": page,
            "page_size": page_size,
            "has_more": False,
            "clusters": [],
        }

    total_clusters = len(agg_rows)
    total_images   = sum(r.cnt for r in agg_rows)

    # ── Step 2: slice the requested page ────────────────────────────────────
    start = (page - 1) * page_size
    end   = start + page_size
    page_agg = agg_rows[start:end]
    has_more = end < total_clusters

    if not page_agg:
        return {
            "event_id": event_id,
            "total_clusters": total_clusters,
            "total_images": total_images,
            "page": page,
            "page_size": page_size,
            "has_more": False,
            "clusters": [],
        }

    page_cluster_ids = [r.cluster_id for r in page_agg]
    page_cnt_map     = {r.cluster_id: r.cnt for r in page_agg}

    # ── Step 3: load only the rows for these cluster IDs ────────────────────
    cluster_rows = (
        db.query(Cluster.cluster_id, Cluster.image_name)
        .filter(
            Cluster.event_id == event_id,
            Cluster.cluster_id.in_(page_cluster_ids),
        )
        .all()
    )

    cluster_map: dict[int, list[str]] = {}
    for row in cluster_rows:
        cluster_map.setdefault(row.cluster_id, []).append(row.image_name)

    # ── Step 4: scene labels only for these images ───────────────────────────
    all_image_names = [row.image_name for row in cluster_rows]
    photo_scene_map: dict[str, str] = {}
    if all_image_names:
        photos = (
            db.query(Photo.optimized_filename, Photo.scene_label)
            .filter(
                Photo.event_id == event_id,
                Photo.optimized_filename.in_(all_image_names),
            )
            .all()
        )
        for fn, label in photos:
            if fn:
                photo_scene_map[fn] = label

    def dominant_scene(images: list[str]) -> str | None:
        scene_counts = Counter(
            photo_scene_map[img]
            for img in images
            if img in photo_scene_map and photo_scene_map[img]
        )
        return scene_counts.most_common(1)[0][0] if scene_counts else None

    # Preserve sorted order from the aggregate query
    cluster_list = [
        {
            "cluster_id":    cid,
            "image_count":   page_cnt_map[cid],
            "preview_image": cluster_map[cid][0],
            "images":        cluster_map[cid],
            "scene_label":   dominant_scene(cluster_map[cid]),
        }
        for cid in page_cluster_ids
        if cid in cluster_map
    ]

    return {
        "event_id":       event_id,
        "total_clusters": total_clusters,
        "total_images":   total_images,
        "page":           page,
        "page_size":      page_size,
        "has_more":       has_more,
        "clusters":       cluster_list,
    }


# --------------------------------------------------
# Get Scenes  ← NEW endpoint for filter pill bar
# GET /events/{event_id}/scenes
# Returns distinct scene labels + photo counts for the event
# --------------------------------------------------
@router.get("/{event_id}/scenes")
def get_event_scenes(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    scene_counts = (
        db.query(Photo.scene_label, func.count(Photo.id).label("count"))
        .filter(
            Photo.event_id == event_id,
            Photo.scene_label.isnot(None),
            Photo.approval_status == "approved",
        )
        .group_by(Photo.scene_label)
        .order_by(func.count(Photo.id).desc())
        .all()
    )

    return {
        "event_id": event_id,
        "scenes": [
            {"scene_label": label, "count": count}
            for label, count in scene_counts
        ]
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
        db.query(Cluster).filter(Cluster.event_id == event_id).delete()
        db.query(Photo).filter(Photo.event_id == event_id).delete()
        db.commit()

        if event.cover_image:
            cover_path = f"storage/covers/{event.cover_image}"
            if os.path.exists(cover_path):
                os.remove(cover_path)

        from app.services.faiss_manager import FaissManager
        from app.core.config import INDEXES_PATH
        FaissManager.remove_index(event_id)
        for filename in [
            f"event_{event_id}.index", f"event_{event_id}_map.npy",
            f"event_{event_id}_cluster.index", f"event_{event_id}_cluster_map.npy",
        ]:
            path = os.path.join(INDEXES_PATH, filename)
            if os.path.exists(path):
                os.remove(path)

        event_folder = f"storage/{event_id}"
        if os.path.exists(event_folder):
            shutil.rmtree(event_folder)

    except Exception as e:
        print("Deletion error:", e)

    db.delete(event)
    db.commit()

    return {"message": "Event deleted successfully"}


# --------------------------------------------------
# Dashboard Stats
# --------------------------------------------------
@router.get("/dashboard/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_events = db.query(Event).filter(Event.owner_id == current_user.id).count()

    total_images = db.query(func.sum(Event.image_count)).filter(
        Event.owner_id == current_user.id
    ).scalar() or 0

    total_process_runs = db.query(func.sum(Event.process_count)).filter(
        Event.owner_id == current_user.id
    ).scalar() or 0

    user_event_ids = [
        e.id for e in db.query(Event.id).filter(Event.owner_id == current_user.id).all()
    ]

    # Approved but not yet processed — matches the process endpoint logic
    unprocessed_count = 0
    if user_event_ids:
        unprocessed_count = db.query(Photo).filter(
            Photo.event_id.in_(user_event_ids),
            Photo.status == "uploaded",
            Photo.approval_status == "approved",
        ).count()

    plan = PLANS.get(current_user.plan_type, PLANS["free"])

    return {
        "total_events": total_events,
        "total_images": total_images,
        "total_process_runs": int(total_process_runs),
        "plan_type": current_user.plan_type,
        "max_events": plan.get("max_events", 0),
        "max_images_per_event": plan.get("max_images_per_event", 0),
        "unprocessed_photos": unprocessed_count,
    }


# --------------------------------------------------
# Remaining endpoints (unchanged)
# --------------------------------------------------

@router.post("/{event_id}/regenerate-link")
def regenerate_public_link(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    event.public_token = secrets.token_urlsafe(16)
    db.commit()
    return {"public_token": event.public_token}


# --------------------------------------------------
# Owner Face Search  ← enrich matches with scene + objects
# --------------------------------------------------
@router.post("/{event_id}/search")
async def search_face_in_event(
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if event.processing_status != "completed":
        raise HTTPException(status_code=400, detail="Event not processed yet")

    result = await search_face(event_id, file, db)

    # Enrich each match with scene_label + objects_detected from Photo table
    matches = result.get("matches", [])
    if matches:
        image_names = [m["image_name"] for m in matches if "image_name" in m]
        photos = (
            db.query(
                Photo.optimized_filename,
                Photo.scene_label,
                Photo.objects_detected,
            )
            .filter(
                Photo.event_id == event_id,
                Photo.optimized_filename.in_(image_names),
            )
            .all()
        )
        photo_meta = {
            row.optimized_filename: {
                "scene_label":      row.scene_label,
                "objects_detected": row.objects_detected,
            }
            for row in photos
        }

        import json
        for match in matches:
            meta = photo_meta.get(match.get("image_name"), {})
            match["scene_label"] = meta.get("scene_label")
            # Parse objects_detected JSON → list of label strings
            raw_objects = meta.get("objects_detected")
            try:
                parsed = json.loads(raw_objects) if raw_objects else []
                match["objects"] = [o["label"] for o in parsed if "label" in o]
            except (json.JSONDecodeError, TypeError):
                match["objects"] = []

        result["matches"] = matches

    return result


@router.post("/{event_id}/extend")
def extend_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    event.expires_at = datetime.utcnow() + timedelta(days=30)
    db.commit()
    return {"message": "Event extended", "expires_at": event.expires_at}


@router.post("/{event_id}/toggle-public")
def toggle_public(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    event.public_status = "disabled" if event.public_status == "active" else "active"
    db.commit()
    db.refresh(event)
    return {"public_status": event.public_status}

# --------------------------------------------------
# Owner Thumbnail  ← works regardless of public_status
# GET /events/{event_id}/thumbnail/{image_name}?token=<jwt>
#
# WHY QUERY PARAM instead of Authorization header:
# Browser <img src="..."> tags never send headers — they make
# plain GET requests. Passing the JWT as a query param is the
# standard solution for image endpoints that need auth.
# --------------------------------------------------
@router.get("/{event_id}/thumbnail/{image_name}")
def owner_thumbnail(
    event_id:   int,
    image_name: str,
    token:      str,          # JWT passed as ?token=... query param
    db: Session = Depends(get_db),
):
    # Validate JWT from query param — <img> tags can't send Authorization headers
    current_user = _user_from_token(token, db)
    if not current_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    safe_name = Path(image_name).name
    base_name = os.path.splitext(safe_name)[0]  # strip any extension → bare UUID

    # Try thumbnail as .webp first (generated by image_pipeline), then .jpg
    thumb_dir = os.path.join(STORAGE_PATH, str(event_id), "thumbnails")
    for thumb_ext in (".webp", ".jpg", ".jpeg", ".png"):
        thumb_path = os.path.join(thumb_dir, f"{base_name}{thumb_ext}")
        if os.path.exists(thumb_path):
            return FileResponse(thumb_path)

    # Thumbnail missing — fall back to full optimised image
    event_dir = os.path.join(STORAGE_PATH, str(event_id))
    for full_ext in ("", ".jpg", ".jpeg", ".png", ".webp"):
        full_path = os.path.join(event_dir, f"{base_name}{full_ext}")
        if os.path.exists(full_path):
            return FileResponse(full_path)

    raise HTTPException(status_code=404, detail="Image not found")


# --------------------------------------------------
# Owner Full Image  ← works regardless of public_status
# GET /events/{event_id}/image/{image_name}?token=<jwt>
# --------------------------------------------------
@router.get("/{event_id}/image/{image_name}")
def owner_image(
    event_id:   int,
    image_name: str,
    token:      str,
    db: Session = Depends(get_db),
):
    current_user = _user_from_token(token, db)
    if not current_user:
        raise HTTPException(status_code=401, detail="Invalid token")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    safe_name  = Path(image_name).name
    image_path = os.path.join(STORAGE_PATH, str(event_id), safe_name)

    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(image_path)