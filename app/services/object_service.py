"""
Phase 3: Object Detection using YOLOv8n (nano - fastest, smallest)

Detects objects in event photos: person, cake, flowers, microphone, etc.
Useful for filtering photos by content (e.g., "show me photos with the cake").

Install:
    pip install ultralytics

Environment variables:
    YOLO_MODEL_PATH=/path/to/yolov8n.pt  (optional, auto-downloads if not set)
    YOLO_CONFIDENCE=0.4                   (minimum confidence, default 0.4)
    YOLO_MAX_DIM=640                      (resize before detection, default 640)
"""

import os
import json
import cv2
import numpy as np
from app.core.config import STORAGE_PATH

_yolo_model = None
CONFIDENCE_THRESHOLD = float(os.getenv("YOLO_CONFIDENCE", "0.4"))
MAX_DIM = int(os.getenv("YOLO_MAX_DIM", "640"))


def load_yolo_model():
    """Load YOLOv8n model. Called once at worker startup."""
    global _yolo_model

    if _yolo_model is not None:
        return

    try:
        from ultralytics import YOLO

        model_path = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
        # ultralytics auto-downloads yolov8n.pt from GitHub if not found
        _yolo_model = YOLO(model_path)
        _yolo_model.fuse()  # Fuse layers for faster inference

        print("✅ YOLOv8n object detection model loaded")

    except Exception as e:
        print(f"⚠ YOLO model load failed: {e}. Object detection disabled.")
        _yolo_model = None


def detect_objects(event_id: int, image_filename: str) -> dict:
    """
    Detect objects in a single image.

    Returns:
        {
            "objects": ["person", "cake", "flowers"],
            "object_counts": {"person": 3, "cake": 1},
            "raw_json": "[{\"label\": \"person\", \"confidence\": 0.91, \"bbox\": [...]}]"
        }
    """
    if _yolo_model is None:
        return {"objects": [], "object_counts": {}, "raw_json": "[]"}

    try:
        image_path = os.path.join(STORAGE_PATH, str(event_id), image_filename)

        if not os.path.exists(image_path):
            return {"objects": [], "object_counts": {}, "raw_json": "[]"}

        img = cv2.imread(image_path)
        if img is None:
            return {"objects": [], "object_counts": {}, "raw_json": "[]"}

        # Resize for efficiency
        h, w = img.shape[:2]
        if max(h, w) > MAX_DIM:
            scale = MAX_DIM / max(h, w)
            img = cv2.resize(img, (int(w * scale), int(h * scale)))

        results = _yolo_model(img, conf=CONFIDENCE_THRESHOLD, verbose=False)

        detected = []
        object_counts = {}
        raw_detections = []

        for result in results:
            if result.boxes is None:
                continue

            for box in result.boxes:
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                label = _yolo_model.names[cls_id]
                bbox = box.xyxy[0].tolist()

                if conf >= CONFIDENCE_THRESHOLD:
                    detected.append(label)
                    object_counts[label] = object_counts.get(label, 0) + 1
                    raw_detections.append({
                        "label": label,
                        "confidence": round(conf, 3),
                        "bbox": [round(x, 1) for x in bbox]
                    })

        # Deduplicated list of unique objects
        unique_objects = list(set(detected))

        return {
            "objects": unique_objects,
            "object_counts": object_counts,
            "raw_json": json.dumps(raw_detections)
        }

    except Exception as e:
        print(f"⚠ Object detection error for {image_filename}: {e}")
        return {"objects": [], "object_counts": {}, "raw_json": "[]"}


def batch_detect_objects(event_id: int, image_filenames: list) -> dict:
    """
    Batch object detection.

    Returns: {filename: detection_result}
    """
    if _yolo_model is None:
        return {f: {"objects": [], "object_counts": {}} for f in image_filenames}

    results = {}
    for filename in image_filenames:
        results[filename] = detect_objects(event_id, filename)

    return results
