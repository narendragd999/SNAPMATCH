from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi.responses import FileResponse, StreamingResponse
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.cluster import Cluster
from app.models.user import User
from app.core.config import STORAGE_PATH
from app.services.search_service import public_search_face
from app.services.search_service import search_face
from datetime import datetime
from pathlib import Path
import zipfile
import os
import io
import uuid
import time
from threading import Lock

router = APIRouter(prefix="/public", tags=["public"])


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
# In-Memory Search Result Cache
# --------------------------------------------------
# Stores paginated face-match results so the expensive
# search only runs ONCE per upload. Subsequent page
# requests just slice from cache — instant response.
#
# Structure:
#   _cache[result_id] = {
#       "matched_photos": [...],   # list of {image_name, ...}
#       "friends_photos": [...],   # list of image_name strings
#       "expires_at":     float,   # unix timestamp
#   }

_cache: dict[str, dict] = {}
_cache_lock = Lock()
CACHE_TTL = 60 * 30   # 30 minutes
PAGE_SIZE  = 30        # photos per page


def _evict_expired():
    """Remove stale cache entries (called lazily on every request)."""
    now = time.time()
    with _cache_lock:
        expired = [k for k, v in _cache.items() if v["expires_at"] < now]
        for k in expired:
            del _cache[k]


def _store_result(result: dict) -> str:
    """Cache full face-match result and return a unique result_id."""
    _evict_expired()
    result_id = str(uuid.uuid4())
    with _cache_lock:
        _cache[result_id] = {
            "matched_photos": result.get("matched_photos", []),
            "friends_photos": result.get("friends_photos", []),
            "expires_at":     time.time() + CACHE_TTL,
        }
    return result_id


def _get_page(result_id: str, kind: str, page: int) -> dict | None:
    """
    Slice cached results for the requested page.
    kind: "you"     → matched_photos
          "friends" → friends_photos
    Returns None if result_id is missing or expired.
    """
    _evict_expired()
    with _cache_lock:
        entry = _cache.get(result_id)

    if entry is None:
        return None

    all_items   = entry["friends_photos"] if kind == "friends" else entry["matched_photos"]
    total       = len(all_items)
    total_pages = max(1, -(-total // PAGE_SIZE))   # ceiling division
    offset      = (page - 1) * PAGE_SIZE
    page_items  = all_items[offset: offset + PAGE_SIZE]

    return {
        "result_id":   result_id,
        "page":        page,
        "page_size":   PAGE_SIZE,
        "total":       total,
        "total_pages": total_pages,
        "has_more":    page < total_pages,
        "items":       page_items,
    }


# --------------------------------------------------
# Common Public Event Validator
# --------------------------------------------------
def validate_public_event(public_token: str, db: Session) -> Event:
    event = db.query(Event).filter(
        Event.public_token == public_token
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.public_status != "active":
        raise HTTPException(status_code=403, detail="Public access disabled")

    if event.expires_at and datetime.utcnow() > event.expires_at:
        raise HTTPException(status_code=403, detail="Public link expired")

    if event.processing_status != "completed":
        raise HTTPException(status_code=400, detail="Event not ready")

    return event


# --------------------------------------------------
# Public Event Info
# --------------------------------------------------
@router.get("/events/{public_token}")
def get_public_event(
    public_token: str,
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    return {
        "event_name": event.name,
        "event_id":   event.id,
        "status":     event.processing_status,
    }


# --------------------------------------------------
# Public Clusters Summary
# --------------------------------------------------
@router.get("/events/{public_token}/clusters")
def get_public_clusters(
    public_token: str,
    page:  int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    cluster_query = (
        db.query(
            Cluster.cluster_id,
            func.count(Cluster.id).label("image_count")
        )
        .filter(Cluster.event_id == event.id)
        .group_by(Cluster.cluster_id)
        .order_by(func.count(Cluster.id).desc())
    )

    total_clusters = cluster_query.count()
    offset         = (page - 1) * limit
    cluster_page   = cluster_query.offset(offset).limit(limit).all()

    cluster_list = []
    for cid, image_count in cluster_page:
        preview = (
            db.query(Cluster.image_name)
            .filter(
                Cluster.event_id  == event.id,
                Cluster.cluster_id == cid
            )
            .first()
        )
        cluster_list.append({
            "cluster_id":    cid,
            "image_count":   image_count,
            "preview_image": preview[0] if preview else None,
        })

    return {
        "event_name":     event.name,
        "page":           page,
        "limit":          limit,
        "total_clusters": total_clusters,
        "total_pages":    (total_clusters + limit - 1) // limit,
        "clusters":       cluster_list,
    }


# --------------------------------------------------
# Public Cluster Images
# --------------------------------------------------
@router.get("/events/{public_token}/clusters/{cluster_id}")
def get_public_cluster_images(
    public_token: str,
    cluster_id: int,
    page:  int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    query        = db.query(Cluster).filter(
        Cluster.event_id   == event.id,
        Cluster.cluster_id == cluster_id,
    )
    total_images = query.count()
    offset       = (page - 1) * limit
    clusters     = query.offset(offset).limit(limit).all()

    return {
        "cluster_id":   cluster_id,
        "page":         page,
        "limit":        limit,
        "total_images": total_images,
        "total_pages":  (total_images + limit - 1) // limit,
        "images":       [c.image_name for c in clusters],
    }


# --------------------------------------------------
# Serve Public Image (Safe)
# --------------------------------------------------
@router.get("/events/{public_token}/image/{image_name}")
def serve_public_image(
    public_token: str,
    image_name:   str,
    db: Session = Depends(get_db),
):
    event     = validate_public_event(public_token, db)
    safe_name = Path(image_name).name

    if not safe_name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        raise HTTPException(status_code=400, detail="Invalid file type")

    image_path = os.path.join(STORAGE_PATH, str(event.id), safe_name)

    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(image_path)


# --------------------------------------------------
# Download Cluster ZIP (Plan Restricted)
# --------------------------------------------------
@router.get("/events/{public_token}/clusters/{cluster_id}/download")
def download_cluster_zip(
    public_token: str,
    cluster_id:   int,
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)
    owner = db.query(User).filter(User.id == event.owner_id).first()

    if owner.plan_type == "free":
        raise HTTPException(status_code=403, detail="Download not allowed for this event")

    clusters = db.query(Cluster).filter(
        Cluster.event_id   == event.id,
        Cluster.cluster_id == cluster_id,
    ).all()

    if not clusters:
        raise HTTPException(status_code=404, detail="Cluster not found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for cluster in clusters:
            safe_name  = Path(cluster.image_name).name
            image_path = os.path.join(STORAGE_PATH, str(event.id), safe_name)
            if os.path.exists(image_path):
                zip_file.write(image_path, arcname=safe_name)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=cluster_{cluster_id}.zip"},
    )


# --------------------------------------------------
# Serve Thumbnail
# --------------------------------------------------
@router.get("/events/{public_token}/thumbnail/{image_name}")
def serve_thumbnail(
    public_token: str,
    image_name:   str,
    db: Session = Depends(get_db),
):
    event     = validate_public_event(public_token, db)
    safe_name = Path(image_name).name
    base_name = os.path.splitext(safe_name)[0]

    thumbnail_path = os.path.join(
        STORAGE_PATH, str(event.id), "thumbnails", f"{base_name}.webp"
    )

    if not os.path.exists(thumbnail_path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    return FileResponse(thumbnail_path, media_type="image/webp")


# --------------------------------------------------
# Public Selfie Search  ← POST: runs face match ONCE,
#                          caches result, returns page 1
# --------------------------------------------------
@router.post("/events/{public_token}/search")
async def public_search(
    public_token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    # Run expensive face-match once
    raw_result = await public_search_face(event.id, file, db)

    # Cache the full result and slice page 1 for each tab
    result_id = _store_result(raw_result)

    matched = raw_result.get("matched_photos", [])
    friends = raw_result.get("friends_photos", [])

    total_you     = len(matched)
    total_friends = len(friends)

    return {
        "result_id": result_id,

        # Page 1 — "Your Photos" tab
        "you": {
            "page":        1,
            "page_size":   PAGE_SIZE,
            "total":       total_you,
            "total_pages": max(1, -(-total_you // PAGE_SIZE)),
            "has_more":    total_you > PAGE_SIZE,
            "items":       matched[:PAGE_SIZE],
        },

        # Page 1 — "With Friends" tab
        "friends": {
            "page":        1,
            "page_size":   PAGE_SIZE,
            "total":       total_friends,
            "total_pages": max(1, -(-total_friends // PAGE_SIZE)),
            "has_more":    total_friends > PAGE_SIZE,
            "items":       friends[:PAGE_SIZE],
        },
    }


# --------------------------------------------------
# Paginated Search Results  ← GET: subsequent pages
#                              from cache, no re-search
# --------------------------------------------------
@router.get("/events/{public_token}/search/{result_id}")
def public_search_page(
    public_token: str,
    result_id:    str,
    kind: str = Query("you", regex="^(you|friends)$"),
    page: int = Query(2, ge=2),
    db: Session = Depends(get_db),
):
    # Validate event is still active before serving pages
    validate_public_event(public_token, db)

    data = _get_page(result_id, kind, page)

    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Search session expired. Please upload your photo again.",
        )

    return data


# --------------------------------------------------
# Download Single Image (Force Download)
# --------------------------------------------------
@router.get("/events/{public_token}/download/{image_name}")
def download_single_image(
    public_token: str,
    image_name:   str,
    db: Session = Depends(get_db),
):
    event     = validate_public_event(public_token, db)
    safe_name = Path(image_name).name

    if not safe_name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        raise HTTPException(status_code=400, detail="Invalid file type")

    image_path = os.path.join(STORAGE_PATH, str(event.id), safe_name)

    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(
        image_path,
        media_type="application/octet-stream",
        filename=safe_name,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# --------------------------------------------------
# Download Matched Photos ZIP
# Accepts comma-separated image names via query param
# e.g. ?images=a.jpg,b.jpg,c.jpg
# --------------------------------------------------
@router.get("/events/{public_token}/download-zip")
def download_matched_zip(
    public_token: str,
    result_id:    str,
    kind: str = Query("you", regex="^(you|friends)$"),
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    # Pull ALL items from cache for the requested tab
    with _cache_lock:
        entry = _cache.get(result_id)

    if entry is None:
        raise HTTPException(
            status_code=404,
            detail="Search session expired. Please upload your photo again.",
        )

    all_items = entry["friends_photos"] if kind == "friends" else entry["matched_photos"]

    if not all_items:
        raise HTTPException(status_code=404, detail="No photos to download")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for item in all_items:
            image_name = item if isinstance(item, str) else item.get("image_name", "")
            safe_name  = Path(image_name).name
            image_path = os.path.join(STORAGE_PATH, str(event.id), safe_name)
            if os.path.exists(image_path):
                zip_file.write(image_path, arcname=safe_name)

    zip_buffer.seek(0)
    label = "friends" if kind == "friends" else "my_photos"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{event.name}_{label}.zip"'},
    )


# --------------------------------------------------
# Download All Event Images (ZIP)
# --------------------------------------------------
@router.get("/events/{public_token}/download-all")
def download_all_event_images(
    public_token: str,
    db: Session = Depends(get_db),
):
    event        = validate_public_event(public_token, db)
    image_folder = os.path.join(STORAGE_PATH, str(event.id))

    if not os.path.exists(image_folder):
        raise HTTPException(status_code=404, detail="Event folder not found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_name in os.listdir(image_folder):
            if file_name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                file_path = os.path.join(image_folder, file_name)
                if os.path.isfile(file_path):
                    zip_file.write(file_path, arcname=file_name)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{event.name}_all_photos.zip"'},
    )