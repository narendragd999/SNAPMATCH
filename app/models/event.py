from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime


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

    owner = relationship("User")