"""
app/models/event_analytics.py

Event Analytics Model — Track per-event statistics.

Tracks:
  - Page views
  - Face matches (selfie searches)
  - Downloads
  - Guest uploads
  - Daily aggregations for charts
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Date, Index
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime, date


class EventAnalytics(Base):
    """Daily analytics snapshot for each event."""
    __tablename__ = "event_analytics"

    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign key to event
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Date for the snapshot (one row per event per day)
    date = Column(Date, nullable=False, default=date.today)
    
    # ── Metrics ───────────────────────────────────────────────────────
    page_views       = Column(Integer, default=0, nullable=False)
    face_matches     = Column(Integer, default=0, nullable=False)  # Number of selfie searches
    downloads        = Column(Integer, default=0, nullable=False)  # Photo downloads
    guest_uploads    = Column(Integer, default=0, nullable=False)  # Guest photo uploads
    
    # ── Timestamps ─────────────────────────────────────────────────────
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    event = relationship("Event", backref="analytics_snapshots")
    
    # Unique constraint: one row per event per day
    __table_args__ = (
        Index('ix_event_analytics_event_date', 'event_id', 'date', unique=True),
    )


class EventAnalyticsTotal(Base):
    """Running totals for event analytics (updated in real-time)."""
    __tablename__ = "event_analytics_totals"

    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign key to event (one row per event)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    
    # ── Total Metrics ──────────────────────────────────────────────────
    total_views      = Column(Integer, default=0, nullable=False)
    total_matches    = Column(Integer, default=0, nullable=False)
    total_downloads  = Column(Integer, default=0, nullable=False)
    total_guest_uploads = Column(Integer, default=0, nullable=False)
    
    # ── Timestamps ─────────────────────────────────────────────────────
    last_view_at     = Column(DateTime, nullable=True)
    last_match_at    = Column(DateTime, nullable=True)
    last_download_at = Column(DateTime, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    event = relationship("Event", backref="analytics_total")