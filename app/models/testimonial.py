"""
app/models/testimonial.py

Customer testimonials for landing page.
Admin can add, edit, reorder, and toggle visibility.
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.sql import func
from app.database.db import Base


class Testimonial(Base):
    __tablename__ = "testimonials"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    role = Column(String(100), nullable=False)
    company = Column(String(100), nullable=True)
    text = Column(Text, nullable=False)
    rating = Column(Integer, default=5)  # 1-5 stars
    avatar_url = Column(String(500), nullable=True)
    verified = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
