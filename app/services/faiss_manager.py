import os
from app.services.faiss_index import EventFaissIndex
from app.core.config import INDEXES_PATH
from threading import Lock


class FaissManager:
    """
    In-process FAISS index cache for the FastAPI web server.

    THE CROSS-PROCESS STALENESS PROBLEM:
    ─────────────────────────────────────
    The Celery worker and the FastAPI web server are separate OS processes.
    When the worker finishes processing (owner upload or guest approval) it:
      1. Builds a fresh FAISS index
      2. Saves it to disk  (event_{id}.index + event_{id}_map.npy)
      3. Updates FaissManager in ITS OWN process memory

    The web server's FaissManager._instances still holds the OLD index object
    from the last time a search was performed.  Guest photos were never in that
    old index → search returns zero results even though clusters exist in DB.

    THE FIX — mtime-based cache invalidation:
    ──────────────────────────────────────────
    Every call to get_index() checks the modification time of the .index file
    on disk.  If the file has been updated since the instance was loaded
    (i.e. the worker ran a new processing job), the in-memory instance is
    discarded and re-loaded from the fresh disk file.

    Cost: one os.path.getmtime() syscall per search request — negligible.
    """

    _instances: dict   = {}   # event_id → EventFaissIndex
    _load_times: dict  = {}   # event_id → float (mtime when we last loaded)
    _lock = Lock()

    @classmethod
    def _index_path(cls, event_id: int) -> str:
        return os.path.join(INDEXES_PATH, f"event_{event_id}.index")

    @classmethod
    def _disk_mtime(cls, event_id: int) -> float:
        """Return mtime of the .index file, or 0.0 if it doesn't exist yet."""
        path = cls._index_path(event_id)
        try:
            return os.path.getmtime(path)
        except OSError:
            return 0.0

    @classmethod
    def get_index(cls, event_id: int) -> EventFaissIndex:
        """
        Return the EventFaissIndex for event_id.

        Automatically reloads from disk if the worker has written a newer
        version since this process last loaded it — handles the cross-process
        staleness problem without any inter-process messaging.
        """
        with cls._lock:
            disk_mtime = cls._disk_mtime(event_id)
            cached_mtime = cls._load_times.get(event_id, -1)

            # Reload if: never loaded, OR disk file is newer than our copy
            if event_id not in cls._instances or disk_mtime > cached_mtime:
                cls._instances[event_id] = EventFaissIndex(event_id)
                cls._load_times[event_id] = disk_mtime

            return cls._instances[event_id]

    @classmethod
    def reload_index(cls, event_id: int) -> EventFaissIndex:
        """Force reload from disk unconditionally (e.g. called by the worker)."""
        with cls._lock:
            cls._instances[event_id] = EventFaissIndex(event_id)
            cls._load_times[event_id] = cls._disk_mtime(event_id)
            return cls._instances[event_id]

    @classmethod
    def remove_index(cls, event_id: int) -> None:
        """Evict cached instance (called before rebuilding in the worker)."""
        with cls._lock:
            cls._instances.pop(event_id, None)
            cls._load_times.pop(event_id, None)