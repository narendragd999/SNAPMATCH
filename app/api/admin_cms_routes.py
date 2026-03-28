"""
app/api/admin_cms_routes.py

Admin endpoints for managing CMS content:
- Testimonials CRUD
- FAQs CRUD
- Newsletter subscribers list

All endpoints require admin authentication.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List

from app.core.dependencies import get_current_user, get_db
from app.models.testimonial import Testimonial
from app.models.faq import FAQ
from app.models.newsletter import NewsletterSubscriber
from app.models.user import User

router = APIRouter(prefix="/admin/cms", tags=["admin-cms"])


# ─────────────────────────────────────────────────────────────────────────────
# TESTIMONIALS ADMIN
# ─────────────────────────────────────────────────────────────────────────────

class TestimonialCreate(BaseModel):
    name: str = Field(..., max_length=100)
    role: str = Field(..., max_length=100)
    company: Optional[str] = Field(None, max_length=100)
    text: str = Field(..., max_length=1000)
    rating: int = Field(default=5, ge=1, le=5)
    avatar_url: Optional[str] = Field(None, max_length=500)
    verified: bool = False
    sort_order: int = 0
    is_active: bool = True


class TestimonialUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    role: Optional[str] = Field(None, max_length=100)
    company: Optional[str] = Field(None, max_length=100)
    text: Optional[str] = Field(None, max_length=1000)
    rating: Optional[int] = Field(None, ge=1, le=5)
    avatar_url: Optional[str] = Field(None, max_length=500)
    verified: Optional[bool] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


@router.get("/testimonials")
def list_testimonials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all testimonials (including inactive). Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    testimonials = (
        db.query(Testimonial)
        .order_by(Testimonial.sort_order.asc(), Testimonial.created_at.desc())
        .all()
    )
    return [
        {
            "id": t.id,
            "name": t.name,
            "role": t.role,
            "company": t.company,
            "text": t.text,
            "rating": t.rating,
            "avatar_url": t.avatar_url,
            "verified": t.verified,
            "sort_order": t.sort_order,
            "is_active": t.is_active,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in testimonials
    ]


@router.post("/testimonials")
def create_testimonial(
    data: TestimonialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new testimonial. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    testimonial = Testimonial(**data.dict())
    db.add(testimonial)
    db.commit()
    db.refresh(testimonial)

    return {"message": "Testimonial created", "id": testimonial.id}


@router.put("/testimonials/{testimonial_id}")
def update_testimonial(
    testimonial_id: int,
    data: TestimonialUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a testimonial. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    testimonial = db.query(Testimonial).filter(Testimonial.id == testimonial_id).first()
    if not testimonial:
        raise HTTPException(status_code=404, detail="Testimonial not found")

    updates = data.dict(exclude_none=True)
    for field, value in updates.items():
        setattr(testimonial, field, value)

    db.commit()
    return {"message": "Testimonial updated"}


@router.delete("/testimonials/{testimonial_id}")
def delete_testimonial(
    testimonial_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a testimonial. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    testimonial = db.query(Testimonial).filter(Testimonial.id == testimonial_id).first()
    if not testimonial:
        raise HTTPException(status_code=404, detail="Testimonial not found")

    db.delete(testimonial)
    db.commit()
    return {"message": "Testimonial deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# FAQ ADMIN
# ─────────────────────────────────────────────────────────────────────────────

class FAQCreate(BaseModel):
    question: str = Field(..., max_length=500)
    answer: str = Field(..., max_length=2000)
    category: Optional[str] = Field(None, max_length=50)
    sort_order: int = 0
    is_active: bool = True


class FAQUpdate(BaseModel):
    question: Optional[str] = Field(None, max_length=500)
    answer: Optional[str] = Field(None, max_length=2000)
    category: Optional[str] = Field(None, max_length=50)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


@router.get("/faqs")
def list_faqs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all FAQs (including inactive). Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    faqs = (
        db.query(FAQ)
        .order_by(FAQ.sort_order.asc(), FAQ.created_at.asc())
        .all()
    )
    return [
        {
            "id": f.id,
            "question": f.question,
            "answer": f.answer,
            "category": f.category,
            "sort_order": f.sort_order,
            "is_active": f.is_active,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in faqs
    ]


@router.post("/faqs")
def create_faq(
    data: FAQCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new FAQ. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    faq = FAQ(**data.dict())
    db.add(faq)
    db.commit()
    db.refresh(faq)

    return {"message": "FAQ created", "id": faq.id}


@router.put("/faqs/{faq_id}")
def update_faq(
    faq_id: int,
    data: FAQUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an FAQ. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    faq = db.query(FAQ).filter(FAQ.id == faq_id).first()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found")

    updates = data.dict(exclude_none=True)
    for field, value in updates.items():
        setattr(faq, field, value)

    db.commit()
    return {"message": "FAQ updated"}


@router.delete("/faqs/{faq_id}")
def delete_faq(
    faq_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an FAQ. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    faq = db.query(FAQ).filter(FAQ.id == faq_id).first()
    if not faq:
        raise HTTPException(status_code=404, detail="FAQ not found")

    db.delete(faq)
    db.commit()
    return {"message": "FAQ deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# NEWSLETTER ADMIN
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/newsletter")
def list_newsletter_subscribers(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List newsletter subscribers. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    total = db.query(NewsletterSubscriber).count()
    active = db.query(NewsletterSubscriber).filter(NewsletterSubscriber.is_active == True).count()

    subscribers = (
        db.query(NewsletterSubscriber)
        .order_by(NewsletterSubscriber.subscribed_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "total": total,
        "active": active,
        "page": page,
        "page_size": page_size,
        "subscribers": [
            {
                "id": s.id,
                "email": s.email,
                "source": s.source,
                "is_active": s.is_active,
                "subscribed_at": s.subscribed_at.isoformat() if s.subscribed_at else None,
                "unsubscribed_at": s.unsubscribed_at.isoformat() if s.unsubscribed_at else None,
            }
            for s in subscribers
        ],
    }


@router.get("/newsletter/export")
def export_newsletter_emails(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export all active subscriber emails as plain text. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    subscribers = (
        db.query(NewsletterSubscriber.email)
        .filter(NewsletterSubscriber.is_active == True)
        .order_by(NewsletterSubscriber.subscribed_at.desc())
        .all()
    )

    emails = [s[0] for s in subscribers]
    return {"emails": emails, "count": len(emails)}