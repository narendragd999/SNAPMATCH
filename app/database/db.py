from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)

#DATABASE_URL = "postgresql://postgres:admin123@localhost:5432/event_ai"


engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


# ✅ THIS is the correct dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
