from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
#from app.api.routes import router
from app.database.db import Base, engine
from app.models import event, cluster
from app.api.auth_routes import router as auth_router
from app.api.event_routes import router as event_router
from app.api.upload_routes import router as upload_router
from app.api.public_routes import router as public_router
from app.api.billing_routes import router as billing_router
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

app = FastAPI(title="Event AI SaaS")

# ✅ ADD CORS HERE
app.add_middleware(
    CORSMiddleware,
        allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

load_dotenv(dotenv_path=".env")
app.mount("/storage", StaticFiles(directory="storage"), name="storage")
# Include routers   
app.include_router(auth_router)
app.include_router(event_router)
app.include_router(upload_router)
app.include_router(public_router)
app.include_router(billing_router)

Base.metadata.create_all(bind=engine)
                                                                                                                                    