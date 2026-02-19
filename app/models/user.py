from sqlalchemy import Column, Integer, String, DateTime
from app.database.db import Base
from datetime import datetime


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="owner")
    plan_type = Column(String, default="free")
    created_at = Column(DateTime, default=datetime.utcnow)
