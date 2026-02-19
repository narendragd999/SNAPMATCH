from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime
from app.models.user import User


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    clusters = relationship(
        "Cluster",
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    name = Column(String, nullable=False)
    slug = Column(String, unique=True, index=True)
    public_token = Column(String, unique=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"))
    processing_status = Column(String, default="pending")  # ✅ ADD THIS
    processing_progress = Column(Integer, default=0)
    image_count = Column(Integer, default=0)
    cover_image = Column(String, nullable=True)
    description = Column(String, nullable=True)
    total_faces = Column(Integer, default=0)
    total_clusters = Column(Integer, default=0)
    public_status = Column(String, default="disabled")
    process_count = Column(Integer, default=0)
    last_processed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User")

