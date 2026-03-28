"""
app/main.py

FastAPI application entry point.

Changes from previous version:
  - Added import of EventOrder model so Base.metadata.create_all() picks it up
  - Added lifespan startup hook that calls storage_service.init_storage() so
    the MinIO bucket (+ public-read policy + CORS) is created before any
    request arrives. Without this, the first presigned PUT on a fresh container
    returns 404 because the bucket doesn't exist yet.
  - All other routers unchanged
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env")

from app.database.db import Base, engine

# ── Model imports (required so metadata is populated) ─────────────────────────
from app.models import event, cluster
from app.models.user        import User          # noqa: F401
from app.models.event       import Event         # noqa: F401
from app.models.event_order import EventOrder    # noqa: F401
from app.models.photo       import Photo         # noqa: F401
from app.models.cluster        import Cluster        # noqa: F401
from app.models.pricing_config import PricingConfig  # noqa: F401
from app.models.event_analytics import EventAnalytics, EventAnalyticsTotal  # noqa: F401
from app.models.user_activity_log import UserActivityLog  # noqa: F401
from app.models.email_provider_config import EmailProviderConfig  # noqa: F401
from app.models.otp import OTPVerification  # noqa: F401

# ── Router imports ────────────────────────────────────────────────────────────
from app.api.auth_routes        import router as auth_router
from app.api.event_routes       import router as event_router
from app.api.upload_routes      import router as upload_router
from app.api.bulk_upload_routes import router as bulk_upload_router
from app.api.public_routes      import router as public_router
from app.api.billing_routes     import router as billing_router
from app.api.task_routes        import router as task_router
from app.api.approval_routes    import router as approval_router
from app.api.admin_routes       import router as admin_router
from app.api.admin_orders_routes import router as admin_orders_router
from app.api.guest_upload_routes import router as guest_upload_router
from app.api.pricing_routes     import router as pricing_router
from app.api.analytics_routes   import router as analytics_router
from app.api.cms_routes         import router as cms_router
from app.api.admin_cms_routes   import router as admin_cms_router
from app.api.admin_email_routes import router as admin_email_router

# ── Storage service ───────────────────────────────────────────────────────────
from app.services import storage_service


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup tasks run here before the server starts accepting requests.

    init_storage() is safe to call on every startup:
      - local:  creates the storage directory tree if missing
      - minio:  creates bucket + public-read policy + CORS (idempotent head_bucket check)
      - r2:     no-op

    This guarantees the MinIO bucket exists before any /presign endpoint is
    called. Without it, a fresh container returns 404 on the first presigned PUT
    because the bucket hasn't been created yet.
    """
    try:
        storage_service.init_storage()
    except Exception as exc:
        # Log but don't crash — bucket may already exist or be unreachable
        # during local dev when STORAGE_BACKEND=local (no boto3 needed).
        print(f"[startup] storage init warning: {exc}")

    yield  # server runs here

    # Shutdown — nothing to clean up


app = FastAPI(title="SnapFind AI", lifespan=lifespan)

# ── CORS ──────────────────────────────────────────────────────────────────────
raw_origins     = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
allowed_origins = [o.strip() for o in raw_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static file serving (local backend only) ──────────────────────────────────
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()

if STORAGE_BACKEND == "local":
    from fastapi.staticfiles import StaticFiles
    from app.core.config import STORAGE_PATH
    app.mount("/storage", StaticFiles(directory=STORAGE_PATH), name="storage")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(event_router)
app.include_router(upload_router)
app.include_router(bulk_upload_router)
app.include_router(public_router)
app.include_router(billing_router)
app.include_router(task_router)
app.include_router(approval_router)
app.include_router(admin_router)
app.include_router(admin_orders_router)
app.include_router(guest_upload_router)
app.include_router(pricing_router)
app.include_router(analytics_router)
app.include_router(cms_router)
app.include_router(admin_cms_router)
app.include_router(admin_email_router)

# Auto-create any new tables (idempotent)
Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok", "storage_backend": STORAGE_BACKEND}