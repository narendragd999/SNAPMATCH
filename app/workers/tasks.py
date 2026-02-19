from app.workers.celery_worker import celery
from app.services.face_service import process_event_images
from app.database.db import SessionLocal
from app.models.cluster import Cluster
from app.models.event import Event
from app.services.faiss_manager import FaissManager
from app.core.config import INDEXES_PATH, STORAGE_PATH
from app.services.image_pipeline import process_raw_image
import time
from datetime import datetime
import shutil
import pickle
import os


# ======================================================
# MAIN PROCESSING TASK
# ======================================================

@celery.task
def process_images(event_id: int):

    db = SessionLocal()
    event = None

    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        event_start_time = time.time()

        if not event:
            return {"status": "event_not_found"}

        # -------------------------
        # 1️⃣ INITIAL STATUS UPDATE
        # -------------------------
        event.processing_status = "processing"
        event.processing_started_at = datetime.utcnow()
        event.processing_progress = 5
        db.commit()

        folder = os.path.join(STORAGE_PATH, str(event_id))

        raw_files = [
            f for f in os.listdir(folder)
            if f.startswith("raw_")
        ]

        total_files = len(raw_files)

        # -------------------------
        # 2️⃣ IMAGE OPTIMIZATION
        # -------------------------
        for idx, raw_file in enumerate(raw_files):

            raw_path = os.path.join(folder, raw_file)

            image_start = time.time()

            file_size_kb = os.path.getsize(raw_path) / 1024

            print(f"\n📷 Processing Image {idx+1}/{total_files}")
            print(f"📦 File: {raw_file}")
            print(f"📏 Size: {file_size_kb:.2f} KB")

            optimized_name = process_raw_image(raw_path, folder)

            if not optimized_name:
                print("⚠ Skipped corrupted image")
                continue

            os.remove(raw_path)

            elapsed = time.time() - image_start

            print(f"⏱ Done in {elapsed:.2f} sec")
            print("-" * 50)

            if total_files > 0:
                #progress = 10 + int(((idx + 1) / total_files) * 40)
                event.processing_progress = 50
                db.commit()


        # -------------------------
        # 3️⃣ FACE DETECTION
        # -------------------------
        event.processing_progress = 60
        db.commit()

        faces = process_event_images(event_id)

        event.processing_progress = 75        
        db.commit()
        
        if not faces:
            event.processing_status = "completed"
            event.processing_progress = 100
            db.commit()
            return {"status": "no_faces_found"}

        # -------------------------
        # 4️⃣ RESET CLUSTERS + FAISS
        # -------------------------
        event.processing_progress = 80        
        
        db.query(Cluster).filter(
            Cluster.event_id == event_id
        ).delete()
        db.commit()

        FaissManager.remove_index(event_id)
        faiss_index = FaissManager.get_index(event_id)

        # -------------------------
        # 5️⃣ FAISS-BASED CLUSTERING
        # -------------------------
        import faiss
        import numpy as np

        embeddings = [embedding for (_, embedding) in faces]

        dimension = len(embeddings[0])
        cluster_index = faiss.IndexFlatIP(dimension)

        cluster_ids = []
        current_cluster = 0
        threshold = 0.62  # tuned clustering threshold

        for emb in embeddings:

            emb_np = np.array([emb]).astype("float32")
            faiss.normalize_L2(emb_np)

            if cluster_index.ntotal == 0:
                cluster_index.add(emb_np)
                cluster_ids.append(current_cluster)
                current_cluster += 1
                continue

            D, I = cluster_index.search(emb_np, 1)

            if D[0][0] >= threshold:
                cluster_ids.append(I[0][0])
            else:
                cluster_index.add(emb_np)
                cluster_ids.append(current_cluster)
                current_cluster += 1

        # -------------------------
        # 6️⃣ STORE CLUSTERS
        # -------------------------
        clusters = []

        for (image_name, embedding), cluster_id in zip(faces, cluster_ids):

            cluster = Cluster(
                event_id=event_id,
                cluster_id=int(cluster_id),
                image_name=image_name,
                embedding=pickle.dumps(embedding)
            )

            clusters.append(cluster)

        if clusters:
            db.add_all(clusters)
            db.commit()

        event.processing_progress = 90
        db.commit()

        ids = [c.id for c in clusters]

        # -------------------------
        # 7️⃣ ADD TO FAISS SEARCH INDEX
        # -------------------------
        if embeddings:
            faiss_index.add_embeddings(embeddings, ids)

        event.processing_progress = 95
        db.commit()

        # -------------------------
        # 8️⃣ FINAL STATUS UPDATE
        # -------------------------
        event.total_faces = len(embeddings)
        event.total_clusters = len(set(cluster_ids))
        event.processing_status = "completed"
        event.processing_progress = 100
        event.processing_completed_at = datetime.utcnow()

        db.commit()

        total_elapsed = time.time() - event_start_time

        print(
            f"\n🚀 EVENT {event_id} COMPLETED"
            f"\nTotal Time: {total_elapsed:.2f} sec"
            f"\nFaces: {len(embeddings)}"
            f"\nClusters: {len(set(cluster_ids))}"
            f"\nFAISS size: {faiss_index.index.ntotal}"
        )


        return {"status": "completed"}

    except Exception as e:

        db.rollback()

        if event:
            event.processing_status = "failed"
            event.processing_progress = 0
            db.commit()

        print("❌ Processing error:", str(e))
        raise e

    finally:
        db.close()



# ======================================================
# CLEANUP TASK
# ======================================================

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

            db.delete(event)

        db.commit()
        print("✅ Expired events cleanup completed")

    except Exception as e:
        db.rollback()
        print("❌ Cleanup error:", str(e))
        raise e

    finally:
        db.close()


def assign_clusters_faiss(embeddings, threshold=0.62):

    import faiss
    import numpy as np

    if not embeddings:
        return []

    dim = len(embeddings[0])

    index = faiss.IndexFlatIP(dim)

    cluster_ids = []
    current_cluster = 0

    for emb in embeddings:

        emb = np.array([emb]).astype("float32")
        faiss.normalize_L2(emb)

        if index.ntotal == 0:
            index.add(emb)
            cluster_ids.append(current_cluster)
            current_cluster += 1
            continue

        D, I = index.search(emb, 1)

        if D[0][0] >= threshold:
            cluster_ids.append(I[0][0])
        else:
            index.add(emb)
            cluster_ids.append(current_cluster)
            current_cluster += 1

    return cluster_ids
