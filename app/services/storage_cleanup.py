"""
app/services/storage_cleanup.py

Centralised helper for deleting all storage assets tied to an event.
Used by:
  - event_routes.py     (owner deletes their event)
  - admin_routes.py     (admin force-deletes event / user)
  - tasks.py            (cleanup_expired_events Celery task)

Handles FAISS indexes (always local files) + object storage (local/MinIO/R2).
"""

import os
from app.core.config import INDEXES_PATH
from app.services import storage_service


# ──────────────────────────────────────────────────────────────────────────────
# FAISS index files — always on local disk regardless of storage backend
# ──────────────────────────────────────────────────────────────────────────────

def _remove_faiss_files(event_id: int) -> None:
    for fname in [
        f"event_{event_id}.index",
        f"event_{event_id}_map.npy",
        f"event_{event_id}_cluster.index",
        f"event_{event_id}_cluster_map.npy",
    ]:
        path = os.path.join(INDEXES_PATH, fname)
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception as e:
                print(f"⚠ Could not remove FAISS file {fname}: {e}")


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def delete_event_storage(event_id: int, cover_image: str | None = None) -> None:
    """
    Delete ALL storage assets for an event:
      1. FAISS in-memory index
      2. FAISS index files (always local)
      3. All event photos / thumbnails / guest previews (local/MinIO/R2)
      4. Cover image (local/MinIO/R2)

    Safe to call even if files don't exist — all operations are best-effort.
    Errors are logged but never raised (so DB deletion always proceeds).
    """
    from app.services.faiss_manager import FaissManager

    # 1. Remove from FAISS memory cache
    try:
        FaissManager.remove_index(event_id)
    except Exception as e:
        print(f"⚠ FaissManager.remove_index({event_id}) failed: {e}")

    # 2. Remove FAISS files from disk
    _remove_faiss_files(event_id)

    # 3. Delete all event photos/thumbnails/previews from storage (local/MinIO/R2)
    try:
        storage_service.delete_event_folder(event_id)
        print(f"🗑 Deleted storage folder for event {event_id}")
    except Exception as e:
        print(f"⚠ storage_service.delete_event_folder({event_id}) failed: {e}")

    # 4. Delete cover image
    if cover_image:
        try:
            storage_service.delete_cover(cover_image)
            print(f"🗑 Deleted cover: {cover_image}")
        except Exception as e:
            print(f"⚠ storage_service.delete_cover({cover_image}) failed: {e}")
