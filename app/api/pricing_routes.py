"""
app/api/pricing_routes.py

Public  GET  /pricing/config          → full config (frontend fetches on every load)
Public  GET  /pricing/plans           → formatted plans for landing page pricing section
Admin   PUT  /pricing/config          → update any pricing value
Admin   GET  /pricing/config/history  → list all past config rows (audit trail)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional, List

from app.core.dependencies import get_current_user, get_db
from app.core.pricing import get_full_config, calculate_price, format_inr, _get_active
from app.models.pricing_config import PricingConfig
from app.models.user import User

router = APIRouter(prefix="/pricing", tags=["pricing"])


# ── GET /pricing/config ───────────────────────────────────────────────────────

@router.get("/config")
def get_pricing_config(db: Session = Depends(get_db)):
    """
    Public — no auth required.
    Frontend fetches this once per session and caches in module scope.
    Returns the same shape that billing_routes.get_price_config() previously did,
    plus free_tier and paid_tier limits so the frontend can build sliders
    without hardcoding any limits.
    """
    return get_full_config(db)


# ── GET /pricing/plans ────────────────────────────────────────────────────────

@router.get("/plans")
def get_pricing_plans(db: Session = Depends(get_db)):
    """
    Public — no auth required.
    Returns formatted pricing plans for the landing page.
    All values are dynamically loaded from the pricing_config table.
    """
    config = _get_active(db)
    
    # Build free tier plan
    free_plan = {
        "name": "Free",
        "price": "₹0",
        "period": "",
        "badge": "",
        "desc": "Try SnapFind risk-free on your first event",
        "features": [
            {"text": "1 event included", "included": True},
            {"text": f"Up to {config.free_photo_quota} photos", "included": True},
            {"text": "AI face search for guests", "included": True},
            {"text": "Individual photo download", "included": True},
            {"text": "Guest portal with share link", "included": True},
            {"text": "PIN protection", "included": True},
            {"text": f"{config.free_validity_days}-day cloud storage", "included": True},
            {"text": "Bulk ZIP download", "included": True},
            {"text": "Watermarking", "included": True},
            {"text": "AI scene & object tags", "included": True},
        ],
        "cta": "Start Free",
        "href": "/login?mode=register",
        "highlight": False,
    }
    
    # Add guest upload feature if free tier has guest quota
    if config.free_guest_quota > 0:
        free_plan["features"].insert(
            -1,  # Before watermarking
            {"text": f"Guest upload portal ({config.free_guest_quota} slots)", "included": True}
        )
    
    # Calculate example pricing for pay-per-event
    # Show a mid-range example: 500 photos, 50 guest uploads, 30 days
    example_photos = min(500, config.max_photo_quota)
    example_guests = min(50, config.max_guest_quota)
    example_validity = 30
    example_total_inr = None
    
    try:
        example_price = calculate_price(
            photo_quota=example_photos,
            guest_quota=example_guests,
            validity_days=example_validity,
            db=db
        )
        starting_price = format_inr(example_price["total_paise"])
        example_total_inr = example_price["total_inr"]
    except Exception:
        starting_price = "Custom"
    
    # Build pay-per-event plan
    pay_per_event_plan = {
        "name": "Pay Per Event",
        "price": "Custom",
        "period": "",
        "badge": "MOST POPULAR",
        "desc": f"Build exactly what your event needs — starting from {starting_price}",
        "features": [
            {"text": f"{config.min_photo_quota}–{config.max_photo_quota:,} photos (slider)", "included": True},
            {"text": f"Storage: 30–365 days", "included": True},
            {"text": f"Guest upload portal (optional, up to {config.max_guest_quota:,} slots)", "included": True},
            {"text": "Bulk ZIP download", "included": True},
            {"text": "AI face search + clustering", "included": True},
            {"text": "AI scene & object tags", "included": True},
            {"text": "Custom watermarking", "included": True},
            {"text": "PIN protection", "included": True},
            {"text": "Priority support", "included": True},
            {"text": "Extended cloud storage", "included": True},
        ],
        "cta": "Configure Your Event",
        "href": "/pricing",
        "highlight": True,
        "config": {
            "minPhotoQuota": config.min_photo_quota,
            "maxPhotoQuota": config.max_photo_quota,
            "minGuestQuota": config.min_guest_quota,
            "maxGuestQuota": config.max_guest_quota,
            "baseEventFee": config.base_event_fee_paise,
            "photoTiers": config.photo_tiers,
            "guestTiers": config.guest_tiers,
            "validityOptions": config.validity_options,
            "examplePrice": {
                "photos": example_photos,
                "guests": example_guests,
                "validityDays": example_validity,
                "totalInr": example_total_inr,
            }
        }
    }
    
    return {
        "plans": [free_plan, pay_per_event_plan],
        "currency": "INR",
        "symbol": "₹",
    }


# ── PUT /pricing/config ───────────────────────────────────────────────────────

class TierItem(BaseModel):
    bucket:     Optional[int] = None
    rate_paise: int = Field(..., ge=0)

class ValidityItem(BaseModel):
    days:        int = Field(..., ge=1)
    addon_paise: int = Field(..., ge=0)
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

    # Tiers (full replacement when provided)
    photo_tiers:      Optional[list[TierItem]] = None
    guest_tiers:      Optional[list[TierItem]] = None
    validity_options: Optional[list[ValidityItem]] = None


@router.put("/config")
def update_pricing_config(
    data: PricingConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Admin only — updates pricing config in DB (in-place on the active row).
    Only fields explicitly provided are updated; omitted fields are unchanged.
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    row = (
        db.query(PricingConfig)
        .filter(PricingConfig.is_active == True)
        .order_by(PricingConfig.id.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=404, detail="No active pricing config found. Run migrations first.")

    updates = data.dict(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No values provided to update")

    # Convert Pydantic tier models to plain dicts for JSON columns
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
        "message": "Pricing config updated",
        "updated_fields": list(updates.keys()),
        "config": get_full_config(db),
    }


# ── GET /pricing/config/history ───────────────────────────────────────────────

@router.get("/config/history")
def get_pricing_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin only — returns all pricing config rows ordered newest first."""
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
            "min_photo_quota":       r.min_photo_quota,
            "max_photo_quota":       r.max_photo_quota,
            "base_event_fee_paise":  r.base_event_fee_paise,
            "photo_tiers":           r.photo_tiers,
            "guest_tiers":           r.guest_tiers,
            "validity_options":      r.validity_options,
            "updated_at":            r.updated_at.isoformat() if r.updated_at else None,
            "created_at":            r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]