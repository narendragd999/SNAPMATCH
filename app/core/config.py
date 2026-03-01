"""
app/core/config.py

Central configuration. STORAGE_PATH and INDEXES_PATH still exist as
local filesystem paths — they are used by:
  - INDEXES_PATH: FAISS index files (always local, never in object store)
  - STORAGE_PATH:  only used by image_pipeline as a TEMP working directory
                   when STORAGE_BACKEND != local; final files go to MinIO/R2.

For the actual photo/thumbnail storage, use app.services.storage_service.
"""
import os
from dotenv import load_dotenv

load_dotenv(".env")

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key")
ALGORITHM  = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7   # 7 days
REFRESH_TOKEN_EXPIRE_DAYS   = 30
RESET_TOKEN_EXPIRE_MINUTES  = 30

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STORAGE_PATH = os.getenv("STORAGE_PATH", os.path.join(BASE_DIR, "storage"))
INDEXES_PATH = os.getenv("INDEXES_PATH", os.path.join(BASE_DIR, "indexes"))

# Always create these directories — used for local backend and temp files
os.makedirs(STORAGE_PATH, exist_ok=True)
os.makedirs(INDEXES_PATH, exist_ok=True)
