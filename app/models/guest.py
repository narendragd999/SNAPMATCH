"""
app/models/guest.py

Guest model for event guest management.

This model stores guest contact information for events, enabling:
1. Event owners to build guest lists before events
2. Email notifications when photos are ready
3. Tracking notification status per guest

IMPORTANT: This is optional - the system works perfectly without any guests.
If no guests are added, no notifications are sent and everything continues normally.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime


class Guest(Base):
    """
    Guest model - stores contact information for event guests.
    
    Use cases:
    - Photographer imports guest list before/after event
    - System sends "photos ready" notifications to guests
    - Track which guests have been notified
    
    NOTE: This is completely optional. Events work fine without any guests.
    """
    __tablename__ = "guests"

    id = Column(Integer, primary_key=True, index=True)
    
    # Foreign key to event
    event_id = Column(
        Integer, 
        ForeignKey("events.id", ondelete="CASCADE"), 
        nullable=False, 
        index=True
    )
    
    # Guest contact information
    name = Column(String(255), nullable=True)  # Guest name (optional)
    email = Column(String(255), nullable=False, index=True)  # Email is required for notifications
    phone = Column(String(50), nullable=True)  # Phone number (optional, for SMS in future)
    
    # Additional info
    notes = Column(Text, nullable=True)  # Any notes about this guest
    
    # Notification tracking
    email_sent = Column(Boolean, default=False, nullable=False)  # Has notification been sent?
    email_sent_at = Column(DateTime, nullable=True)  # When was notification sent?
    email_opened = Column(Boolean, default=False, nullable=False)  # Did guest open the email?
    email_opened_at = Column(DateTime, nullable=True)  # When was email opened?
    
    # Guest engagement tracking
    visited_event = Column(Boolean, default=False, nullable=False)  # Did guest visit the event page?
    visited_at = Column(DateTime, nullable=True)  # When did they visit?
    downloaded_photos = Column(Boolean, default=False, nullable=False)  # Did they download photos?
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Source tracking
    source = Column(String(50), default="manual", nullable=False)  # manual, csv_import, api
    
    # Relationship to event
    event = relationship("Event", back_populates="guests")
    
    def __repr__(self):
        return f"<Guest(id={self.id}, email={self.email}, event_id={self.event_id})>"
    
    def mark_email_sent(self):
        """Mark that notification email was sent to this guest."""
        self.email_sent = True
        self.email_sent_at = datetime.utcnow()
    
    def mark_email_opened(self):
        """Mark that the guest opened the notification email."""
        self.email_opened = True
        self.email_opened_at = datetime.utcnow()
    
    def mark_visited(self):
        """Mark that the guest visited the event page."""
        self.visited_event = True
        self.visited_at = datetime.utcnow()
    
    def mark_downloaded(self):
        """Mark that the guest downloaded photos."""
        self.downloaded_photos = True
    
    def to_dict(self):
        """Convert guest to dictionary for API responses."""
        return {
            "id": self.id,
            "event_id": self.event_id,
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "notes": self.notes,
            "email_sent": self.email_sent,
            "email_sent_at": self.email_sent_at.isoformat() if self.email_sent_at else None,
            "email_opened": self.email_opened,
            "email_opened_at": self.email_opened_at.isoformat() if self.email_opened_at else None,
            "visited_event": self.visited_event,
            "visited_at": self.visited_at.isoformat() if self.visited_at else None,
            "downloaded_photos": self.downloaded_photos,
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }