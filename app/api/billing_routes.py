"""
app/api/billing_routes.py

Pay-Per-Event billing — Razorpay integration.

Endpoints:
  GET  /billing/price-config          → full pricing config (delegates to get_full_config)
  POST /billing/calculate-price       → calculate price for given config
  POST /billing/create-event-order    → create Razorpay order + pending event
  POST /billing/verify-payment        → verify signature, activate event
  POST /billing/create-free-event     → create free-tier event (one per user)
  POST /billing/webhook               → Razorpay webhook (backup verification)
  GET  /billing/my-orders             → current user's order history
  GET  /billing/event-quota/{event_id} → quota usage for an event
  GET  /billing/user-status           → billing status for dashboard banner
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, validator
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db
from app.core.pricing import (
    get_free_tier_config,
    get_full_config,
    VALID_VALIDITY_DAYS,
    MIN_PHOTO_QUOTA,
    MAX_PHOTO_QUOTA,
    MIN_GUEST_QUOTA,
    MAX_GUEST_QUOTA,
    calculate_price,
    format_inr,
)
from app.core.razorpay_config import get_razorpay_client
from app.core.config import DEFAULT_EVENT_PIN
from app.models.event import Event
from app.models.event_order import EventOrder
from app.models.user import User

router = APIRouter(prefix="/billing", tags=["billing"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────
# Field ge/le use module-level _DEFAULTS constants — acceptable for schema
# definition at import time. Live DB limits are re-validated inside the handler.

class CalculatePriceRequest(BaseModel):
    photo_quota:   int = Field(..., ge=MIN_PHOTO_QUOTA, le=MAX_PHOTO_QUOTA)
    guest_quota:   int = Field(0, ge=MIN_GUEST_QUOTA, le=MAX_GUEST_QUOTA)
    validity_days: int = Field(30)

    @validator("validity_days")
    def valid_validity(cls, v):
        if v not in VALID_VALIDITY_DAYS:
            raise ValueError(f"validity_days must be one of {VALID_VALIDITY_DAYS}")
        return v


class CreateEventOrderRequest(BaseModel):
    event_name:    str = Field(..., min_length=2, max_length=100)
    description:   str = Field("", max_length=500)
    photo_quota:   int = Field(..., ge=MIN_PHOTO_QUOTA, le=MAX_PHOTO_QUOTA)
    guest_quota:   int = Field(0, ge=MIN_GUEST_QUOTA, le=MAX_GUEST_QUOTA)
    validity_days: int = Field(30)

    @validator("validity_days")
    def valid_validity(cls, v):
        if v not in VALID_VALIDITY_DAYS:
            raise ValueError(f"validity_days must be one of {VALID_VALIDITY_DAYS}")
        return v

    @validator("event_name")
    def clean_event_name(cls, v):
        return v.strip()


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id:   str
    razorpay_payment_id: str
    razorpay_signature:  str
    event_id:            int


class CreateFreeEventRequest(BaseModel):
    event_name:  str = Field(..., min_length=2, max_length=100)
    description: str = Field("", max_length=500)

    @validator("event_name")
    def clean_event_name(cls, v):
        return v.strip()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_slug(name: str, db: Session) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50]
    slug = base
    counter = 1
    while db.query(Event).filter(Event.slug == slug).first():
        slug = f"{base}-{counter}"
        counter += 1
    return slug


def _activate_event(event: Event, db: Session) -> None:
    event.expires_at = datetime.utcnow() + timedelta(days=event.validity_days)
    db.commit()


def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    secret = os.getenv("RAZORPAY_KEY_SECRET", "")
    payload = f"{order_id}|{payment_id}"
    expected = hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── GET /billing/price-config ─────────────────────────────────────────────────

@router.get("/price-config")
def get_price_config(db: Session = Depends(get_db)):
    """
    Returns full pricing config from DB.
    No auth required — powers the public /pricing page.
    Delegates to get_full_config() which reads the pricing_config table.
    """
    return get_full_config(db)


# ── POST /billing/calculate-price ────────────────────────────────────────────

@router.post("/calculate-price")
def calculate_price_endpoint(
    body: CalculatePriceRequest,
    db: Session = Depends(get_db),
):
    """
    Calculate price for a given (photo_quota, guest_quota, validity_days) combo.
    No auth required — called live by the slider on the pricing/create page.
    Uses live DB config so any admin price change is immediately reflected.
    """
    try:
        breakdown = calculate_price(
            photo_quota=body.photo_quota,
            guest_quota=body.guest_quota,
            validity_days=body.validity_days,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        **breakdown,
        "formatted": {
            "base_fee":       format_inr(breakdown["base_fee_paise"]),
            "photo_total":    format_inr(breakdown["photo_total_paise"]),
            "guest_total":    format_inr(breakdown["guest_total_paise"]),
            "validity_addon": format_inr(breakdown["validity_addon_paise"]),
            "total":          format_inr(breakdown["total_paise"]),
        },
    }


# ── POST /billing/create-event-order ─────────────────────────────────────────

@router.post("/create-event-order")
def create_event_order(
    body:         CreateEventOrderRequest,
    current_user: User = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    """
    Step 1 of the payment flow:
      1. Calculate price (using live DB config)
      2. Create a pending Event in the DB
      3. Create a Razorpay order
      4. Create an EventOrder record
      5. Return order details to frontend (to open Razorpay checkout)
    """
    try:
        breakdown = calculate_price(
            photo_quota=body.photo_quota,
            guest_quota=body.guest_quota,
            validity_days=body.validity_days,
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    amount_paise = breakdown["total_paise"]

    slug         = _make_slug(body.event_name, db)
    public_token = Event.generate_token()

    event = Event(
        name=body.event_name,
        description=body.description,
        slug=slug,
        public_token=public_token,
        owner_id=current_user.id,
        photo_quota=body.photo_quota,
        guest_quota=body.guest_quota,
        validity_days=body.validity_days,
        is_free_tier=False,
        payment_status="pending",
        amount_paid_paise=amount_paise,
        guest_upload_enabled=True,
        public_status="active",
    )
    db.add(event)
    db.flush()
    event.set_pin(DEFAULT_EVENT_PIN)

    client = get_razorpay_client()
    rz_order = client.order.create({
        "amount":          amount_paise,
        "currency":        "INR",
        "payment_capture": 1,
        "notes": {
            "user_id":       str(current_user.id),
            "event_id":      str(event.id),
            "event_name":    body.event_name,
            "photo_quota":   str(body.photo_quota),
            "guest_quota":   str(body.guest_quota),
            "validity_days": str(body.validity_days),
        },
    })

    event.payment_order_id = rz_order["id"]

    order = EventOrder(
        user_id=current_user.id,
        event_id=event.id,
        razorpay_order_id=rz_order["id"],
        amount_paise=amount_paise,
        photo_quota=body.photo_quota,
        guest_quota=body.guest_quota,
        validity_days=body.validity_days,
        event_name=body.event_name,
        status="created",
    )
    db.add(order)
    db.commit()

    return {
        "order_id":      rz_order["id"],
        "razorpay_key":  os.getenv("RAZORPAY_KEY_ID"),
        "amount_paise":  amount_paise,
        "amount_inr":    breakdown["total_inr"],
        "currency":      "INR",
        "event_id":      event.id,
        "event_name":    body.event_name,
        "event_slug":    slug,
        "breakdown":     breakdown,
        "prefill_email": current_user.email,
    }


# ── POST /billing/verify-payment ─────────────────────────────────────────────

@router.post("/verify-payment")
def verify_payment(
    body:         VerifyPaymentRequest,
    current_user: User = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    event = db.query(Event).filter(
        Event.id == body.event_id,
        Event.owner_id == current_user.id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.payment_status == "paid":
        return {
            "success":    True,
            "event_id":   event.id,
            "event_slug": event.slug,
            "message":    "Already activated",
        }

    env = os.getenv("ENV", "prod")
    if env != "dev":
        if not _verify_razorpay_signature(
            body.razorpay_order_id,
            body.razorpay_payment_id,
            body.razorpay_signature,
        ):
            raise HTTPException(status_code=400, detail="Payment signature verification failed")

    event.payment_id     = body.razorpay_payment_id
    event.payment_status = "paid"
    _activate_event(event, db)

    order = db.query(EventOrder).filter(
        EventOrder.razorpay_order_id == body.razorpay_order_id,
    ).first()
    if order:
        order.razorpay_payment_id = body.razorpay_payment_id
        order.razorpay_signature  = body.razorpay_signature
        order.status              = "paid"
        order.paid_at             = datetime.utcnow()

    if current_user.plan_type == "free":
        current_user.plan_type = "pay_per_event"

    db.commit()

    return {
        "success":    True,
        "event_id":   event.id,
        "event_slug": event.slug,
        "expires_at": event.expires_at.isoformat() if event.expires_at else None,
        "message":    "Event activated successfully",
    }


# ── POST /billing/create-free-event ──────────────────────────────────────────

@router.post("/create-free-event")
def create_free_event(
    body:         CreateFreeEventRequest,
    current_user: User = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    if current_user.free_event_used:
        raise HTTPException(
            status_code=400,
            detail="You have already used your free event. Please purchase a new event.",
        )

    slug         = _make_slug(body.event_name, db)
    public_token = Event.generate_token()
    cfg          = get_free_tier_config(db)  # reads live values from pricing_config table

    event = Event(
        name=body.event_name,
        description=body.description,
        slug=slug,
        public_token=public_token,
        owner_id=current_user.id,
        photo_quota=cfg["photo_quota"],
        guest_quota=cfg["guest_quota"],
        validity_days=cfg["validity_days"],
        expires_at=datetime.utcnow() + timedelta(days=cfg["validity_days"]),
        is_free_tier=True,
        payment_status="free",
        amount_paid_paise=0,
        guest_upload_enabled=True,
        public_status="active",
    )
    db.add(event)
    db.flush()
    event.set_pin(DEFAULT_EVENT_PIN)

    # Create EventOrder record for free event (for admin tracking)
    order = EventOrder(
        user_id=current_user.id,
        event_id=event.id,
        razorpay_order_id=None,  # No Razorpay order for free events
        amount_paise=0,
        photo_quota=cfg["photo_quota"],
        guest_quota=cfg["guest_quota"],
        validity_days=cfg["validity_days"],
        event_name=body.event_name,
        status="free",  # Special status for free events
        paid_at=datetime.utcnow(),  # Mark as "paid" immediately
    )
    db.add(order)

    current_user.free_event_used = True

    db.commit()
    db.refresh(event)

    return {
        "success":       True,
        "event_id":      event.id,
        "event_slug":    event.slug,
        "photo_quota":   event.photo_quota,
        "guest_quota":   event.guest_quota,
        "validity_days": event.validity_days,
        "expires_at":    event.expires_at.isoformat(),
        "message":       "Free event created successfully",
    }


# ── POST /billing/webhook ─────────────────────────────────────────────────────

@router.post("/webhook")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    body_bytes     = await request.body()
    webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    env            = os.getenv("ENV", "prod")

    if env != "dev" and webhook_secret:
        received_sig = request.headers.get("x-razorpay-signature", "")
        expected_sig = hmac.new(
            webhook_secret.encode("utf-8"),
            body_bytes,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected_sig, received_sig):
            raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = payload.get("event", "")
    entity     = payload.get("payload", {}).get("payment", {}).get("entity", {})

    if event_type in ("payment.captured", "order.paid"):
        rzp_order_id   = entity.get("order_id") or payload.get("payload", {}).get("order", {}).get("entity", {}).get("id")
        rzp_payment_id = entity.get("id")
        notes          = entity.get("notes", {})
        event_id_str   = notes.get("event_id")

        if not event_id_str or not rzp_order_id:
            return {"status": "ignored", "reason": "missing event_id or order_id"}

        db_event = db.query(Event).filter(Event.id == int(event_id_str)).first()
        if db_event and db_event.payment_status != "paid":
            db_event.payment_id     = rzp_payment_id
            db_event.payment_status = "paid"
            _activate_event(db_event, db)

        order = db.query(EventOrder).filter(
            EventOrder.razorpay_order_id == rzp_order_id
        ).first()
        if order and order.status != "paid":
            order.razorpay_payment_id = rzp_payment_id
            order.status              = "paid"
            order.paid_at             = datetime.utcnow()

        if db_event:
            user = db.query(User).filter(User.id == db_event.owner_id).first()
            if user and user.plan_type == "free":
                user.plan_type = "pay_per_event"

        db.commit()
        return {"status": "processed", "event": "payment.captured"}

    elif event_type == "payment.failed":
        rzp_order_id = entity.get("order_id")
        if rzp_order_id:
            order = db.query(EventOrder).filter(
                EventOrder.razorpay_order_id == rzp_order_id
            ).first()
            if order:
                order.status = "failed"

            db_event = db.query(Event).filter(
                Event.payment_order_id == rzp_order_id
            ).first()
            if db_event and db_event.payment_status == "pending":
                db_event.payment_status = "failed"

            db.commit()
        return {"status": "processed", "event": "payment.failed"}

    return {"status": "ignored", "event": event_type}


# ── GET /billing/my-orders ────────────────────────────────────────────────────

@router.get("/my-orders")
def my_orders(
    current_user: User = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    orders = (
        db.query(EventOrder)
        .filter(EventOrder.user_id == current_user.id)
        .order_by(EventOrder.created_at.desc())
        .all()
    )
    return {
        "orders": [
            {
                "id":                  o.id,
                "event_id":            o.event_id,
                "event_name":          o.event_name,
                "razorpay_order_id":   o.razorpay_order_id,
                "razorpay_payment_id": o.razorpay_payment_id,
                "amount_paise":        o.amount_paise,
                "amount_inr":          o.amount_paise / 100,
                "amount_formatted":    format_inr(o.amount_paise),
                "photo_quota":         o.photo_quota,
                "guest_quota":         o.guest_quota,
                "validity_days":       o.validity_days,
                "status":              o.status,
                "created_at":          o.created_at.isoformat(),
                "paid_at":             o.paid_at.isoformat() if o.paid_at else None,
            }
            for o in orders
        ]
    }


# ── GET /billing/event-quota/{event_id} ──────────────────────────────────────

@router.get("/event-quota/{event_id}")
def event_quota(
    event_id:     int,
    current_user: User = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    event = db.query(Event).filter(
        Event.id == event_id,
        Event.owner_id == current_user.id,
    ).first()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    return {
        "event_id":         event.id,
        "event_name":       event.name,
        "photo_quota":      event.photo_quota,
        "photos_used":      event.image_count,
        "photos_remaining": max(0, event.photo_quota - event.image_count),
        "photo_pct":        round((event.image_count / max(event.photo_quota, 1)) * 100, 1),
        "guest_quota":      event.guest_quota,
        "guest_used":       event.guest_uploads_used,
        "guest_remaining":  event.guest_quota_remaining,
        "guest_pct":        round((event.guest_uploads_used / max(event.guest_quota, 1)) * 100, 1) if event.guest_quota else 0,
        "guest_enabled":    event.guest_upload_enabled,
        "validity_days":    event.validity_days,
        "is_free_tier":     event.is_free_tier,
        "payment_status":   event.payment_status,
        "expires_at":       event.expires_at.isoformat() if event.expires_at else None,
        "is_expired":       bool(event.expires_at and datetime.utcnow() > event.expires_at),
    }


# ── GET /billing/user-status ──────────────────────────────────────────────────

@router.get("/user-status")
def user_billing_status(
    current_user: User = Depends(get_current_user),
    db:           Session = Depends(get_db),
):
    active_events = db.query(Event).filter(
        Event.owner_id == current_user.id,
        Event.payment_status.in_(["paid", "free"]),
    ).count()

    return {
        "free_event_available": not current_user.free_event_used,
        "free_event_used":      current_user.free_event_used,
        "plan_type":            current_user.plan_type,
        "active_events":        active_events,
    }