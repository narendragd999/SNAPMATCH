import os
import numpy as np
import cv2
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.core.config import STORAGE_PATH
from app.services.face_model import face_app

MAX_DIM = 800
MAX_WORKERS = 1


def resize_if_needed(img):
    h, w = img.shape[:2]
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        img = cv2.resize(
            img,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA
        )
    return img


def process_single_image(event_id: int, file: str):

    image_path = os.path.join(STORAGE_PATH, str(event_id), file)

    if not os.path.exists(image_path):
        return []

    if os.path.getsize(image_path) > 15_000_000:
        return []

    img = cv2.imread(image_path)
    if img is None:
        return []

    img = resize_if_needed(img)

    faces = face_app.get(img)

    results = []

    for face in faces:
        emb = face.embedding
        norm = np.linalg.norm(emb)
        if norm == 0:
            continue
        results.append((file, emb / norm))

    return results


def process_event_images(event_id: int):

    folder = os.path.join(STORAGE_PATH, str(event_id))

    if not os.path.exists(folder):
        return []

    files = [
        f for f in os.listdir(folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]

    all_faces = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:

        futures = [
            executor.submit(process_single_image, event_id, file)
            for file in files
        ]

        for future in as_completed(futures):
            try:
                result = future.result()
                if result:
                    all_faces.extend(result)
            except Exception as e:
                print("Face error:", e)

    return all_faces
