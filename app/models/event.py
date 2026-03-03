from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime
import json


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