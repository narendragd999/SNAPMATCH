"""
Trusted Device Model

Stores trusted devices for users to bypass OTP on known devices.
Improves UX while maintaining security.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database.db import Base
from datetime import datetime, timedelta


class TrustedDevice(Base):
    """Trusted device for OTP bypass."""
    __tablename__ = "trusted_devices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Device identification
    device_fingerprint = Column(String(255), nullable=False)  # Browser fingerprint hash
    device_name = Column(String(100), nullable=True)  # "Chrome on Windows", "Safari on iPhone"
    user_agent = Column(String(500), nullable=True)
    ip_address = Column(String(50), nullable=True)
    
    # Trust metadata
    trusted_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)  # Optional expiration (e.g., 30 days)
    last_used_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Relationship
    user = relationship("User", backref="trusted_devices")
    
    def is_expired(self) -> bool:
        """Check if trust has expired."""
        if not self.expires_at:
            return False
        return datetime.utcnow() > self.expires_at
    
    def is_valid(self) -> bool:
        """Check if device trust is still valid."""
        return self.is_active and not self.is_expired()
    
    @staticmethod
    def generate_fingerprint(user_agent: str, ip_prefix: str = "") -> str:
        """Generate a device fingerprint from user agent and optional IP prefix."""
        import hashlib
        data = f"{user_agent}:{ip_prefix}"
        return hashlib.sha256(data.encode()).hexdigest()[:32]


def is_device_trusted(db, user_id: int, fingerprint: str) -> bool:
    """Check if a device is trusted for a user."""
    from app.models.trusted_device import TrustedDevice
    
    device = db.query(TrustedDevice).filter(
        TrustedDevice.user_id == user_id,
        TrustedDevice.device_fingerprint == fingerprint,
        TrustedDevice.is_active == True
    ).first()
    
    if not device:
        return False
    
    if device.is_expired():
        return False
    
    # Update last used
    device.last_used_at = datetime.utcnow()
    db.commit()
    
    return True


def trust_device(db, user_id: int, fingerprint: str, device_name: str = None, 
                 user_agent: str = None, ip_address: str = None, 
                 expires_days: int = 30) -> TrustedDevice:
    """Add a device to trusted list."""
    from app.models.trusted_device import TrustedDevice
    
    # Check if already exists
    existing = db.query(TrustedDevice).filter(
        TrustedDevice.user_id == user_id,
        TrustedDevice.device_fingerprint == fingerprint
    ).first()
    
    if existing:
        existing.is_active = True
        existing.trusted_at = datetime.utcnow()
        existing.expires_at = datetime.utcnow() + timedelta(days=expires_days)
        existing.last_used_at = datetime.utcnow()
        if device_name:
            existing.device_name = device_name
        db.commit()
        return existing
    
    # Create new
    device = TrustedDevice(
        user_id=user_id,
        device_fingerprint=fingerprint,
        device_name=device_name,
        user_agent=user_agent,
        ip_address=ip_address,
        expires_at=datetime.utcnow() + timedelta(days=expires_days)
    )
    
    db.add(device)
    db.commit()
    db.refresh(device)
    
    return device


def remove_trusted_device(db, user_id: int, device_id: int) -> bool:
    """Remove a trusted device."""
    from app.models.trusted_device import TrustedDevice
    
    device = db.query(TrustedDevice).filter(
        TrustedDevice.id == device_id,
        TrustedDevice.user_id == user_id
    ).first()
    
    if device:
        db.delete(device)
        db.commit()
        return True
    return False


def cleanup_expired_devices(db) -> int:
    """Remove expired trusted devices."""
    from app.models.trusted_device import TrustedDevice
    
    result = db.query(TrustedDevice).filter(
        TrustedDevice.expires_at < datetime.utcnow()
    ).delete()
    db.commit()
    return result