from sqlalchemy import Column, String
from app.database.db import Base

class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key   = Column(String, primary_key=True)
    value = Column(String, nullable=False)