"""
Co-occurrence Model

Tracks relationships between clusters (people) based on how often 
they appear together in photos. Used for:
- "With Friends" tab differentiation
- Frequent companion detection
- Relationship strength analysis

Schema:
- event_id: Event this relationship belongs to
- cluster_id_a: First cluster (always smaller id for consistency)
- cluster_id_b: Second cluster (always larger id for consistency)
- photo_count: Number of photos both clusters appear in together
"""

from sqlalchemy import Column, Integer, ForeignKey, Index, UniqueConstraint
from app.database.db import Base


class CoOccurrence(Base):
    __tablename__ = "co_occurrences"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), index=True)
    cluster_id_a = Column(Integer, index=True)  # Smaller cluster_id
    cluster_id_b = Column(Integer, index=True)  # Larger cluster_id
    photo_count = Column(Integer, default=1)    # Times they appear together

    __table_args__ = (
        # Unique constraint to prevent duplicate pairs
        UniqueConstraint("event_id", "cluster_id_a", "cluster_id_b", name="uq_co_occurrence_pair"),
        # Index for efficient querying of relationships for a cluster
        Index("idx_co_occurrence_lookup", "event_id", "cluster_id_a", "cluster_id_b"),
        # Index for finding all relationships for an event
        Index("idx_co_occurrence_event_count", "event_id", "photo_count"),
    )
    
    def __repr__(self):
        return f"<CoOccurrence(event={self.event_id}, clusters={self.cluster_id_a}-{self.cluster_id_b}, count={self.photo_count})>"