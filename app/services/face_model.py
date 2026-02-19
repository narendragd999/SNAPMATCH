from insightface.app import FaceAnalysis

# Set True if GPU available
USE_GPU = False  

face_app = FaceAnalysis(name="buffalo_l")

# ctx_id = 0 for GPU, -1 for CPU
ctx = 0 if USE_GPU else -1
#face_app.prepare(ctx_id=ctx)
face_app.prepare(ctx_id=ctx, det_size=(640, 640))

