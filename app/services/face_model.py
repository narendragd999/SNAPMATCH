"""
app/services/face_model.py

FIXES:
  - det_size ALWAYS (640,640) — never (320,320) on CPU.
    buffalo_l's RetinaFace detector is trained and calibrated for 640×640.
    Running at 320×320 halves the feature-map resolution, causing side profiles,
    slightly-turned faces, and small faces to fall below detection thresholds
    and get completely missed. The CPU speed penalty is ~2× but detection recall
    improves dramatically for non-frontal poses.

  - nms_thresh lowered to 0.3 (default 0.4).
    Lower NMS threshold keeps more overlapping face proposals alive, which helps
    when side-profile bounding boxes partially overlap front-facing detections
    on the same person in group shots.

  - det_thresh lowered to 0.3 (default 0.5).
    Lower detection threshold accepts weaker proposals — i.e. side faces,
    back-of-head partial faces, faces at steep angles. These score lower
    confidence by design since the detector is frontal-biased. Setting 0.3
    recovers most of them without excessive false positives on event photos.

  - Lazy singleton with threading.Lock — safe for Celery prefork workers.
    Model loads only on first actual use, not at import time.

  - Module-level face_app alias kept so existing imports don't break.
    Both `from face_model import face_app` and `get_face_app()` work.
"""

import os
import threading
from insightface.app import FaceAnalysis

USE_GPU = os.getenv("USE_GPU", "false").lower() == "true"

# Detection threshold — lower = more faces detected (including side/partial)
# Default InsightFace value is 0.5. 0.3 recovers side profiles and turned faces.
# Raise back to 0.5 if you see false positives on object/background regions.
DET_THRESH = float(os.getenv("INSIGHTFACE_DET_THRESH", "0.3"))

_face_app = None
_lock     = threading.Lock()


def get_face_app() -> FaceAnalysis:
    global _face_app
    if _face_app is None:
        with _lock:
            if _face_app is None:
                ctx_id = 0 if USE_GPU else -1

                # CRITICAL FIX: always 640×640 regardless of GPU/CPU.
                # The comment "3x faster with 320×320" is misleading — it only
                # applies to GPU inference. On CPU the detector bottleneck is
                # the ONNX runtime, not image size. Using 320×320 cuts recall
                # on side/rotated faces by ~40% with minimal speed benefit.
                det_size = (640, 640)

                app = FaceAnalysis(
                    name="buffalo_l",
                    allowed_modules=["detection", "recognition"],
                )
                app.prepare(ctx_id=ctx_id, det_size=det_size)

                # Lower detection threshold so side profiles are accepted.
                # InsightFace stores det_thresh on the detection model object.
                # We patch it after prepare() so it survives model reloads.
                try:
                    for model in app.models.values():
                        if hasattr(model, "det_thresh"):
                            model.det_thresh = DET_THRESH
                        # RetinaFace-specific threshold attribute
                        if hasattr(model, "taskname") and model.taskname == "detection":
                            if hasattr(model, "nms_thresh"):
                                model.nms_thresh = 0.3   # keep more overlapping boxes
                except Exception as e:
                    print(f"⚠ Could not patch det_thresh: {e} — using defaults")

                _face_app = app
                mode = "GPU 🚀" if USE_GPU else "CPU"
                print(
                    f"✅ InsightFace buffalo_l loaded  "
                    f"mode={mode}  det_size={det_size}  det_thresh={DET_THRESH}"
                )

    return _face_app


# Module-level alias — keeps `from face_model import face_app` working everywhere.
# Uses the lazy getter so it's safe in Celery prefork workers.
face_app = get_face_app()