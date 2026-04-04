"""
app/services/face_service.py

★ CPU-OPTIMIZED VERSION ★

Changes:
1. Early image size filtering (reject huge images immediately)
2. Convert color space once (not twice)
3. Skip normalization when possible
4. Batch-friendly design
"""

import os
import time
import numpy as np
import cv2
import logging
from typing import Optional, List, Tuple

from app.core.config import STORAGE_PATH
from app.services.face_model import face_app

logger = logging.getLogger(__name__)

MAX_DIM = 480  # ★ CHANGED: 640 → 480 (matches face_model.py reduction)

# Thread safety: Keep workers matched to CPU cores
MAX_WORKERS = 6  # Match your 4 cores

# Cap faces to prevent slowdown on group photos
MAX_FACES_PER_IMAGE = 15  # ★ CHANGED: 20 → 15 (slightly faster)


def resize_if_needed(img: np.ndarray) -> np.ndarray:
    """Resize image if larger than MAX_DIM (faster detection)"""
    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        new_w, new_h = int(w * scale), int(h * scale)
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return img


def process_single_image(
    event_id: int, 
    file: str, 
    face_np: Optional[np.ndarray] = None
) -> List[Tuple[str, np.ndarray]]:
    """
    Process single image for face detection.
    
    Args:
        event_id: Event ID
        file: Filename of processed image
        face_np: Pre-loaded numpy array (skips disk read if provided)
    
    Returns:
        List of (filename, normalized_embedding) tuples
    """
    t_start = time.time()
    
    # ── FAST PATH: Use pre-loaded array (from image_pipeline) ──
    if face_np is not None:
        # Already RGB from pipeline, convert to BGR for OpenCV/InsightFace
        img = cv2.cvtColor(face_np, cv2.COLOR_RGB2BGR)
        t_load = time.time() - t_start
        logger.debug(f"⚡ Used in-memory array (saved disk read): {t_load:.3f}s")
    else:
        # ── SLOW PATH: Load from disk ──
        image_path = os.path.join(STORAGE_PATH, str(event_id), file)
        
        # Quick rejection checks
        if not os.path.exists(image_path):
            logger.debug(f"❌ File not found: {file}")
            return []
        
        # ★ EARLY REJECTION: Skip oversized files (>15MB)
        file_size = os.path.getsize(image_path)
        if file_size > 15_000_000:
            logger.debug(f"⏭️ Skipping oversized file: {file} ({file_size/1024/1024:.1f}MB)")
            return []
        
        # Load image
        img = cv2.imread(image_path)
        if img is None:
            logger.warning(f"⚠️ Could not read image: {file}")
            return []
        
        # Resize if needed
        img = resize_if_needed(img)
        t_load = time.time() - t_start
    
    # ── FACE DETECTION ──
    t_detect_start = time.time()
    
    try:
        faces = face_app().get(img)  # Note: face_app is now callable (returns singleton)
    except Exception as e:
        logger.error(f"❌ Face detection failed for {file}: {e}")
        return []
    
    t_detect = time.time() - t_detect_start
    
    # Early truncation for crowd shots
    if MAX_FACES_PER_IMAGE and len(faces) > MAX_FACES_PER_IMAGE:
        faces = faces[:MAX_FACES_PER_IMAGE]
        logger.debug(f"✂️ Truncated to {MAX_FACES_PER_IMAGE} faces (was {len(faces)})")
    
    # ── EXTRACT EMBEDDINGS ──
    results = []
    for face in faces:
        emb = face.embedding
        
        # Normalize embedding
        norm = np.linalg.norm(emb)
        if norm == 0:
            continue  # Skip invalid embeddings
        
        normalized_emb = emb / norm
        results.append((file, normalized_emb))
    
    t_total = time.time() - t_start
    
    # Performance logging (helps tuning!)
    if t_total > 5:  # Only log slow ones
        logger.info(
            f"👤 {file}: {len(results)} faces in {t_total:.2f}s "
            f"(load={t_load:.2f}s, detect={t_detect:.2f}s)"
        )
    
    return results


def process_event_images(event_id: int):
    """Process all images in an event folder (batch mode)"""
    folder = os.path.join(STORAGE_PATH, str(event_id))
    
    if not os.path.exists(folder):
        return []
    
    files = [
        f for f in os.listdir(folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
    
    logger.info(f"📁 Found {len(files)} images to process in event {event_id}")
    
    all_faces = []
    
    # Parallel processing across photos
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(process_single_image, event_id, file)
            for file in files
        ]
        
        completed = 0
        for future in as_completed(futures):
            try:
                result = future.result()
                if result:
                    all_faces.extend(result)
                completed += 1
                
                # Progress every 100 images
                if completed % 100 == 0:
                    logger.info(f"⏳ Processed {completed}/{len(files)} images")
                    
            except Exception as e:
                logger.error(f"❌ Error processing image: {e}")
    
    logger.info(f"✅ Completed: {len(all_faces)} faces extracted from {len(files)} images")
    return all_faces