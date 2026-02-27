"""
app/models/guest_upload.py
GuestUpload model - DEPRECATED in favor of unified Photo model
Kept only for backward compatibility during migration
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime


class GuestUpload(Base):
    __tablename__ = "guest_uploads"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    contributor_name = Column(String, nullable=True)
    message = Column(String, nullable=True)
    status = Column(String, default="pending")
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)

    # Relationships
    event = relationship("Event", back_populates="guest_uploads")
    
    # NOTE: Do NOT add a relationship to Photo here
    # Use Photo.guest_upload_id to track the link instead