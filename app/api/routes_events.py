from fastapi import APIRouter
from app.database.db import SessionLocal
from app.models.event import Event
import os

router = APIRouter()



