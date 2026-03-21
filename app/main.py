"""
app/main.py

FastAPI application entry point.
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(dotenv_path=".env")

from app.database.db import Base, engine

# ── Model imports (required so metadata is populated) ─────────────────────────
from app.models import event, cluster
from app.models.user          import User          # noqa: F401
from app.models.event         import Event         # noqa: F401
from app.models.event_order   import EventOrder    # noqa: F401
from app.models.photo         import Photo         # noqa: F401
from app.models.cluster       import Cluster       # noqa: F401
from app.models.pricing_config import PricingConfig # noqa: F401

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
from app.api.guest_upload_routes import router as guest_upload_router
from app.api.pricing_routes     import router as pricing_router

app = FastAPI(title="SnapFind AI")

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
app.include_router(guest_upload_router)
app.include_router(pricing_router)

# Auto-create any new tables (idempotent)
Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok", "storage_backend": STORAGE_BACKEND}
