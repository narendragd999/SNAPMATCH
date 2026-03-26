"""
app/models/event.py

Changes vs original:
  - Added 7 branding columns (brand_template_id … brand_show_powered_by)
  - Added get_branding_config() / set_branding_config() helpers
    that follow the exact same pattern as get_watermark_config() /
    set_watermark_config() so the rest of the codebase stays consistent.

Everything else is UNCHANGED — no existing columns, relationships,
or helper methods were touched.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime
import json
import hashlib
import secrets as _secrets


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)

    clusters = relationship(
        "Cluster",
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    photos = relationship(
        "Photo",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="event"
    )
    guest_uploads = relationship(
        "GuestUpload",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="event"
    )
    orders = relationship(
        "EventOrder",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="event",
    )

    name                    = Column(String,   nullable=False)
    slug                    = Column(String,   unique=True, index=True)
    public_token            = Column(String,   unique=True, index=True)
    owner_id                = Column(Integer,  ForeignKey("users.id"))
    processing_status       = Column(String,   default="pending")
    processing_progress     = Column(Integer,  default=0)
    image_count             = Column(Integer,  default=0)
    cover_image             = Column(String,   nullable=True)
    description             = Column(String,   nullable=True)
    total_faces             = Column(Integer,  default=0)
    total_clusters          = Column(Integer,  default=0)
    public_status           = Column(String,   default="active")
    process_count           = Column(Integer,  default=0)
    last_processed_at       = Column(DateTime, nullable=True)
    expires_at              = Column(DateTime, nullable=True)
    created_at              = Column(DateTime, default=datetime.utcnow)
    processing_started_at   = Column(DateTime, nullable=True)
    processing_completed_at = Column(DateTime, nullable=True)

    # Guest upload feature
    guest_upload_enabled = Column(Boolean, default=True, nullable=False)

    # ═══════════════════════════════════════════════════════════════
    # 🎨 WATERMARK SETTINGS (unchanged)
    # ═══════════════════════════════════════════════════════════════
    watermark_enabled = Column(Boolean, default=False, nullable=False)
    watermark_config  = Column(Text,    nullable=True)

    # ═══════════════════════════════════════════════════════════════
    # 🔒 PIN PROTECTION (unchanged)
    # ═══════════════════════════════════════════════════════════════
    pin_enabled  = Column(Boolean, default=True,  nullable=False)
    pin_hash     = Column(String,  nullable=True)
    pin_version  = Column(String,  nullable=True)

    owner = relationship("User")

    # ═══════════════════════════════════════════════════════════════
    # 💰 BILLING / QUOTA (unchanged)
    # ═══════════════════════════════════════════════════════════════
    photo_quota          = Column(Integer, default=50,        nullable=False)
    guest_quota          = Column(Integer, default=0,         nullable=False)
    guest_uploads_used   = Column(Integer, default=0,         nullable=False)
    validity_days        = Column(Integer, default=30,        nullable=False)
    is_free_tier         = Column(Boolean, default=False,     nullable=False)
    payment_order_id     = Column(String,  nullable=True)
    payment_id           = Column(String,  nullable=True)
    payment_status       = Column(String,  default="pending", nullable=False)
    amount_paid_paise    = Column(Integer, default=0,         nullable=False)

    # ═══════════════════════════════════════════════════════════════
    # 🖌️  BRANDING (NEW)
    #
    # These columns power the public selfie page skin:
    #   brand_template_id       → which layout to render
    #   brand_logo_url          → R2 URL of owner logo (or '' for none)
    #   brand_primary_color     → hex, used for buttons / active tab
    #   brand_accent_color      → hex, used for icons / highlights
    #   brand_font              → font key from frontend FONT_OPTIONS
    #   brand_footer_text       → e.g. '© Riya Photography 2025'
    #   brand_show_powered_by   → show/hide SNAPMATCH badge in footer
    # ═══════════════════════════════════════════════════════════════
    brand_template_id     = Column(String(40),  default="classic",  nullable=True)
    brand_logo_url        = Column(Text,         nullable=True)
    brand_primary_color   = Column(String(7),   default="#3b82f6",  nullable=True)
    brand_accent_color    = Column(String(7),   default="#60a5fa",  nullable=True)
    brand_font            = Column(String(40),  default="system",   nullable=True)
    brand_footer_text     = Column(String(100), nullable=True)
    brand_show_powered_by = Column(Boolean,     default=True,       nullable=False)

    # ───────────────────────────────────────────────────────────────
    # Watermark helpers (unchanged)
    # ───────────────────────────────────────────────────────────────
    def get_watermark_config(self) -> dict:
        DEFAULT_CONFIG = {
            "enabled": False,
            "type": "text",
            "text": "© Event Photos",
            "textSize": 3,
            "textOpacity": 60,
            "textPosition": "bottom-center",
            "textColor": "#ffffff",
            "textFont": "Arial, sans-serif",
            "padding": 20,
            "rotation": 0,
            "tile": False,
        }
        if not self.watermark_config:
            return DEFAULT_CONFIG
        try:
            config = json.loads(self.watermark_config)
            return {**DEFAULT_CONFIG, **config}
        except (json.JSONDecodeError, TypeError):
            return DEFAULT_CONFIG

    def set_watermark_config(self, config: dict):
        config["enabled"] = self.watermark_enabled
        self.watermark_config = json.dumps(config)

    # ───────────────────────────────────────────────────────────────
    # 🖌️  Branding helpers (NEW — same pattern as watermark helpers)
    # ───────────────────────────────────────────────────────────────
    VALID_TEMPLATES = {"classic", "minimal", "wedding", "corporate", "dark"}
    VALID_FONTS     = {"system", "playfair", "dm-serif", "cormorant",
                       "syne", "outfit", "josefin", "mono"}

    def get_branding_config(self) -> dict:
        """Return branding fields as a dict ready for JSON serialisation."""
        return {
            "template_id":        self.brand_template_id     or "classic",
            "brand_logo_url":     self.brand_logo_url        or "",
            "brand_primary_color":self.brand_primary_color   or "#3b82f6",
            "brand_accent_color": self.brand_accent_color    or "#60a5fa",
            "brand_font":         self.brand_font            or "system",
            "brand_footer_text":  self.brand_footer_text     or "",
            "brand_show_powered_by": bool(self.brand_show_powered_by),
        }

    def set_branding_config(self, config: dict) -> None:
        """
        Apply a validated branding dict to the model columns.
        Unknown / extra keys are silently ignored — same behaviour as
        set_watermark_config merging over DEFAULT_CONFIG.
        """
        template = config.get("template_id", "classic")
        self.brand_template_id = template if template in self.VALID_TEMPLATES else "classic"

        logo = config.get("brand_logo_url", "")
        # Accept R2 URLs and data URLs (data URL fallback from frontend)
        self.brand_logo_url = logo if isinstance(logo, str) else ""

        primary = config.get("brand_primary_color", "#3b82f6")
        self.brand_primary_color = primary if _is_hex_color(primary) else "#3b82f6"

        accent = config.get("brand_accent_color", "#60a5fa")
        self.brand_accent_color = accent if _is_hex_color(accent) else "#60a5fa"

        font = config.get("brand_font", "system")
        self.brand_font = font if font in self.VALID_FONTS else "system"

        footer = config.get("brand_footer_text", "") or ""
        self.brand_footer_text = str(footer)[:100]  # enforce DB column length

        self.brand_show_powered_by = bool(config.get("brand_show_powered_by", True))

    # ───────────────────────────────────────────────────────────────
    # PIN helpers (unchanged)
    # ───────────────────────────────────────────────────────────────
    def set_pin(self, pin: str) -> None:
        salt   = _secrets.token_hex(16)
        digest = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
        self.pin_hash    = f"{salt}:{digest}"
        self.pin_enabled = True
        self.pin_version = _secrets.token_hex(8)

    def verify_pin(self, pin: str) -> bool:
        if not self.pin_hash:
            return False
        try:
            salt, digest = self.pin_hash.split(":", 1)
        except ValueError:
            return False
        candidate = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
        return _secrets.compare_digest(candidate, digest)

    def clear_pin(self) -> None:
        self.pin_enabled = False
        self.pin_hash    = None
        self.pin_version = None

    # ───────────────────────────────────────────────────────────────
    # Billing helpers (unchanged)
    # ───────────────────────────────────────────────────────────────
    @property
    def is_accessible(self) -> bool:
        if self.payment_status not in ("paid", "free"):
            return False
        if self.expires_at and datetime.utcnow() > self.expires_at:
            return False
        return True

    @property
    def guest_quota_remaining(self) -> int:
        return max(0, self.guest_quota - self.guest_uploads_used)

    @staticmethod
    def generate_token() -> str:
        return _secrets.token_urlsafe(16)


# ─── Private helper ───────────────────────────────────────────────────────────

def _is_hex_color(value: str) -> bool:
    """Validate that a string is a valid #RRGGBB hex colour."""
    if not isinstance(value, str):
        return False
    v = value.strip()
    if len(v) != 7 or v[0] != "#":
        return False
    try:
        int(v[1:], 16)
        return True
    except ValueError:
        return False