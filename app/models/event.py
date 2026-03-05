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

    name        = Column(String, nullable=False)
    slug        = Column(String, unique=True, index=True)
    public_token = Column(String, unique=True, index=True)
    owner_id    = Column(Integer, ForeignKey("users.id"))

    processing_status   = Column(String, default="pending")
    processing_progress = Column(Integer, default=0)
    image_count         = Column(Integer, default=0)
    cover_image         = Column(String, nullable=True)
    description         = Column(String, nullable=True)
    total_faces         = Column(Integer, default=0)
    total_clusters      = Column(Integer, default=0)
    public_status       = Column(String, default="disabled")
    process_count       = Column(Integer, default=0)
    last_processed_at   = Column(DateTime, nullable=True)
    expires_at          = Column(DateTime, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow)

    processing_started_at   = Column(DateTime, nullable=True)
    processing_completed_at = Column(DateTime, nullable=True)

    # Guest upload feature — owner enables per event
    # When True: guests can upload photos via the public link
    # Guest photos land in approval queue (approval_status='pending')
    guest_upload_enabled = Column(Boolean, default=True, nullable=False)

    # ═══════════════════════════════════════════════════════════════
    # 🎨 WATERMARK SETTINGS
    # ═══════════════════════════════════════════════════════════════
    watermark_enabled = Column(Boolean, default=False, nullable=False)
    watermark_config = Column(Text, nullable=True)

    # ═══════════════════════════════════════════════════════════════
    # 🔒 PIN PROTECTION
    # ═══════════════════════════════════════════════════════════════
    pin_enabled = Column(Boolean, default=True, nullable=False)
    pin_hash    = Column(String, nullable=True)
    pin_version = Column(String, nullable=True)  # changes on every PIN update


    owner = relationship("User")

    # ───────────────────────────────────────────────────────────────
    # Helper methods for watermark config
    # ───────────────────────────────────────────────────────────────
    
    def get_watermark_config(self) -> dict:
        """Parse and return watermark config as dict."""
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
        """Save watermark config as JSON string."""
        config["enabled"] = self.watermark_enabled
        self.watermark_config = json.dumps(config)

    # ───────────────────────────────────────────────────────────────
    # PIN helpers
    # ───────────────────────────────────────────────────────────────

    def set_pin(self, pin: str) -> None:
        """Hash and store a PIN."""
        salt   = _secrets.token_hex(16)
        digest = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
        self.pin_hash    = f"{salt}:{digest}"
        self.pin_enabled = True
        self.pin_version = _secrets.token_hex(8)   # ← new token on every PIN change

    def verify_pin(self, pin: str) -> bool:
        """Return True if supplied PIN matches stored hash."""
        if not self.pin_hash:
            return False
        try:
            salt, digest = self.pin_hash.split(":", 1)
        except ValueError:
            return False
        candidate = hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()
        return _secrets.compare_digest(candidate, digest)

    def clear_pin(self) -> None:
        """Remove PIN protection."""
        self.pin_enabled = False
        self.pin_hash    = None
        self.pin_version = None                    # ← clear on removal