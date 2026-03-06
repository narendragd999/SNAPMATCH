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

    # ── NEW: billing orders back-ref ──────────────────────────────────────────
    orders = relationship(
        "EventOrder",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="event",
    )

    name         = Column(String, nullable=False)
    slug         = Column(String, unique=True, index=True)
    public_token = Column(String, unique=True, index=True)
    owner_id     = Column(Integer, ForeignKey("users.id"))

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
    watermark_config  = Column(Text, nullable=True)

    # ═══════════════════════════════════════════════════════════════
    # 🔒 PIN PROTECTION
    # ═══════════════════════════════════════════════════════════════
    pin_enabled = Column(Boolean, default=True, nullable=False)
    pin_hash    = Column(String, nullable=True)
    pin_version = Column(String, nullable=True)  # changes on every PIN update

    owner = relationship("User")

    # ═══════════════════════════════════════════════════════════════
    # 💰 BILLING / QUOTA  (pay-per-event system)
    # ═══════════════════════════════════════════════════════════════

    # Max photos the owner can upload — set at purchase time via slider.
    # Enforced in upload_routes.py (replaces old PLANS[plan_type] limit).
    photo_quota = Column(Integer, default=50, nullable=False)

    # Total guest upload slots purchased for this event.
    # 0 = guest uploads not purchased / effectively disabled.
    guest_quota = Column(Integer, default=0, nullable=False)

    # Running count of approved guest photos.
    # Incremented on approval, NOT on upload.
    # Rejection does NOT consume a slot.
    guest_uploads_used = Column(Integer, default=0, nullable=False)

    # Event lifetime chosen at purchase: 30 | 90 | 365 days.
    # Used to compute expires_at = created_at + validity_days.
    validity_days = Column(Integer, default=30, nullable=False)

    # TRUE for the user's one complimentary free event (no payment needed).
    is_free_tier = Column(Boolean, default=False, nullable=False)

    # Razorpay order_id — created before checkout dialog opens.
    # NULL for free-tier events.
    payment_order_id = Column(String, nullable=True)

    # Razorpay payment_id — set after webhook/verify confirms capture.
    payment_id = Column(String, nullable=True)

    # pending → order created, payment not yet captured
    # paid    → Razorpay confirmed capture
    # failed  → payment failed / order expired
    # free    → free-tier event, no payment required
    payment_status = Column(String, default="pending", nullable=False)

    # Actual amount charged in paise (0 for free-tier events).
    amount_paid_paise = Column(Integer, default=0, nullable=False)

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

    # ───────────────────────────────────────────────────────────────
    # Billing helpers
    # ───────────────────────────────────────────────────────────────

    @property
    def is_accessible(self) -> bool:
        """True if event is paid/free and not expired."""
        if self.payment_status not in ("paid", "free"):
            return False
        if self.expires_at and datetime.utcnow() > self.expires_at:
            return False
        return True

    @property
    def guest_quota_remaining(self) -> int:
        """Remaining guest upload slots."""
        return max(0, self.guest_quota - self.guest_uploads_used)

    @staticmethod
    def generate_token() -> str:
        return _secrets.token_urlsafe(16)
