from app.services.faiss_index import EventFaissIndex
from threading import Lock


class FaissManager:
    _instances = {}
    _lock = Lock()

    @classmethod
    def get_index(cls, event_id: int):
        with cls._lock:
            if event_id not in cls._instances:
                cls._instances[event_id] = EventFaissIndex(event_id)
            return cls._instances[event_id]

    @classmethod
    def reload_index(cls, event_id: int):
        with cls._lock:
            cls._instances[event_id] = EventFaissIndex(event_id)

    @classmethod
    def remove_index(cls, event_id: int):
        with cls._lock:
            if event_id in cls._instances:
                del cls._instances[event_id]
