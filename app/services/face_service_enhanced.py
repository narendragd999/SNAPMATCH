import numpy as np
import cv2
from app.services.face_model import face_app

def detect_faces_multi_scale(img, scales=[1.0, 1.25, 1.5]):
    """
    Detect faces at multiple scales to catch side/rotated faces.
    Buffalo_l struggles with profile views at single scale.
    """
    all_faces = []
    
    for scale in scales:
        if scale != 1.0:
            h, w = img.shape[:2]
            scaled_img = cv2.resize(img, (int(w * scale), int(h * scale)))
        else:
            scaled_img = img
        
        faces = face_app.get(scaled_img)
        
        # Scale bounding boxes back to original size
        for face in faces:
            if scale != 1.0:
                face.bbox = face.bbox / scale
            all_faces.append(face)
    
    # Remove duplicates (faces detected at multiple scales)
    return remove_duplicate_faces(all_faces)

def remove_duplicate_faces(faces, iou_threshold=0.3):
    """Remove overlapping face detections"""
    if not faces:
        return []
    
    faces = sorted(faces, key=lambda f: f.det_score, reverse=True)
    keep = []
    
    while faces:
        best = faces.pop(0)
        keep.append(best)
        
        remaining = []
        for face in faces:
            iou = calculate_iou(best.bbox, face.bbox)
            if iou < iou_threshold:
                remaining.append(face)
        faces = remaining
    
    return keep

def calculate_iou(box1, box2):
    """Calculate Intersection over Union"""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0