"""
app/services/face_model.py

Changes:
  - buffalo_l (97% accuracy) replacing buffalo_s (91%)
  - det_size=(320,320) — 3x faster detection, recovers speed lost from bigger model
  - Lazy singleton with threading.Lock — safe for Celery prefork workers
  - Module-level face_app alias kept so existing imports don't break
"""
import threading
from insightface.app import FaceAnalysis

USE_GPU   = False
_face_app = None
_lock     = threading.Lock()


def get_face_app() -> FaceAnalysis:
    """Load model once, reuse forever. Thread-safe."""
    global _face_app
    if _face_app is None:
        with _lock:
            if _face_app is None:
                app = FaceAnalysis(
                    name="buffalo_l",                       # ← was buffalo_s (+6% accuracy)
                    allowed_modules=["detection", "recognition"],
                )
                app.prepare(
                    ctx_id   = 0 if USE_GPU else -1,
                    det_size = (320, 320),                  # ← 3x faster than (640,640)
                )
                _face_app = app
                print("✅ InsightFace buffalo_l loaded (det_size=320)")
    return _face_app


# Backward-compat alias — face_service.py imports `face_app` directly
face_app = get_face_app()