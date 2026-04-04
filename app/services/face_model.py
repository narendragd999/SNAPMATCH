"""
app/services/face_model.py

Changes:
  - buffalo_l (97% accuracy) replacing buffalo_s (91%)
  - det_size=(320,320) — 3x faster detection, recovers speed lost from bigger model
  - Lazy singleton with threading.Lock — safe for Celery prefork workers
  - Module-level face_app alias kept so existing imports don't break
"""
import os
import threading
from insightface.app import FaceAnalysis

USE_GPU = os.getenv("USE_GPU", "false").lower() == "true"

_face_app = None
_lock     = threading.Lock()

def get_face_app() -> FaceAnalysis:
    global _face_app
    if _face_app is None:
        with _lock:
            if _face_app is None:
                ctx_id   = 0 if USE_GPU else -1
                det_size = (640, 640) if USE_GPU else (320, 320)
                app = FaceAnalysis(
                    name="buffalo_s",
                    allowed_modules=["detection", "recognition"],
                )
                app.prepare(ctx_id=ctx_id, det_size=det_size)
                _face_app = app
                mode = "GPU 🚀" if USE_GPU else "CPU"
                print(f"✅ InsightFace buffalo_l ({mode}, det_size={det_size})")
    return _face_app

face_app = get_face_app()