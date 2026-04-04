"""
app/services/face_service_enhanced.py

Enhanced face detection with multi-scale and rotation support.
Fixes: Side profile faces, rotated images, and extreme angles 
       not detected by default buffalo_l configuration.

Integration: Called from face_service.process_single_image()
"""

import numpy as np
import cv2
from typing import List, Optional
from app.services.face_model import face_app

# Configuration for enhanced detection
DETECTION_SCALES = [1.0, 1.25, 1.5]  # Try multiple image scales
ROTATION_ANGLES = [0, 90, -90]        # Try rotations for side profiles
IOU_THRESHOLD = 0.3                   # Overlap threshold for deduplication
MIN_DETECTION_SCORE = 0.35            # Lower than default 0.5 for side faces


def detect_faces_enhanced(
    img: np.ndarray, 
    try_rotations: bool = True,
    try_scales: bool = True
) -> List:
    """
    Enhanced face detection using multi-scale + rotation approach.
    
    Args:
        img: BGR image array (from OpenCV)
        try_rotations: Whether to try rotated versions (for side profiles)
        try_scales: Whether to try multiple scales (for small/distant faces)
    
    Returns:
        List of unique face objects (deduplicated)
    """
    all_faces = []
    
    # Strategy 1: Multi-scale detection (catches small/far faces)
    if try_scales:
        for scale in DETECTION_SCALES:
            scaled_img = _resize_image(img, scale)
            faces = _detect_with_model(scaled_img)
            
            # Scale bounding boxes back to original coordinates
            if scale != 1.0:
                for face in faces:
                    face.bbox = face.bbox / scale
            
            all_faces.extend(faces)
    
    # Strategy 2: Rotation augmentation (catches side profiles)
    if try_rotations and len(all_faces) == 0:
        # Only try rotations if no faces found at original orientation
        for angle in ROTATION_ANGLES[1:]:  # Skip 0° (already tried)
            rotated_img = _rotate_image(img, angle)
            faces = _detect_with_model(rotated_img)
            
            # Transform bounding boxes back to original orientation
            for face in faces:
                face.bbox = _reverse_rotation_bbox(face.bbox, img.shape, angle)
            
            all_faces.extend(faces)
    
    # Fallback: If still nothing, try lower detection threshold
    if len(all_faces) == 0:
        all_faces = _detect_with_lower_threshold(img)
    
    # Remove duplicate detections (same face found at multiple scales/rotations)
    unique_faces = _remove_duplicate_faces(all_faces, IOU_THRESHOLD)
    
    print(f"🔍 Enhanced detection: {len(unique_faces)} faces "
          f"(raw: {len(all_faces)} detections)")
    
    return unique_faces


def _detect_with_model(img: np.ndarray) -> List:
    """Run buffalo_l model on image"""
    try:
        faces = face_app.get(img)
        # Filter by minimum score
        return [f for f in faces if f.det_score >= MIN_DETECTION_SCORE]
    except Exception as e:
        print(f"⚠ Detection error: {e}")
        return []


def _detect_with_lower_threshold(img: np.ndarray) -> List:
    """
    Last resort: Try with very low threshold.
    Useful for extreme side profiles or artistic photos.
    """
    try:
        # Temporarily modify model settings (if supported)
        # Note: This may require model re-initialization in some implementations
        faces = face_app.get(img)
        
        # Aggressively low threshold
        return [f for f in faces if f.det_score >= 0.25]
    except Exception as e:
        print(f"⚠ Low-threshold detection failed: {e}")
        return []


def _resize_image(img: np.ndarray, scale: float) -> np.ndarray:
    """Resize image by scale factor"""
    if scale == 1.0:
        return img
    
    h, w = img.shape[:2]
    new_w, new_h = int(w * scale), int(h * scale)
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)


def _rotate_image(img: np.ndarray, angle: int) -> np.ndarray:
    """Rotate image by angle degrees"""
    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    
    # Calculate rotation matrix
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    
    # Compute new bounding size
    cos_val = abs(matrix[0, 0])
    sin_val = abs(matrix[0, 1])
    new_w = int((h * sin_val) + (w * cos_val))
    new_h = int((h * cos_val) + (w * sin_val))
    
    # Adjust translation
    matrix[0, 2] += (new_w / 2) - center[0]
    matrix[1, 2] += (new_h / 2) - center[1]
    
    # Perform rotation with border replication (no black corners)
    rotated = cv2.warpAffine(
        img, matrix, (new_w, new_h),
        borderMode=cv2.BORDER_REPLICATE
    )
    
    return rotated


def _reverse_rotation_bbox(
    bbox: np.ndarray, 
    original_shape: tuple, 
    angle: int
) -> np.ndarray:
    """
    Transform bounding box from rotated image back to original coordinates.
    
    Args:
        bbox: [x1, y1, x2, y2] in rotated image space
        original_shape: (height, width) of original image
        angle: Rotation angle applied (90 or -90)
    
    Returns:
        Transformed bbox in original image coordinates
    """
    h, w = original_shape[:2]
    x1, y1, x2, y2 = bbox
    
    if angle == 90:
        # Rotated 90° clockwise → transform back
        new_x1 = h - y2
        new_y1 = x1
        new_x2 = h - y1
        new_y2 = x2
    elif angle == -90:
        # Rotated 90° counter-clockwise → transform back
        new_x1 = y1
        new_y1 = w - x2
        new_x2 = y2
        new_y2 = w - x1
    else:
        return bbox
    
    return np.array([new_x1, new_y1, new_x2, new_y2])


def _remove_duplicate_faces(
    faces: List, 
    iou_threshold: float = 0.3
) -> List:
    """
    Remove overlapping face detections using Non-Maximum Suppression (NMS).
    
    Keeps the highest-confidence detection when faces overlap significantly.
    """
    if not faces:
        return []
    
    # Sort by detection score (highest first)
    faces = sorted(faces, key=lambda f: f.det_score, reverse=True)
    
    keep = []
    
    while faces:
        best = faces.pop(0)
        keep.append(best)
        
        remaining = []
        for face in faces:
            iou = _calculate_iou(best.bbox, face.bbox)
            if iou < iou_threshold:
                remaining.append(face)
            # Else: discard lower-scoring duplicate
        
        faces = remaining
    
    return keep


def _calculate_iou(box1: np.ndarray, box2: np.ndarray) -> float:
    """
    Calculate Intersection over Union between two bounding boxes.
    
    Args:
        box1: [x1, y1, x2, y2]
        box2: [x1, y1, x2, y2]
    
    Returns:
        IoU score (0.0 to 1.0)
    """
    # Convert to float for precision
    box1 = box1.astype(float)
    box2 = box2.astype(float)
    
    # Calculate intersection coordinates
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    
    # Calculate intersection area
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    
    # Calculate union area
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - intersection
    
    # Avoid division by zero
    if union <= 0:
        return 0.0
    
    return intersection / union


# Convenience function for backward compatibility
def get_face_count(img: np.ndarray) -> int:
    """Quick check: how many faces in image?"""
    faces = detect_faces_enhanced(img)
    return len(faces)


# Diagnostic function for debugging
def analyze_detection_quality(img: np.ndarray) -> dict:
    """
    Analyze why faces might not be detected.
    Returns diagnostic info for debugging.
    """
    from app.services.face_model import get_face_app
    
    diagnostics = {
        'image_size': img.shape[:2],
        'original_detection': [],
        'enhanced_detection': [],
        'recommendation': ''
    }
    
    # Test with current model settings
    try:
        original_faces = face_app.get(img)
        diagnostics['original_detection'] = [
            {
                'score': float(f.det_score),
                'bbox': f.bbox.astype(int).tolist()
            }
            for f in original_faces
        ]
    except Exception as e:
        diagnostics['error'] = str(e)
    
    # Test with enhanced method
    enhanced_faces = detect_faces_enhanced(img)
    diagnostics['enhanced_detection'] = [
        {
            'score': float(f.det_score),
            'bbox': f.bbox.astype(int).tolist()
        }
        for f in enhanced_faces
    ]
    
    # Generate recommendation
    orig_count = len(diagnostics['original_detection'])
    enh_count = len(diagnostics['enhanced_detection'])
    
    if enh_count > orig_count:
        diagnostics['recommendation'] = (
            f"✅ Enhanced method found {enh_count - orig_count} additional faces! "
            "Consider enabling enhanced detection permanently."
        )
    elif orig_count == 0 and enh_count == 0:
        diagnostics['recommendation'] = (
            "❌ No faces detected. Possible issues:\n"
            "  - Image too dark/bright\n"
            "  - Extreme angle (>60°)\n"
            "  - Face too small (<32px)\n"
            "  - Occlusion (hands, hair, glasses)"
        )
    else:
        diagnostics['recommendation'] = (
            f"✓ Standard detection working ({orig_count} faces)"
        )
    
    return diagnostics