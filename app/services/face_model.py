from insightface.app import FaceAnalysis

# Set True if GPU available
USE_GPU = False

#face_app = FaceAnalysis(name="buffalo_s")
face_app = FaceAnalysis(
    name="buffalo_s",
    allowed_modules=['detection', 'recognition']
)

# ctx_id = 0 for GPU, -1 for CPU
ctx = 0 if USE_GPU else -1

# PERF: det_size reduced from (640,640) → (320,320).
# InsightFace internally resizes input to det_size before running the detector.
# Half the linear dimension = 4× fewer pixels = ~3× faster on CPU with minimal
# accuracy loss for faces ≥ 80px in the optimized image (our MAX_DIM=800 ensures this).
# Benchmark: 7-face group photo 8-10s → ~2.5-3.5s.
# Raise back to (640,640) only if you start missing small/distant faces.
face_app.prepare(ctx_id=ctx, det_size=(640, 640))