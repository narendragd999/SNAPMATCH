"""
app/api/cms_routes.py

Public CMS endpoints for landing page content.
- Testimonials
- FAQs
- Newsletter subscription

All endpoints are public (no auth required).
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List

from app.core.dependencies import get_db
from app.models.testimonial import Testimonial
from app.models.faq import FAQ
from app.models.newsletter import NewsletterSubscriber

router = APIRouter(prefix="/cms", tags=["cms"])


# ─────────────────────────────────────────────────────────────────────────────
# TESTIMONIALS
# ─────────────────────────────────────────────────────────────────────────────

class TestimonialResponse(BaseModel):
    id: int
    name: str
    role: str
    company: Optional[str] = None
    text: str
    rating: int
    avatar_url: Optional[str] = None
    verified: bool

    class Config:
        from_attributes = True


@router.get("/testimonials", response_model=List[TestimonialResponse])
def get_testimonials(db: Session = Depends(get_db)):
    """
    Get all active testimonials for landing page.
    Ordered by sort_order, then by created_at desc.
    """
    testimonials = (
        db.query(Testimonial)
        .filter(Testimonial.is_active == True)
        .order_by(Testimonial.sort_order.asc(), Testimonial.created_at.desc())
        .all()
    )
    return testimonials


# ─────────────────────────────────────────────────────────────────────────────
# FAQs
# ─────────────────────────────────────────────────────────────────────────────

class FAQResponse(BaseModel):
    id: int
    question: str
    answer: str
    category: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/faqs", response_model=List[FAQResponse])
def get_faqs(db: Session = Depends(get_db)):
    """
    Get all active FAQs for landing page.
    Ordered by sort_order, then by category.
    """
    faqs = (
        db.query(FAQ)
        .filter(FAQ.is_active == True)
        .order_by(FAQ.sort_order.asc(), FAQ.created_at.asc())
        .all()
    )
    return faqs


# ─────────────────────────────────────────────────────────────────────────────
# NEWSLETTER
# ─────────────────────────────────────────────────────────────────────────────

class NewsletterSubscribe(BaseModel):
    email: EmailStr
    source: str = Field(default="landing_page", max_length=50)


class NewsletterResponse(BaseModel):
    success: bool
    message: str


@router.post("/newsletter/subscribe", response_model=NewsletterResponse)
def subscribe_newsletter(
    data: NewsletterSubscribe,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Subscribe an email to the newsletter.
    Returns success even if already subscribed (idempotent).
    """
    # Check if already subscribed
    existing = db.query(NewsletterSubscriber).filter(
        NewsletterSubscriber.email == data.email.lower()
    ).first()

    if existing:
        if existing.is_active:
            return {"success": True, "message": "Already subscribed!"}
        else:
            # Reactivate if previously unsubscribed
            existing.is_active = True
            existing.unsubscribed_at = None
            existing.source = data.source
            db.commit()
            return {"success": True, "message": "Welcome back! You're subscribed again."}

    # Get IP and user agent
    ip_address = None
    if request:
        forwarded_for = request.headers.get("x-forwarded-for")
        ip_address = (
            forwarded_for.split(",")[0].strip()
            if forwarded_for
            else (str(request.client.host) if request.client else None)
        )

    user_agent = request.headers.get("user-agent", "")[:500] if request else None

    # Create new subscriber
    subscriber = NewsletterSubscriber(
        email=data.email.lower(),
        source=data.source,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(subscriber)
    db.commit()

    return {"success": True, "message": "Thanks for subscribing! You'll hear from us soon."}


@router.post("/newsletter/unsubscribe", response_model=NewsletterResponse)
def unsubscribe_newsletter(
    data: NewsletterSubscribe,
    db: Session = Depends(get_db)
):
    """
    Unsubscribe an email from the newsletter.
    """
    subscriber = db.query(NewsletterSubscriber).filter(
        NewsletterSubscriber.email == data.email.lower(),
        NewsletterSubscriber.is_active == True
    ).first()

    if not subscriber:
        return {"success": True, "message": "You're not subscribed."}

    from datetime import datetime
    subscriber.is_active = False
    subscriber.unsubscribed_at = datetime.utcnow()
    db.commit()

    return {"success": True, "message": "You've been unsubscribed. Sorry to see you go!"}
