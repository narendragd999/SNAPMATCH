"""
app/api/pricing_routes.py

Public GET  /api/pricing/config     → full config (frontend fetches this)
Admin  PUT  /api/pricing/config     → update any pricing value
Admin  GET  /api/pricing/config/history → list all past configs
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional

from app.core.dependencies import get_current_user, get_db
from app.core.pricing import get_full_config
from app.models.pricing_config import PricingConfig
from app.models.user import User

router = APIRouter(prefix="/pricing", tags=["pricing"])


# ── GET /api/pricing/config ───────────────────────────────────────────────────

@router.get("/config")
def get_pricing_config(db: Session = Depends(get_db)):
    """Public — frontend fetches this on every pricing page load."""
    return get_full_config(db)


# ── PUT /api/pricing/config ───────────────────────────────────────────────────

class TierItem(BaseModel):
    bucket:     Optional[int] = None
    rate_paise: int

class ValidityItem(BaseModel):
    days:        int
    addon_paise: int
    included:    bool

class PricingConfigUpdate(BaseModel):
    # Free tier
    free_photo_quota:   Optional[int] = Field(None, ge=1,    le=10000)
    free_guest_quota:   Optional[int] = Field(None, ge=0,    le=1000)
    free_validity_days: Optional[int] = Field(None, ge=1,    le=365)

    # Paid tier limits
    min_photo_quota:    Optional[int] = Field(None, ge=1)
    max_photo_quota:    Optional[int] = Field(None, le=100000)
    min_guest_quota:    Optional[int] = Field(None, ge=0)
    max_guest_quota:    Optional[int] = Field(None, le=10000)

    # Base fee
    base_event_fee_paise: Optional[int] = Field(None, ge=0)

    # Tiers
    photo_tiers:      Optional[list[TierItem]] = None
    guest_tiers:      Optional[list[TierItem]] = None
    validity_options: Optional[list[ValidityItem]] = None


@router.put("/config")
def update_pricing_config(
    data: PricingConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin only — updates pricing config in DB."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    # Get current active row
    row = (
        db.query(PricingConfig)
        .filter(PricingConfig.is_active == True)
        .order_by(PricingConfig.id.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=404, detail="No active pricing config found")

    # Apply only the fields that were provided
    updates = data.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No values provided")

    # Convert Pydantic models to dicts for JSON columns
    if "photo_tiers" in updates:
        updates["photo_tiers"] = [t.dict() for t in data.photo_tiers]
    if "guest_tiers" in updates:
        updates["guest_tiers"] = [t.dict() for t in data.guest_tiers]
    if "validity_options" in updates:
        updates["validity_options"] = [v.dict() for v in data.validity_options]

    for field, value in updates.items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)

    return {
        "message": "Pricing config updated successfully",
        "updated_fields": list(updates.keys()),
        "config": get_full_config(db),
    }


# ── GET /api/pricing/config/history ──────────────────────────────────────────

@router.get("/config/history")
def get_pricing_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin only — returns all pricing config rows for audit trail."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    rows = db.query(PricingConfig).order_by(PricingConfig.id.desc()).all()
    return [
        {
            "id":                    r.id,
            "is_active":             r.is_active,
            "free_photo_quota":      r.free_photo_quota,
            "free_guest_quota":      r.free_guest_quota,
            "free_validity_days":    r.free_validity_days,
            "base_event_fee_paise":  r.base_event_fee_paise,
            "updated_at":            r.updated_at.isoformat() if r.updated_at else None,
            "created_at":            r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
