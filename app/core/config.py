import os
from dotenv import load_dotenv
from datetime import timedelta

load_dotenv(".env")

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key")
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
REFRESH_TOKEN_EXPIRE_DAYS = 30
RESET_TOKEN_EXPIRE_MINUTES = 30

BASE_DIR = os.path.dirname(
    os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))
    )
)
STORAGE_PATH = os.path.join(BASE_DIR, "storage")
INDEXES_PATH = os.path.join(BASE_DIR, "indexes")

os.makedirs(STORAGE_PATH, exist_ok=True)
os.makedirs(INDEXES_PATH, exist_ok=True)