from sqlalchemy import Column, Integer, String, ForeignKey, LargeBinary, Index
from app.database.db import Base

class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer,ForeignKey("events.id", ondelete="CASCADE"),index=True)
    cluster_id = Column(Integer, index=True)
    image_name = Column(String)
    embedding = Column(LargeBinary)

    __table_args__ = (
        Index("idx_event_cluster", "event_id", "cluster_id"),
    )
