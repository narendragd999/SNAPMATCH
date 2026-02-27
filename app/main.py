from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database.db import Base, engine
from app.models import event, cluster
from app.api.auth_routes import router as auth_router
from app.api.event_routes import router as event_router
from app.api.upload_routes import router as upload_router
from app.api.public_routes import router as public_router
from app.api.billing_routes import router as billing_router
from app.api.task_routes import router as task_router
from app.api.approval_routes import router as approval_router
from app.api.admin_routes import router as admin_router
from app.api.guest_upload_routes import router as guest_upload_router
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import os

load_dotenv(dotenv_path=".env")

app = FastAPI(title="SnapFind AI")

# FIX: CORS origins from environment variable (not hardcoded)
raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
allowed_origins = [o.strip() for o in raw_origins.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory="storage"), name="storage")

app.include_router(auth_router)
app.include_router(event_router)
app.include_router(upload_router)
app.include_router(public_router)
app.include_router(billing_router)
app.include_router(task_router)
app.include_router(approval_router)
app.include_router(admin_router)
app.include_router(guest_upload_router)   # Phase 4: guest contributions

Base.metadata.create_all(bind=engine)
