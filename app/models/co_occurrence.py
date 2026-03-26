"""
app/models/co_occurrence.py

Co-occurrence model for Group/Family Detection.

Stores relationships between face clusters that appear together in photos.
This enables features like:
- "Photos with this person" (people who appear with you)
- Family/group detection (people who frequently appear together)
- Group photo suggestions
"""

from sqlalchemy import Column, Integer, ForeignKey, Index, UniqueConstraint
from app.database.db import Base


class CoOccurrence(Base):
    """
    Tracks how often two face clusters (people) appear together in photos.
    
    When cluster A and cluster B appear in the same photo, we increment
    their co-occurrence count. This allows us to identify:
    - Couples/partners (high co-occurrence, often 2 people)
    - Families (multiple people with high co-occurrence)
    - Friends/groups (moderate co-occurrence)
    
    The relationship is symmetric (A-B is same as B-A), so we always
    store with cluster_a_id < cluster_b_id to avoid duplicates.
    """
    __tablename__ = "co_occurrences"
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False)
    cluster_id_a = Column(Integer, index=True, nullable=False)
    cluster_id_b = Column(Integer, index=True, nullable=False)
    photo_count = Column(Integer, default=1, nullable=False)
    
    __table_args__ = (
        # Ensure cluster_a < cluster_b to maintain symmetry
        # And ensure uniqueness per event
        UniqueConstraint("event_id", "cluster_id_a", "cluster_id_b", name="uq_event_clusters"),
        # Composite index for efficient queries
        Index("idx_event_cluster_a", "event_id", "cluster_id_a"),
        Index("idx_event_cluster_b", "event_id", "cluster_id_b"),
        Index("idx_event_count", "event_id", "photo_count"),
    )
    
    def __repr__(self):
        return f"<CoOccurrence(event={self.event_id}, clusters={self.cluster_id_a}-{self.cluster_id_b}, count={self.photo_count})>"