"""
app/api/public_routes.py

Public (unauthenticated) endpoints — selfie search, photo browsing, downloads.

Key changes for object-storage:
  - FileResponse replaced with StreamingResponse (downloads bytes from storage_service)
  - Thumbnail serving uses storage_service.get_thumbnail_url() redirect for minio/r2,
    or streams locally for local backend
  - ZIP downloads stream from storage_service.download_file()
"""
import io
import os
import uuid
import time
import zipfile
from pathlib import Path
from threading import Lock
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form, Request
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse
from PIL import Image as PILImage, ImageFile, UnidentifiedImageError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import STORAGE_PATH
from app.database.db import SessionLocal
from app.models.cluster import Cluster
from app.models.event import Event
from app.models.photo import Photo
from app.models.user import User
from app.services import storage_service
from app.services.search_service import public_search_face, search_face
import json as _json
from pydantic import BaseModel

# ── PIN brute-force rate limiting (in-memory, per token) ──────────────────────
_pin_attempts: dict[str, list[float]] = {}   # token -> [timestamp, ...]
_pin_lock = Lock()
PIN_MAX_ATTEMPTS = 5       # per window
PIN_WINDOW_SECS  = 300     # 5 minutes

router = APIRouter(prefix="/public", tags=["public"])
ImageFile.LOAD_TRUNCATED_IMAGES = True

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── In-Memory Search Result Cache ─────────────────────────────────────────────
_cache: dict[str, dict] = {}
_cache_lock = Lock()
CACHE_TTL = 60 * 30
PAGE_SIZE  = 30


def _evict_expired():
    now = time.time()
    with _cache_lock:
        expired = [k for k, v in _cache.items() if v["expires_at"] < now]
        for k in expired:
            del _cache[k]


def _store_result(result: dict, event_id: int, db: Session) -> str:
    """Cache full face-match result enriched with scene + objects, return result_id."""
    _evict_expired()

    matched_photos = result.get("matched_photos", [])
    friends_photos = result.get("friends_photos", [])

    # Batch-load all photo metadata (2 queries instead of N×1)
    def _collect_names(items):
        return [item if isinstance(item, str) else item.get("image_name", "") for item in items]

    all_names = list(set(_collect_names(matched_photos) + _collect_names(friends_photos)))
    all_names = [n for n in all_names if n]

    photo_rows = db.query(
        Photo.optimized_filename,
        Photo.scene_label,
        Photo.objects_detected,
    ).filter(
        Photo.event_id == event_id,
        Photo.optimized_filename.in_(all_names),
    ).all() if all_names else []

    # Build meta dict with parsed objects array
    photo_meta: dict[str, dict] = {}
    for row in photo_rows:
        try:
            raw_objs = row.objects_detected
            parsed = _json.loads(raw_objs) if raw_objs else []
            objects = [o["label"] for o in parsed if isinstance(o, dict) and "label" in o]
        except (TypeError, ValueError, KeyError):
            objects = []
        photo_meta[row.optimized_filename] = {
            "scene_label": row.scene_label,
            "objects":     objects,
        }

    def _enrich(items):
        enriched = []
        for item in items:
            image_name = item if isinstance(item, str) else item.get("image_name", "")
            meta = photo_meta.get(image_name, {})
            d = {
                "image_name":  image_name,
                "scene_label": meta.get("scene_label"),
                "objects":     meta.get("objects", []),
            }
            # Preserve similarity score if present
            if isinstance(item, dict):
                if "similarity" in item:
                    d["similarity"] = item["similarity"]
                # Preserve group photo fields for friends tab
                if "total_faces" in item:
                    d["total_faces"] = item["total_faces"]
                if "other_faces" in item:
                    d["other_faces"] = item["other_faces"]
            enriched.append(d)
        return enriched

    matched_enriched = _enrich(matched_photos)
    friends_enriched = _enrich(friends_photos)

    result_id = uuid.uuid4().hex
    with _cache_lock:
        _cache[result_id] = {
            "matched_photos": matched_enriched,
            "friends_photos": friends_enriched,
            "expires_at":     time.time() + CACHE_TTL,
        }
    return result_id


def validate_public_event(public_token: str, db: Session) -> Event:
    event = db.query(Event).filter(Event.public_token == public_token).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.public_status != "active":
        raise HTTPException(status_code=403, detail="Event is not public")
    return event


# ── Get Event Info (for public page) ─────────────────────────────────────────

# ── get_public_event — replace existing function in public_routes.py ──────────
#
# Added: processed_count — the exact number of photos that will appear in
# the All Photos gallery (status=processed, approved, has optimized_filename).
# The frontend uses this for the "Browse all X event photos" button label
# so it always matches what the gallery actually loads.
#
# event.image_count counts every upload attempt including ones that fail
# the pipeline — it can be higher than what actually renders.

@router.get("/events/{public_token}")
def get_public_event(
    public_token: str,
    db: Session = Depends(get_db),
):
    """Get public event info including watermark config and branding."""
    event = validate_public_event(public_token, db)

    # Count of photos that will actually render in the All Photos gallery.
    # This is what the "Browse all X photos" button should show.
    processed_count = db.query(Photo).filter(
        Photo.event_id == event.id,
        Photo.status == "processed",
        Photo.approval_status == "approved",
        Photo.optimized_filename.isnot(None),
    ).count()

    # Get branding config using the model helper
    branding = event.get_branding_config()

    return {
        "name":                  event.name,
        "description":           event.description,
        "image_count":           event.image_count,    # raw upload count
        "processed_count":       processed_count,       # ← what actually shows in gallery
        "cover_image_url":       storage_service.get_cover_url(event.cover_image) if event.cover_image else None,
        "guest_upload_enabled":  event.guest_upload_enabled,
        "processing_status":     event.processing_status,
        "watermark_enabled":     event.watermark_enabled,
        "watermark_config":      event.get_watermark_config() if event.watermark_enabled else None,
        "pin_enabled":           event.pin_enabled,
        "pin_version":           event.pin_version,
        "expires_at":            event.expires_at.isoformat() if event.expires_at else None,
        "owner_id":              event.owner_id,
        "upload_photo_enabled":  _get_setting(db, "upload_photo_enabled") == "true",
        # 🎨 Branding fields
        "template_id":           branding["template_id"],
        "brand_logo_url":        branding["brand_logo_url"],
        "brand_primary_color":   branding["brand_primary_color"],
        "brand_accent_color":    branding["brand_accent_color"],
        "brand_font":            branding["brand_font"],
        "brand_footer_text":     branding["brand_footer_text"],
        "brand_show_powered_by": branding["brand_show_powered_by"],
    }


# ── PIN Verification ──────────────────────────────────────────────────────────

class PinVerifyRequest(BaseModel):
    pin: str


def _check_pin_rate_limit(token: str) -> bool:
    """Return True if the request is allowed (under rate limit)."""
    now = time.time()
    with _pin_lock:
        attempts = _pin_attempts.get(token, [])
        # Drop old attempts outside the window
        attempts = [t for t in attempts if now - t < PIN_WINDOW_SECS]
        if len(attempts) >= PIN_MAX_ATTEMPTS:
            _pin_attempts[token] = attempts
            return False
        attempts.append(now)
        _pin_attempts[token] = attempts
        return True


@router.post("/events/{public_token}/verify-pin")
def verify_event_pin(
    public_token: str,
    body: PinVerifyRequest,
    db: Session = Depends(get_db),
):
    """
    Verify a visitor-supplied PIN against the event's stored hash.

    - Returns 200 on success.
    - Returns 401 on wrong PIN.
    - Returns 429 after PIN_MAX_ATTEMPTS failed attempts within PIN_WINDOW_SECS.
    - Returns 400 if event has no PIN set.

    The frontend should store the verified token in sessionStorage and pass it
    as a header or query param on subsequent requests if you want server-side
    enforcement (optional — the frontend gate alone is sufficient for most use-cases).
    """
    event = db.query(Event).filter(Event.public_token == public_token).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.public_status != "active":
        raise HTTPException(status_code=403, detail="Event is not public")

    if not event.pin_enabled:
        raise HTTPException(status_code=400, detail="This event does not require a PIN")

    # Rate-limit check
    if not _check_pin_rate_limit(public_token):
        raise HTTPException(
            status_code=429,
            detail=f"Too many incorrect attempts. Please wait {PIN_WINDOW_SECS // 60} minutes and try again.",
        )

    # Validate PIN format
    pin = (body.pin or "").strip()
    if not pin.isdigit() or len(pin) != 4:
        raise HTTPException(status_code=422, detail="PIN must be exactly 4 digits")

    if not event.verify_pin(pin):
        raise HTTPException(status_code=401, detail="Incorrect PIN. Please try again.")

    # Success — clear rate-limit counter for this token
    with _pin_lock:
        _pin_attempts.pop(public_token, None)

    return {
        "success": True,
        "message": "PIN verified successfully",
        "event_name": event.name,
    }


# ── Serve Thumbnail ───────────────────────────────────────────────────────────

# Cache headers for images - reduces R2/S3 read costs and improves performance
IMAGE_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",  # 1 day cache, 7 day stale
    "CDN-Cache-Control": "public, max-age=2592000",  # 30 days for CDN (Cloudflare)
}

@router.get("/events/{public_token}/thumbnail/{image_name}")
def serve_thumbnail(
    public_token: str,
    image_name:   str,
    db: Session = Depends(get_db),
):
    event     = validate_public_event(public_token, db)
    safe_name = Path(image_name).name
    base_name = os.path.splitext(safe_name)[0]
    thumb_filename = f"{base_name}.webp"

    if STORAGE_BACKEND == "local":
        from app.core.config import STORAGE_PATH
        thumb_path = os.path.join(STORAGE_PATH, str(event.id), "thumbnails", thumb_filename)
        if not os.path.exists(thumb_path):
            raise HTTPException(status_code=404, detail="Thumbnail not found")
        return FileResponse(
            thumb_path, 
            media_type="image/webp",
            headers=IMAGE_CACHE_HEADERS
        )
    else:
        # For minio/r2: redirect to the public URL
        # Cache headers are set at bucket level for R2/MinIO
        url = storage_service.get_thumbnail_url(event.id, thumb_filename)
        return RedirectResponse(url=url)


# ── Serve Full Photo ──────────────────────────────────────────────────────────

@router.get("/events/{public_token}/photo/{image_name}")
def serve_photo(
    public_token: str,
    image_name:   str,
    db: Session = Depends(get_db),
):
    event     = validate_public_event(public_token, db)
    safe_name = Path(image_name).name

    if STORAGE_BACKEND == "local":
        from app.core.config import STORAGE_PATH
        photo_path = os.path.join(STORAGE_PATH, str(event.id), safe_name)
        if not os.path.exists(photo_path):
            raise HTTPException(status_code=404, detail="Photo not found")
        return FileResponse(
            photo_path,
            headers=IMAGE_CACHE_HEADERS
        )
    else:
        url = storage_service.get_file_url(event.id, safe_name)
        return RedirectResponse(url=url)


# ── Serve Image (thumbnail-first, used by public selfie grid) ────────────────

@router.get("/events/{public_token}/image/{image_name}")
def serve_image(
    public_token: str,
    image_name:   str,
    db: Session = Depends(get_db),
):
    """Serve thumbnail for grid display; falls back to full photo if thumb missing."""
    event     = validate_public_event(public_token, db)
    safe_name = Path(image_name).name
    base_name = os.path.splitext(safe_name)[0]
    thumb_filename = f"{base_name}.webp"

    if STORAGE_BACKEND == "local":
        from app.core.config import STORAGE_PATH
        thumb_path = os.path.join(STORAGE_PATH, str(event.id), "thumbnails", thumb_filename)
        if os.path.exists(thumb_path):
            return FileResponse(
                thumb_path, 
                media_type="image/webp",
                headers=IMAGE_CACHE_HEADERS
            )
        photo_path = os.path.join(STORAGE_PATH, str(event.id), safe_name)
        if os.path.exists(photo_path):
            return FileResponse(
                photo_path,
                headers=IMAGE_CACHE_HEADERS
            )
        raise HTTPException(status_code=404, detail="Image not found")
    else:
        try:
            url = storage_service.get_thumbnail_url(event.id, thumb_filename)
            return RedirectResponse(url=url)
        except Exception:
            url = storage_service.get_file_url(event.id, safe_name)
            return RedirectResponse(url=url)


# ── Public Selfie Search ───────────────────────────────────────────────────────

@router.post("/events/{public_token}/search")
async def public_search(
    public_token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    raw_result = await public_search_face(event.id, file, db)

    if not raw_result or (not raw_result.get("matched_photos") and not raw_result.get("friends_photos")):
        empty_page = {"result_id": None, "page": 1, "page_size": PAGE_SIZE, "total": 0, "total_pages": 0, "has_more": False, "items": []}
        return {"result_id": None, "you": empty_page, "friends": empty_page}

    result_id = _store_result(raw_result, event.id, db)

    with _cache_lock:
        entry = _cache[result_id]

    total_matched = len(entry["matched_photos"])
    total_friends = len(entry["friends_photos"])

    return {
        "result_id": result_id,
        "you": {
            "result_id":   result_id,
            "page":        1,
            "page_size":   PAGE_SIZE,
            "total":       total_matched,
            "total_pages": max(1, -(-total_matched // PAGE_SIZE)),
            "has_more":    total_matched > PAGE_SIZE,
            "items":       entry["matched_photos"][:PAGE_SIZE],
        },
        "friends": {
            "result_id":   result_id,
            "page":        1,
            "page_size":   PAGE_SIZE,
            "total":       total_friends,
            "total_pages": max(1, -(-total_friends // PAGE_SIZE)),
            "has_more":    total_friends > PAGE_SIZE,
            "items":       entry["friends_photos"][:PAGE_SIZE],
        },
    }


# ── Paginated result fetch ────────────────────────────────────────────────────

@router.get("/events/{public_token}/search/{result_id}")
def get_search_page(
    public_token: str,
    result_id:    str,
    page:         int = Query(1, ge=1),
    kind:         str = Query("matched"),
    db: Session = Depends(get_db),
):
    validate_public_event(public_token, db)
    _evict_expired()

    with _cache_lock:
        entry = _cache.get(result_id)

    if not entry:
        raise HTTPException(status_code=404, detail="Search result expired. Please search again.")

    all_items = entry["matched_photos"] if kind in ("matched", "you") else entry["friends_photos"]
    start = (page - 1) * PAGE_SIZE
    page_items = all_items[start : start + PAGE_SIZE]
    total = len(all_items)

    return {
        "result_id":   result_id,
        "page":        page,
        "page_size":   PAGE_SIZE,
        "total":       total,
        "total_pages": max(1, -(-total // PAGE_SIZE)),
        "has_more":    (page * PAGE_SIZE) < total,
        "items":       page_items,
    }


# ── Download ZIP (matched or friends) ─────────────────────────────────────────

@router.get("/events/{public_token}/download/{result_id}")
def download_photos(
    public_token: str,
    result_id:    str,
    kind:         str = Query("matched"),
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)
    _evict_expired()

    with _cache_lock:
        entry = _cache.get(result_id)

    if not entry:
        raise HTTPException(status_code=404, detail="Search result expired. Please search again.")

    all_items = entry["friends_photos"] if kind == "friends" else entry["matched_photos"]

    if not all_items:
        raise HTTPException(status_code=404, detail="No photos to download")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in all_items:
            image_name = item if isinstance(item, str) else item.get("image_name", "")
            safe_name  = Path(image_name).name
            try:
                data = storage_service.download_file(event.id, safe_name)
                zf.writestr(safe_name, data)
            except Exception:
                pass

    zip_buffer.seek(0)
    label = "friends" if kind == "friends" else "my_photos"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{event.name}_{label}.zip"'},
    )


# ── Download All Event Photos ─────────────────────────────────────────────────

@router.get("/events/{public_token}/download-all")
def download_all_event_images(
    public_token: str,
    db: Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    filenames = storage_service.list_event_files(event.id)
    if not filenames:
        raise HTTPException(status_code=404, detail="No photos in event")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename in filenames:
            try:
                data = storage_service.download_file(event.id, filename)
                zf.writestr(filename, data)
            except Exception:
                pass

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{event.name}_all_photos.zip"'},
    )


# ── Download Cluster ZIP ──────────────────────────────────────────────────────

@router.get("/events/{public_token}/clusters/{cluster_id}/download")
def download_cluster(
    public_token: str,
    cluster_id:   int,
    db: Session = Depends(get_db),
):
    event    = validate_public_event(public_token, db)
    clusters = db.query(Cluster).filter(
        Cluster.event_id == event.id,
        Cluster.cluster_id == cluster_id,
    ).all()

    if not clusters:
        raise HTTPException(status_code=404, detail="Cluster not found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for cluster in clusters:
            safe_name = Path(cluster.image_name).name
            try:
                data = storage_service.download_file(event.id, safe_name)
                zf.writestr(safe_name, data)
            except Exception:
                pass

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=cluster_{cluster_id}.zip"},
    )


# ── Public Scenes ─────────────────────────────────────────────────────────────

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


# ── Guest Contribution ────────────────────────────────────────────────────────

GUEST_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
GUEST_MAX_FILE_SIZE_MB   = 20
PER_SUBMISSION_CAP       = 20   # hard cap per single submission regardless of quota


@router.post("/events/{public_token}/contribute")
async def guest_contribute(
    public_token:     str,
    files:            List[UploadFile] = File(...),
    contributor_name: str = Form(""),
    message:          str = Form(""),
    request:          Request = None,
    db:               Session = Depends(get_db),
):
    event = validate_public_event(public_token, db)

    # ── Guest uploads enabled? ────────────────────────────────────────────────
    if not event.guest_upload_enabled:
        raise HTTPException(status_code=403, detail="Guest uploads are disabled for this event.")

    # ── Guest quota purchased? ────────────────────────────────────────────────
    if event.guest_quota == 0:
        raise HTTPException(status_code=403, detail="Guest uploads are not available for this event.")

    # ── Remaining slots check ─────────────────────────────────────────────────
    remaining_slots = event.guest_quota - event.guest_uploads_used
    if remaining_slots <= 0:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Guest upload quota exhausted for this event "
                f"({event.guest_uploads_used}/{event.guest_quota} slots used). "
                "No more guest photos can be accepted."
            ),
        )

    # ── Batch size guards ─────────────────────────────────────────────────────
    if len(files) > PER_SUBMISSION_CAP:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {PER_SUBMISSION_CAP} photos per submission.",
        )

    if len(files) > remaining_slots:
        raise HTTPException(
            status_code=400,
            detail=(
                f"You tried to submit {len(files)} photos but only "
                f"{remaining_slots} guest slot(s) remain for this event. "
                "Please reduce your selection."
            ),
        )

    guest_name    = contributor_name.strip() if contributor_name else None
    guest_message = message.strip()          if message          else None

    # ── Guest IP for abuse tracking ───────────────────────────────────────────
    guest_ip = None
    if request:
        forwarded_for = request.headers.get("x-forwarded-for")
        guest_ip = (
            forwarded_for.split(",")[0].strip()
            if forwarded_for
            else (str(request.client.host) if request.client else None)
        )

    saved  = []
    failed = []

    for file in files:
        original_name = file.filename or ""
        suffix        = Path(original_name).suffix.lower()

        if suffix not in GUEST_ALLOWED_EXTENSIONS:
            failed.append({"filename": original_name, "reason": f"Unsupported type '{suffix}'"})
            continue

        content = await file.read()
        size_mb = len(content) / (1024 * 1024)
        if size_mb > GUEST_MAX_FILE_SIZE_MB:
            failed.append({"filename": original_name, "reason": f"Too large ({size_mb:.1f} MB)"})
            continue

        stored_filename = f"guest_{uuid.uuid4().hex}{suffix}"

        try:
            storage_service.upload_file(
                data=content,
                event_id=event.id,
                filename=stored_filename,
                content_type=file.content_type or "image/jpeg",
            )
        except Exception as e:
            failed.append({"filename": original_name, "reason": f"Upload failed: {e}"})
            continue

        # Generate guest preview thumbnail for owner review UI
        preview_filename = None
        try:
            img = PILImage.open(io.BytesIO(content))
            img.thumbnail((400, 400))
            preview_buf = io.BytesIO()
            img.save(preview_buf, format="WEBP", quality=75)
            preview_buf.seek(0)
            preview_filename = f"preview_{stored_filename}.webp"
            storage_service.upload_guest_preview(preview_buf.read(), event.id, preview_filename)
        except Exception:
            preview_filename = None

        photo = Photo(
            event_id=event.id,
            original_filename=original_name,
            stored_filename=stored_filename,
            file_size_bytes=len(content),
            uploaded_by="guest",
            approval_status="pending",
            status="uploaded",
            guest_name=guest_name,
            guest_message=guest_message,
            guest_preview_filename=preview_filename,
            guest_ip=guest_ip,
        )
        db.add(photo)
        saved.append(original_name)

    # NOTE: guest_uploads_used is NOT incremented here.
    # It is incremented in guest_upload_routes.py when the owner APPROVES.
    # Rejected photos never consume a slot.
    db.commit()

    return {
        "saved":           saved,
        "failed":          failed,
        "message":         f"{len(saved)} photo(s) submitted for review.",
        "quota_total":     event.guest_quota,
        "quota_used":      event.guest_uploads_used,
        "quota_remaining": remaining_slots - len(saved),
    }


# ── Guest quota info (public) ─────────────────────────────────────────────────

@router.get("/events/{public_token}/guest-quota")
def get_guest_quota(public_token: str, db: Session = Depends(get_db)):
    """
    Returns guest upload quota info for the public contribute page UI.
    Shows remaining slots so guests know whether uploads are still possible.
    """
    event = validate_public_event(public_token, db)

    enabled = event.guest_upload_enabled and event.guest_quota > 0

    return {
        "guest_upload_enabled": enabled,
        "quota_total":          event.guest_quota,
        "quota_used":           event.guest_uploads_used,
        "quota_remaining":      event.guest_quota_remaining,
        "quota_exhausted":      event.guest_quota_remaining == 0,
    }

# helper at top of file
def _get_setting(db: Session, key: str, default: str = "false") -> str:
    from app.models.platform_settings import PlatformSetting
    row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
    return row.value if row else default

# ── Browse All Event Photos (paginated) ──────────────────────────────────────
# ADD to app/api/public_routes.py, before the _get_setting helper at the bottom.
#
# Shows ALL processed photos — status="processed" with an optimized_filename.
# This includes photos with no faces (documents, landscapes) — intentional,
# the owner decides what to upload.
#
# The previous version filtered faces_detected > 0 which caused only 39 of 50
# photos to show. Removed that filter so all processed photos appear.

@router.get("/events/{public_token}/photos")
def browse_event_photos(
    public_token: str,
    page:         int = Query(1, ge=1),
    page_size:    int = Query(30, ge=1, le=60),
    scene:        str = Query(""),
    db: Session = Depends(get_db),
):
    """
    Paginated gallery of all processed photos for an event.
    No auth required — used by the public All Photos tab.
    """
    event = validate_public_event(public_token, db)

    query = (
        db.query(
            Photo.optimized_filename,
            Photo.scene_label,
            Photo.objects_detected,
        )
        .filter(
            Photo.event_id == event.id,
            Photo.status == "processed",
            Photo.approval_status == "approved",
            Photo.optimized_filename.isnot(None),
        )
    )

    if scene:
        query = query.filter(Photo.scene_label == scene)

    total = query.count()
    rows  = (
        query
        .order_by(Photo.uploaded_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = []
    for fn, scene_label, objects_json in rows:
        try:
            parsed  = _json.loads(objects_json) if objects_json else []
            objects = [o["label"] for o in parsed if isinstance(o, dict) and "label" in o]
        except (TypeError, ValueError):
            objects = []
        items.append({
            "image_name":  fn,
            "scene_label": scene_label,
            "objects":     objects,
        })

    return {
        "page":        page,
        "page_size":   page_size,
        "total":       total,
        "total_pages": max(1, -(-total // page_size)),
        "has_more":    (page * page_size) < total,
        "items":       items,
    }


# ── Platform Stats (for landing page) ─────────────────────────────────────────

# Optional environment variables for minimum display values (useful for new platforms)
# Set these in .env to show minimum stats, or leave unset for real data only
STATS_MIN_EVENTS = int(os.getenv("STATS_MIN_EVENTS", "0"))
STATS_MIN_PHOTOS = int(os.getenv("STATS_MIN_PHOTOS", "0"))
STATS_MIN_FACES = int(os.getenv("STATS_MIN_FACES", "0"))
STATS_MIN_USERS = int(os.getenv("STATS_MIN_USERS", "0"))

@router.get("/stats")
def get_platform_stats(db: Session = Depends(get_db)):
    """
    Get platform statistics for the public landing page.
    Returns real event counts, photo counts, and user stats.
    
    Optional env vars for minimum display values:
    - STATS_MIN_EVENTS: Minimum events to display (default: 0 = real data only)
    - STATS_MIN_PHOTOS: Minimum photos to display (default: 0)
    - STATS_MIN_FACES: Minimum faces to display (default: 0)
    - STATS_MIN_USERS: Minimum users to display (default: 0)
    
    Returns both real values and display values for transparency.
    """
    from datetime import datetime
    from sqlalchemy import text
    
    # Total events (active only)
    total_events = db.query(Event).filter(
        Event.public_status == "active"
    ).count()
    
    # Total photos (processed and approved)
    total_photos = db.query(Photo).filter(
        Photo.status == "processed",
        Photo.approval_status == "approved"
    ).count()
    
    # Total faces recognised (count distinct people from clusters)
    # Each cluster_id represents a unique person
    total_faces = db.query(func.count(func.distinct(Cluster.cluster_id))).scalar() or 0
    
    # Photos processed today
    # Use COALESCE to check multiple timestamp columns since processed_at may not be set
    # Priority: processed_at > optimized_at > uploaded_at
    photos_today = 0
    try:
        result = db.execute(text("""
            SELECT COUNT(*) as cnt 
            FROM photos 
            WHERE status = 'processed' 
            AND approval_status = 'approved'
            AND COALESCE(processed_at, optimized_at, uploaded_at) >= CURRENT_DATE
        """)).scalar()
        photos_today = result or 0
    except Exception:
        photos_today = 0
    
    # Active users (users with at least one event)
    active_users = db.query(func.count(func.distinct(Event.owner_id))).scalar() or 0
    
    # Match accuracy - based on InsightFace benchmarks
    match_accuracy = 99.2
    
    # Apply minimums only if configured (for new platforms starting out)
    display_events = max(total_events, STATS_MIN_EVENTS) if STATS_MIN_EVENTS > 0 else total_events
    display_photos = max(total_photos, STATS_MIN_PHOTOS) if STATS_MIN_PHOTOS > 0 else total_photos
    display_faces = max(total_faces, STATS_MIN_FACES) if STATS_MIN_FACES > 0 else total_faces
    display_users = max(active_users, STATS_MIN_USERS) if STATS_MIN_USERS > 0 else active_users
    
    return {
        # Real actual values from database
        "real": {
            "eventsHosted": total_events,
            "photosIndexed": total_photos,
            "facesRecognised": total_faces,
            "activeUsers": active_users,
            "photosToday": photos_today,
        },
        # Display values (may include minimums for marketing)
        "display": {
            "eventsHosted": display_events,
            "photosIndexed": display_photos,
            "facesRecognised": display_faces,
            "matchAccuracy": match_accuracy,
            "activeUsers": display_users,
            "photosToday": max(photos_today, int(total_photos * 0.01)) if total_photos > 0 else photos_today,
        },
        # Quick access for frontend (uses display values)
        "eventsHosted": display_events,
        "photosIndexed": display_photos,
        "facesRecognised": display_faces,
        "matchAccuracy": match_accuracy,
        "activeUsers": display_users,
        "photosToday": photos_today,
    }