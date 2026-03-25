"""
app/api/event_routes.py  —  BRANDING SECTION
═══════════════════════════════════════════════════════════════════════════════

APPEND this entire block to the bottom of your existing event_routes.py.
Do NOT replace the file — just paste everything below the last existing route.

New endpoints added:
  GET    /events/{event_id}/branding            → get current branding config
  PATCH  /events/{event_id}/branding            → save branding config
  POST   /events/{event_id}/branding/logo-presign → presign R2 PUT for logo upload
  DELETE /events/{event_id}/branding/logo        → remove logo from R2 + clear DB field

Also update get_event() response dict to include branding fields — see
the "ADD TO get_event()" comment block below.

═══════════════════════════════════════════════════════════════════════════════
ADD TO get_event() return dict (around line 290 in your original file,
right after the existing "pin_enabled" key):

    # 🖌️  Branding
    "template_id":          event.brand_template_id or "classic",
    "brand_logo_url":       event.brand_logo_url or "",
    "brand_primary_color":  event.brand_primary_color or "#3b82f6",
    "brand_accent_color":   event.brand_accent_color or "#60a5fa",
    "brand_font":           event.brand_font or "system",
    "brand_footer_text":    event.brand_footer_text or "",
    "brand_show_powered_by": bool(event.brand_show_powered_by),

Also update the public event route (public_routes.py / GET /public/events/{token})
to include the same branding keys so the public selfie page receives them.
═══════════════════════════════════════════════════════════════════════════════
"""

# ─── Additional imports (add these to the top of event_routes.py if missing) ──
# from pydantic import BaseModel, Field, validator
# import re

from pydantic import BaseModel, Field, validator
import re

# ═══════════════════════════════════════════════════════════════════════════════
# 🖌️  BRANDING SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════════

VALID_TEMPLATES = {"classic", "minimal", "wedding", "corporate", "dark"}
VALID_FONTS     = {"system", "playfair", "dm-serif", "cormorant",
                   "syne", "outfit", "josefin", "mono"}
_HEX_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


class BrandingUpdateRequest(BaseModel):
    """
    Payload for PATCH /events/{event_id}/branding.
    All fields are optional — only supplied fields are updated.
    Mirrors the BrandingConfig TypeScript type from BrandingSettings.tsx.
    """
    template_id:          str | None = Field(None, max_length=40)
    brand_logo_url:       str | None = Field(None)          # R2 public URL or data URL
    brand_primary_color:  str | None = Field(None, max_length=7)
    brand_accent_color:   str | None = Field(None, max_length=7)
    brand_font:           str | None = Field(None, max_length=40)
    brand_footer_text:    str | None = Field(None, max_length=100)
    brand_show_powered_by: bool | None = None

    @validator("template_id")
    def validate_template(cls, v):
        if v is not None and v not in VALID_TEMPLATES:
            raise ValueError(f"template_id must be one of: {VALID_TEMPLATES}")
        return v

    @validator("brand_primary_color", "brand_accent_color")
    def validate_color(cls, v):
        if v is not None and not _HEX_RE.match(v):
            raise ValueError("Color must be a valid #RRGGBB hex string")
        return v

    @validator("brand_font")
    def validate_font(cls, v):
        if v is not None and v not in VALID_FONTS:
            raise ValueError(f"brand_font must be one of: {VALID_FONTS}")
        return v

    @validator("brand_logo_url")
    def validate_logo_url(cls, v):
        if v is None or v == "":
            return v
        # Accept: https:// R2 URLs, http:// (dev), data: URLs (fallback)
        if not (v.startswith("https://") or v.startswith("http://") or v.startswith("data:")):
            raise ValueError("brand_logo_url must be an https/http/data URL")
        # Reject suspiciously large data URLs (>500 KB is almost certainly wrong)
        if v.startswith("data:") and len(v) > 700_000:
            raise ValueError("Logo data URL is too large — upload via presign endpoint instead")
        return v


class LogoPresignRequest(BaseModel):
    filename:     str = Field(..., max_length=255)
    content_type: str = Field(..., max_length=100)

    @validator("content_type")
    def validate_mime(cls, v):
        allowed = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
        if v not in allowed:
            raise ValueError(f"content_type must be one of: {allowed}")
        return v


# ═══════════════════════════════════════════════════════════════════════════════
# 🖌️  BRANDING ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{event_id}/branding")
def get_branding(
    event_id: int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    GET /events/{event_id}/branding
    Returns the current branding configuration for the event.
    Owner-only — requires Bearer token.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return event.get_branding_config()


@router.patch("/{event_id}/branding")
def update_branding(
    event_id: int,
    payload:      BrandingUpdateRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    PATCH /events/{event_id}/branding
    Save branding settings for the event.
    Only supplied fields are updated (partial update).
    Owner-only — requires Bearer token.

    Request body (all fields optional):
    {
        "template_id":           "wedding",
        "brand_logo_url":        "https://r2.example.com/logos/abc.png",
        "brand_primary_color":   "#e879a0",
        "brand_accent_color":    "#f9a8d4",
        "brand_font":            "playfair",
        "brand_footer_text":     "© Riya Photography 2025",
        "brand_show_powered_by": true
    }
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Partial update — only touch fields that were actually sent
    data = payload.dict(exclude_none=True)

    if "template_id" in data:
        event.brand_template_id = data["template_id"]
    if "brand_logo_url" in data:
        event.brand_logo_url = data["brand_logo_url"] or None
    if "brand_primary_color" in data:
        event.brand_primary_color = data["brand_primary_color"]
    if "brand_accent_color" in data:
        event.brand_accent_color = data["brand_accent_color"]
    if "brand_font" in data:
        event.brand_font = data["brand_font"]
    if "brand_footer_text" in data:
        # Empty string is valid (clears the footer text)
        event.brand_footer_text = data["brand_footer_text"] or None
    if "brand_show_powered_by" in data:
        event.brand_show_powered_by = data["brand_show_powered_by"]

    db.commit()
    db.refresh(event)

    return {
        "message": "Branding updated",
        **event.get_branding_config(),
    }


@router.post("/{event_id}/branding/logo-presign")
def logo_presign(
    event_id: int,
    payload:      LogoPresignRequest,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    POST /events/{event_id}/branding/logo-presign
    Generate a presigned PUT URL so the browser can upload the logo
    directly to R2/MinIO — same pattern as /upload/{event_id}/presign.

    Request body:
    { "filename": "logo.png", "content_type": "image/png" }

    Response:
    {
        "upload_url":  "https://...presigned-put-url...",
        "public_url":  "https://r2.example.com/logos/{event_id}/{uuid}.png",
        "stored_name": "{uuid}.png"
    }

    After the browser PUTs the file, it stores public_url via
    PATCH /events/{event_id}/branding { "brand_logo_url": public_url }.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    ext = Path(payload.filename).suffix.lower() or ".png"
    # Whitelist extensions for safety
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".svg"}:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    stored_name = f"{uuid.uuid4()}{ext}"
    # Logos live under a dedicated prefix so they're easy to find / delete
    object_key  = f"logos/{event_id}/{stored_name}"

    try:
        upload_url = storage_service.generate_presigned_put(
            object_key=object_key,
            content_type=payload.content_type,
            expires_in=300,         # 5 minutes — plenty for a logo upload
        )
        public_url = storage_service.get_public_url(object_key)
    except AttributeError:
        # storage_service doesn't expose generate_presigned_put yet (local backend)
        # Return a fallback so the frontend can gracefully use data URL storage.
        raise HTTPException(
            status_code=501,
            detail="Presigned upload not available on this storage backend. "
                   "Use data URL fallback.",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Presign failed: {exc}")

    return {
        "upload_url":  upload_url,
        "public_url":  public_url,
        "stored_name": stored_name,
    }


@router.delete("/{event_id}/branding/logo")
def delete_logo(
    event_id: int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    DELETE /events/{event_id}/branding/logo
    Remove the brand logo — deletes from R2 and clears the DB field.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.brand_logo_url:
        # Only attempt R2 deletion for actual R2/MinIO URLs (not data URLs)
        logo_url = event.brand_logo_url
        if logo_url.startswith("https://") or logo_url.startswith("http://"):
            try:
                # Extract object key from URL: everything after the bucket domain
                # e.g. "https://pub-xxx.r2.dev/logos/42/abc.png" → "logos/42/abc.png"
                from urllib.parse import urlparse
                parsed   = urlparse(logo_url)
                obj_key  = parsed.path.lstrip("/")
                storage_service.delete_file_by_key(obj_key)
            except Exception as exc:
                # Non-fatal — clear DB field even if storage deletion fails
                print(f"⚠ Logo R2 deletion failed (continuing): {exc}")

        event.brand_logo_url = None
        db.commit()

    return {"message": "Logo removed"}
