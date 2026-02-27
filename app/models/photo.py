from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, BigInteger, Text, Index
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime


class Photo(Base):
    """
    Core photo tracking model with dual workflow support:
    
    OWNER UPLOAD FLOW:
    uploaded_by='owner' → approval_status='approved' (auto-approved) → processing pipeline
    
    GUEST UPLOAD FLOW:
    uploaded_by='guest' → approval_status='pending' (owner review) 
                       → [owner approves/rejects] 
                       → approval_status='approved'/'rejected' 
                       → [if approved] processing pipeline
    """
    
    __tablename__ = "photos"
    
    # ─── Primary Key ────────────────────────────────────────────────────────
    id = Column(Integer, primary_key=True, index=True)
    
    # ─── Event Reference ────────────────────────────────────────────────────
    event_id = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), 
                     index=True, nullable=False)
    
    # ─── File Information ───────────────────────────────────────────────────
    original_filename = Column(String, nullable=True)
    """Original filename from guest/owner upload (e.g., 'vacation_photo.jpg')"""
    
    stored_filename = Column(String, nullable=False, unique=False)
    """Filename on disk in storage/{event_id}/ (e.g., 'raw_abc123def456.jpg')"""
    
    optimized_filename = Column(String, nullable=True)
    """Optimized filename after image pipeline (e.g., 'abc123def456.jpg')"""
    
    file_size_bytes = Column(BigInteger, nullable=True)
    """File size in bytes for storage tracking"""
    
    # ─── Upload Source ──────────────────────────────────────────────────────
    uploaded_by = Column(String, default="owner", index=True, nullable=False)
    """
    'owner'  → uploaded via authenticated /upload/{event_id} endpoint
    'guest'  → uploaded via public /events/{token}/contribute endpoint
    """
    
    # ─── Guest Information (only populated when uploaded_by='guest') ────────
    guest_name = Column(String, nullable=True)
    """Optional name provided by guest contributor (not authenticated)"""
    
    guest_email = Column(String, nullable=True)
    """Optional email provided by guest (for contact if approval issues)"""
    
    guest_message = Column(Text, nullable=True)
    """Optional message/note from guest about the photo"""
    
    guest_ip = Column(String, nullable=True)
    """Guest IP address for abuse tracking and rate limiting"""

    # ── NEW: small preview thumbnail generated on upload, for owner review ──
    guest_preview_filename = Column(String, nullable=True)
    """
    Filename of a small WebP preview thumbnail stored in
    storage/{event_id}/guest_previews/
    Generated immediately on guest upload so the owner can visually
    review before approving. Deleted after approve or reject.
    """
    
    # ─── Processing Status ──────────────────────────────────────────────────
    status = Column(String, default="uploaded", index=True, nullable=False)
    """
    Processing pipeline status:
    - 'uploaded'      → File received, awaiting optimization
    - 'optimizing'    → Image compression/optimization in progress
    - 'optimized'     → Image optimized, awaiting face detection
    - 'face_pending'  → Queued for face detection
    - 'processed'     → Face detection complete, ready for clustering
    - 'skipped'       → Skipped (no faces, too small, invalid, etc.)
    - 'failed'        → Processing failed (corruption, timeout, etc.)
    """
    
    # ─── Face Detection Results ─────────────────────────────────────────────
    faces_detected = Column(Integer, default=0, nullable=True)
    """Number of faces found during face detection"""
    
    face_detection_confidence = Column(String, nullable=True)
    """Min confidence score of detected faces (for quality filtering)"""
    
    # ─── Approval Workflow ──────────────────────────────────────────────────
    approval_status = Column(String, default="approved", index=True, nullable=False)
    """
    Approval state for guest uploads:
    - 'approved'  → Approved by owner, enters processing pipeline
    - 'pending'   → Waiting for owner review (guest uploads only)
    - 'rejected'  → Rejected by owner, skipped from pipeline
    
    Note: Owner uploads always default to 'approved'
    """
    
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    """User ID of owner who approved (guest photos only)"""
    
    approved_at = Column(DateTime, nullable=True)
    """Timestamp when owner approved/rejected"""
    
    rejection_reason = Column(String, nullable=True)
    """Optional reason from owner for rejection (for guest communication)"""
    
    # ─── Scene & Object Detection (Phase 3) ──────────────────────────────────
    scene_label = Column(String, nullable=True)
    """Primary scene classification (e.g., 'outdoor', 'indoor', 'beach')"""
    
    scene_confidence = Column(String, nullable=True)
    """Confidence score for scene label"""
    
    # ─── Detection Results ──────────────────────────────────────────────────
    detected_objects = Column(String, nullable=True)
    """Detected objects during detection phase (JSON format)"""
    
    objects_detected = Column(Text, nullable=True)
    """JSON array of detected objects: [{'name': 'car', 'confidence': 0.95}, ...]"""
    
    # ─── Clustering ─────────────────────────────────────────────────────────
    cluster_ids = Column(String, nullable=True)
    """Comma-separated cluster IDs this photo belongs to"""
    
    # ─── Timestamps ─────────────────────────────────────────────────────────
    uploaded_at = Column(DateTime, default=datetime.utcnow, index=True)
    """When the file was received"""
    
    optimized_at = Column(DateTime, nullable=True)
    """When image optimization completed"""
    
    detected_at = Column(DateTime, nullable=True)
    """When objects/features were detected during analysis"""
    
    face_detected_at = Column(DateTime, nullable=True)
    """When face detection completed"""
    
    enriched_at = Column(DateTime, nullable=True)
    """When photo metadata was enriched (additional info added)"""
    
    processed_at = Column(DateTime, nullable=True)
    """When all processing completed (faces detected, clustered, etc.)"""
    
    # ─── Relationships ──────────────────────────────────────────────────────
    event = relationship("Event", back_populates="photos")
    
    # ─── Indexes for Performance ────────────────────────────────────────────
    __table_args__ = (
        Index('idx_event_approval', 'event_id', 'approval_status'),
        Index('idx_event_status', 'event_id', 'status'),
        Index('idx_event_uploaded_by', 'event_id', 'uploaded_by'),
        Index('idx_approval_pending', 'approval_status', 'event_id'),
    )
    
    # ─── Helper Methods ─────────────────────────────────────────────────────
    def is_guest_upload(self) -> bool:
        """Check if this photo was uploaded by a guest"""
        return self.uploaded_by == "guest"
    
    def is_approved(self) -> bool:
        """Check if photo has been approved (or is auto-approved owner upload)"""
        return self.approval_status == "approved"
    
    def is_pending_review(self) -> bool:
        """Check if photo is pending owner review"""
        return self.approval_status == "pending"
    
    def is_rejected(self) -> bool:
        """Check if photo was rejected by owner"""
        return self.approval_status == "rejected"
    
    def can_be_processed(self) -> bool:
        """Check if photo is eligible for processing pipeline"""
        return self.is_approved() and self.status in [
            "uploaded", "optimizing", "optimized", "face_pending", "processed"
        ]
    
    def is_processing(self) -> bool:
        """Check if photo is currently in processing"""
        return self.status in ["optimizing", "face_pending"]
    
    def is_complete(self) -> bool:
        """Check if processing is complete"""
        return self.status in ["processed", "skipped", "failed"]