from app.workers.celery_worker import celery
from app.services.face_service import process_event_images
from app.database.db import SessionLocal
from app.models.cluster import Cluster
from app.models.event import Event
from app.services.faiss_index import EventFaissIndex
from app.services.faiss_manager import FaissManager
from app.core.config import INDEXES_PATH, STORAGE_PATH
from datetime import datetime
import shutil

import pickle
import numpy as np
import os
import cv2


MAX_DIM = 800  # safe resize limit

def load_image_for_processing(path: str):

    original = cv2.imread(path)

    if original is None:
        return None

    h, w = original.shape[:2]

    # Resize only if large
    if max(h, w) > MAX_DIM:
        scale = MAX_DIM / max(h, w)
        resized = cv2.resize(
            original,
            (int(w * scale), int(h * scale)),
            interpolation=cv2.INTER_AREA
        )
        return resized

    return original

# --------------------------------------------------
# Normalize Embedding
# --------------------------------------------------
def normalize_embedding(embedding):
    norm = np.linalg.norm(embedding)
    if norm == 0:
        return embedding
    return embedding / norm


# --------------------------------------------------
# Create Thumbnail
# --------------------------------------------------
def create_thumbnail(event_id: int, image_name: str, size=(400, 400)):

    original_path = os.path.join(
        STORAGE_PATH,
        str(event_id),
        image_name
    )

    thumbnail_folder = os.path.join(
        STORAGE_PATH,
        str(event_id),
        "thumbnails"
    )

    os.makedirs(thumbnail_folder, exist_ok=True)

    # Change extension to .webp
    base_name = os.path.splitext(image_name)[0]
    thumbnail_path = os.path.join(
        thumbnail_folder,
        f"{base_name}.webp"
    )

    if not os.path.exists(original_path):
        return

    image = cv2.imread(original_path)
    if image is None:
        return

    # Maintain aspect ratio
    h, w = image.shape[:2]
    scale = min(size[0] / w, size[1] / h)
    new_w = int(w * scale)
    new_h = int(h * scale)

    resized = cv2.resize(
        image,
        (new_w, new_h),
        interpolation=cv2.INTER_AREA
    )

    # Save as WebP with compression
    cv2.imwrite(
        thumbnail_path,
        resized,
        [cv2.IMWRITE_WEBP_QUALITY, 80]  # 0-100 (80 is good balance)
    )



# --------------------------------------------------
# Main Processing Task
# --------------------------------------------------
@celery.task
def process_images(event_id: int):

    db = SessionLocal()

    try:
        print("🔄 EVENT ID:", event_id)

        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            print("❌ Event not found")
            return {"status": "event_not_found"}

        # Mark processing
        event.processing_status = "processing"
        event.processing_progress = 10
        db.commit()

        folder = os.path.join(STORAGE_PATH, str(event_id))

        # 1️⃣ Extract faces (NO DBSCAN)
        faces = process_event_images(event_id)
        # faces should return:
        # [(image_name, embedding), ...]

        # 2️⃣ Remove old clusters
        db.query(Cluster).filter(Cluster.event_id == event_id).delete()
        db.commit()

        # 3️⃣ Remove old FAISS index
        FaissManager.remove_index(event_id)

        index_path = os.path.join(INDEXES_PATH, f"event_{event_id}.index")
        map_path = os.path.join(INDEXES_PATH, f"event_{event_id}_map.npy")

        if os.path.exists(index_path):
            os.remove(index_path)

        if os.path.exists(map_path):
            os.remove(map_path)

        faiss_index = EventFaissIndex(event_id)

        # 4️⃣ Bulk insert
        clusters_to_add = []
        embeddings = []

        for idx, (image_name, embedding) in enumerate(faces):

            clusters_to_add.append(
                Cluster(
                    event_id=event_id,
                    cluster_id=idx,  # each face independent
                    image_name=image_name,
                    embedding=pickle.dumps(embedding)
                )
            )

            embeddings.append(embedding)

        if clusters_to_add:
            db.add_all(clusters_to_add)
            db.commit()

        ids = [c.id for c in clusters_to_add]

        # 5️⃣ Add to FAISS
        if embeddings:
            faiss_index.add_embeddings(embeddings, ids)

        FaissManager.reload_index(event_id)

        # 6️⃣ Update summary
        total_faces = len(embeddings)
        total_clusters = total_faces  # since no DBSCAN

        total_images = 0
        if os.path.exists(folder):
            total_images = len([
                f for f in os.listdir(folder)
                if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
            ])

        event.total_faces = total_faces
        event.total_clusters = total_clusters
        event.image_count = total_images
        event.processing_status = "completed"
        event.processing_progress = 100
        db.commit()

        # 7️⃣ Background thumbnail generation
        generate_event_thumbnails.delay(event_id)

        print("✅ Processing complete")
        print("Faces:", total_faces)

        return {"status": "completed"}

    except Exception as e:
        db.rollback()

        event = db.query(Event).filter(Event.id == event_id).first()
        if event:
            event.processing_status = "failed"
            db.commit()

        print("❌ ERROR:", str(e))
        raise e

    finally:
        db.close()



@celery.task
def cleanup_expired_events():

    db = SessionLocal()

    try:
        now = datetime.utcnow()

        expired_events = db.query(Event).filter(
            Event.expires_at != None,
            Event.expires_at < now
        ).all()

        for event in expired_events:

            print(f"🗑 Cleaning expired event {event.id}")

            # Remove clusters
            db.query(Cluster).filter(
                Cluster.event_id == event.id
            ).delete()

            # Remove FAISS from memory
            FaissManager.remove_index(event.id)

            # Remove FAISS files
            index_path = os.path.join(
                INDEXES_PATH,
                f"event_{event.id}.index"
            )

            map_path = os.path.join(
                INDEXES_PATH,
                f"event_{event.id}_map.npy"
            )

            if os.path.exists(index_path):
                os.remove(index_path)

            if os.path.exists(map_path):
                os.remove(map_path)

            # Remove storage folder
            event_folder = os.path.join(
                STORAGE_PATH,
                str(event.id)
            )

            if os.path.exists(event_folder):
                shutil.rmtree(event_folder)

            # Remove event record
            db.delete(event)

        db.commit()

        print("✅ Expired events cleanup completed")

    except Exception as e:
        db.rollback()
        print("❌ Cleanup error:", str(e))
        raise e

    finally:
        db.close()


@celery.task
def generate_event_thumbnails(event_id: int):

    from app.core.config import STORAGE_PATH
    import os
    from app.services.thumbnail_service import create_thumbnail

    event_folder = os.path.join(STORAGE_PATH, str(event_id))

    if not os.path.exists(event_folder):
        return

    files = [
        f for f in os.listdir(event_folder)
        if f.lower().endswith((".jpg", ".jpeg", ".png"))
    ]

    for file in files:
        try:
            create_thumbnail(event_id, file)
        except Exception as e:
            print("Thumbnail error:", e)

    print(f"✅ Thumbnails generated for event {event_id}")
