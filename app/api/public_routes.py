from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi.responses import FileResponse, StreamingResponse
from app.database.db import SessionLocal
from app.models.event import Event
from app.models.cluster import Cluster
from app.models.photo import Photo
from app.models.user import User
from app.core.config import STORAGE_PATH
from app.services.search_service import public_search_face
from app.services.search_service import search_face
from PIL import Image as PILImage, ImageFile, UnidentifiedImageError
from datetime import datetime
from pathlib import Path
from typing import List
import zipfile
import os
import io
import uuid
import time
from threading import Lock


router = APIRouter(prefix="/public", tags=["public"])
ImageFile.LOAD_TRUNCATED_IMAGES = True

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


def _store_result(result: dict, event_id: int, db: Session) -> str:
    """Cache full face-match result enriched with scene + objects, return result_id."""
    _evict_expired()

    import json

    # Collect all image_names that need enrichment
    matched = result.get("matched_photos", [])
    friends = result.get("friends_photos", [])

    def extract_name(item):
        return item if isinstance(item, str) else item.get("image_name", "")

    all_names = list({
        extract_name(i)
        for i in matched + friends
        if extract_name(i)
    })

    # Single DB query for all photos at once
    photo_meta = {}
    if all_names and db:
        photos = (
            db.query(
                Photo.optimized_filename,
                Photo.scene_label,
                Photo.objects_detected,
            )
            .filter(
                Photo.event_id == event_id,
                Photo.optimized_filename.in_(all_names),
            )
            .all()
        )
        for row in photos:
            try:
                parsed = json.loads(row.objects_detected) if row.objects_detected else []
                objects = [o["label"] for o in parsed if "label" in o]
            except (json.JSONDecodeError, TypeError):
                objects = []
            photo_meta[row.optimized_filename] = {
                "scene_label": row.scene_label,
                "objects":     objects,
            }

    def enrich(items):
        enriched = []
        for item in items:
            name = extract_name(item)
            meta = photo_meta.get(name, {})
            if isinstance(item, str):
                enriched.append({
                    "image_name":  item,
                    "scene_label": meta.get("scene_label"),
                    "objects":     meta.get("objects", []),
                })
            else:
                enriched.append({
                    **item,
                    "scene_label": meta.get("scene_label"),
                    "objects":     meta.get("objects", []),
                })
        return enriched

    result_id = str(uuid.uuid4())
    with _cache_lock:
        _cache[result_id] = {
            "matched_photos": enrich(matched),
            "friends_photos": enrich(friends),
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
        "event_name":           event.name,
        "event_id":             event.id,
        "status":               event.processing_status,
        "guest_upload_enabled": getattr(event, "guest_upload_enabled", False),
    }

# --------------------------------------------------
# Guest Photo Contribution
# POST /public/events/{token}/contribute
#
# UPLOAD FLOW:
#   guest submits photos
#       → saved to disk as guest_{uuid}.ext
#       → Photo row: uploaded_by='guest', approval_status='pending', status='uploaded'
#       → event.image_count NOT incremented (not official until approved)
#
# APPROVAL FLOW (owner acts in approval queue):
#   approval_status: 'pending' → 'approved' | 'rejected'
#       → approved photos are picked up by process_images on next run
#       → event.image_count incremented at approval time (see approval_routes.py)
#
# PROCESSING GUARD:
#   process_images task MUST filter approval_status='approved' so that
#   pending/rejected guest photos are never fed into the pipeline.
# --------------------------------------------------

GUEST_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}
GUEST_MAX_FILES          = 30      # matches the frontend 30-photo cap
GUEST_MAX_FILE_SIZE_MB   = 25


def _validate_guest_event(public_token: str, db: Session) -> Event:
    """
    Looser validator used only for the contribute endpoint.

    Unlike validate_public_event(), this does NOT require processing_status='completed'.
    Guests must be able to upload to events that are still processing or
    haven't been processed yet — the upload and processing pipelines are independent.

    Checks: exists → public_status active → not expired → guest_upload_enabled.
    """
    event = db.query(Event).filter(Event.public_token == public_token).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.public_status != "active":
        raise HTTPException(status_code=403, detail="Public access is disabled for this event")

    if event.expires_at and datetime.utcnow() > event.expires_at:
        raise HTTPException(status_code=403, detail="This event link has expired")

    if not event.guest_upload_enabled:
        raise HTTPException(status_code=403, detail="Guest uploads are disabled for this event")

    return event


# ─── Guest Preview Thumbnail Generator ────────────────────────────────────
GUEST_PREVIEW_SIZE = (400, 400)

def _generate_guest_preview(file_path: str, event_id: int, stored_filename: str) -> str | None:
    """
    Generate a small WebP preview thumbnail from the raw guest upload.
    Stored in storage/{event_id}/guest_previews/
    Returns the preview filename (e.g. 'guest_abc123_preview.webp') or None on failure.
    """
    try:
        preview_folder = os.path.join(STORAGE_PATH, str(event_id), "guest_previews")
        os.makedirs(preview_folder, exist_ok=True)

        base = os.path.splitext(stored_filename)[0]          # e.g. 'guest_abc123def'
        preview_filename = f"{base}_preview.webp"
        preview_path = os.path.join(preview_folder, preview_filename)

        # Verify image integrity first
        with PILImage.open(file_path) as img:
            img.verify()

        # Re-open after verify (verify closes the file)
        with PILImage.open(file_path) as img:
            img = img.convert("RGB")
            img.thumbnail(GUEST_PREVIEW_SIZE, PILImage.LANCZOS)
            img.save(preview_path, "WEBP", quality=60, method=3)

        print(f"✅ Guest preview generated: {preview_filename}")
        return preview_filename

    except (UnidentifiedImageError, OSError) as e:
        print(f"⚠ Preview generation failed (bad image) for {stored_filename}: {e}")
        return None
    except Exception as e:
        print(f"⚠ Preview generation failed for {stored_filename}: {e}")
        return None


@router.post("/events/{public_token}/contribute")
async def contribute_photos(
    public_token:     str,
    request:          Request,
    files:            List[UploadFile] = File(...),
    contributor_name: str = Form(None),
    message:          str = Form(None),
    db:               Session = Depends(get_db),
):
    """
    Guest submits one or more photos to an event gallery.

    All uploaded photos land in the owner's approval queue
    (approval_status='pending'). They are completely invisible to the
    processing pipeline and to other guests until the owner approves them.

    Form fields (matches page.tsx submitContrib):
        files[]            — one or more image files  (required)
        contributor_name   — guest display name for the owner review UI  (optional)
        message            — note from guest to organizer  (optional)
    """
    event = _validate_guest_event(public_token, db)

    # ── Guest IP — stored for abuse/rate-limit tracking ────────────────────
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    guest_ip = (
        forwarded_for.split(",")[0].strip()
        if forwarded_for
        else (request.client.host if request.client else None)
    )

    # ── Input guards ───────────────────────────────────────────────────────
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    if len(files) > GUEST_MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum {GUEST_MAX_FILES} photos per submission.",
        )

    # ── Sanitise optional text ─────────────────────────────────────────────
    guest_name    = contributor_name.strip() if contributor_name else None
    guest_message = message.strip()          if message          else None

    # ── Ensure storage folder exists ───────────────────────────────────────
    # Guest photos live in the same folder as owner photos.
    # The approval_status='pending' DB column is the only gate that keeps
    # them out of the processing pipeline — folder location is irrelevant.
    event_folder = os.path.join(STORAGE_PATH, str(event.id))
    os.makedirs(event_folder, exist_ok=True)

    saved  = []   # stored_filenames of successfully written photos
    failed = []   # per-file error dicts surfaced back to the frontend

    for file in files:
        original_name = file.filename or ""
        suffix        = Path(original_name).suffix.lower()

        # ── Extension validation ───────────────────────────────────────────
        if suffix not in GUEST_ALLOWED_EXTENSIONS:
            failed.append({
                "filename": original_name,
                "reason":   f"Unsupported type '{suffix}'. Allowed: jpg, png, webp, heic",
            })
            continue

        # ── Read content + size gate ───────────────────────────────────────
        content = await file.read()
        size_mb = len(content) / (1024 * 1024)

        if size_mb > GUEST_MAX_FILE_SIZE_MB:
            failed.append({
                "filename": original_name,
                "reason":   f"File is {size_mb:.1f} MB — maximum is {GUEST_MAX_FILE_SIZE_MB} MB",
            })
            continue

        # ── Write to disk ──────────────────────────────────────────────────
        # Pattern: guest_{32-char hex uuid}{ext}
        #   "guest_" prefix   → visually distinct from owner "raw_" files in the folder
        #   uuid4().hex       → collision-safe unique name, no path traversal risk
        stored_filename = f"guest_{uuid.uuid4().hex}{suffix}"
        file_path       = os.path.join(event_folder, stored_filename)

        with open(file_path, "wb") as buf:
            buf.write(content)


        # ── Generate preview thumbnail for owner review ────────────────────────
        preview_filename = _generate_guest_preview(file_path, event.id, stored_filename)

        # ── Insert Photo row ───────────────────────────────────────────────
        #
        #   uploaded_by     = 'guest'    ← marks the source for all downstream logic
        #   approval_status = 'pending'  ← THE gate; process_images must skip these
        #   status          = 'uploaded' ← same starting state as owner uploads
        #
        # ⚠ event.image_count is intentionally NOT touched here.
        #   It is incremented in approval_routes.py when the owner approves,
        #   so image_count only ever reflects photos actually in the gallery.
        photo = Photo(
            event_id          = event.id,
            original_filename = original_name,
            stored_filename   = stored_filename,
            file_size_bytes   = len(content),
            # Source
            uploaded_by       = "guest",
            # Guest context shown in the owner approval UI
            guest_name        = guest_name,
            guest_message     = guest_message,
            guest_ip          = guest_ip,
            # Approval workflow
            approval_status   = "pending",
            # Processing pipeline state
            status            = "uploaded",
            uploaded_at       = datetime.utcnow(),
            guest_preview_filename = preview_filename,   # ← NEW
        )
        db.add(photo)
        saved.append(stored_filename)

    # ── Commit only when at least one file was saved successfully ──────────
    if not saved:
        raise HTTPException(
            status_code=400,
            detail={
                "message":  "No valid photos could be saved.",
                "rejected": failed,
            },
        )

    db.commit()

    # ── Response shape — page.tsx reads data.uploaded ──────────────────────
    return {
        "uploaded":       len(saved),
        "pending_review": len(saved),
        "message": (
            f"{len(saved)} photo{'s' if len(saved) != 1 else ''} submitted. "
            "They'll appear in the gallery once the organiser approves them."
        ),
        # Non-empty only when some batch files were skipped due to validation
        "rejected": failed,
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

    raw_result = await public_search_face(event.id, file, db)

    # Pass event.id and db so _store_result can enrich items
    result_id = _store_result(raw_result, event.id, db)   # ← signature changed

    matched = raw_result.get("matched_photos", [])
    friends = raw_result.get("friends_photos", [])

    total_you     = len(matched)
    total_friends = len(friends)

    # Read back enriched items from cache for page 1
    with _cache_lock:
        cached = _cache.get(result_id, {})
    enriched_matched = cached.get("matched_photos", matched)
    enriched_friends = cached.get("friends_photos", friends)

    return {
        "result_id": result_id,
        "you": {
            "page":        1,
            "page_size":   PAGE_SIZE,
            "total":       total_you,
            "total_pages": max(1, -(-total_you // PAGE_SIZE)),
            "has_more":    total_you > PAGE_SIZE,
            "items":       enriched_matched[:PAGE_SIZE],
        },
        "friends": {
            "page":        1,
            "page_size":   PAGE_SIZE,
            "total":       total_friends,
            "total_pages": max(1, -(-total_friends // PAGE_SIZE)),
            "has_more":    total_friends > PAGE_SIZE,
            "items":       enriched_friends[:PAGE_SIZE],
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


# --------------------------------------------------
# Public Scenes  ← NEW
# GET /public/events/{token}/scenes
# Returns distinct scene labels for filter chips
# --------------------------------------------------
@router.get("/events/{public_token}/scenes")
def get_public_scenes(
    public_token: str,
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    scene_counts = (
        db.query(Photo.scene_label, func.count(Photo.id).label("count"))
        .filter(
            Photo.event_id == event.id,
            Photo.scene_label.isnot(None),
            Photo.approval_status == "approved",
        )
        .group_by(Photo.scene_label)
        .order_by(func.count(Photo.id).desc())
        .all()
    )

    return {
        "scenes": [
            {"scene_label": label, "count": count}
            for label, count in scene_counts
        ]
    }