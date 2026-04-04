"""
app/services/embedding_store.py

External storage for face embeddings.
Prevents Redis memory crashes when processing 1000+ photo events.

Instead of returning embeddings from process_photo_batch() through 
Celery chord callback (which creates multi-GB messages), we store 
them externally and pass only a small reference key.
"""

import os
import pickle
import shutil
from typing import List, Dict, Iterator

import redis


class EmbeddingStore:
    """
    Stores face embedding batches to Redis or filesystem.
    
    Usage:
        # Store embeddings after processing a batch
        store = EmbeddingStore(event_id)
        key = store.store_batch(task_id, faces_data)
        
        # Later, during finalization, load them back
        data = store.load_batch(key)
        
        # When done, cleanup
        store.cleanup()
    """
    
    STORAGE_BACKEND = os.getenv("EMBEDDINGS_STORAGE", "redis").lower()
    REDIS_PREFIX = "embeddings:store"
    TEMP_DIR = os.getenv("TEMP_EMBEDDINGS_DIR", "/tmp/snapmatch/embeddings")
    MAX_REDIS_VALUE_MB = int(os.getenv("MAX_REDIS_VALUE_MB", "50"))
    DEFAULT_TTL_HOURS = int(os.getenv("EMBEDDINGS_TTL_HOURS", "24"))
    
    def __init__(self, event_id: int):
        self.event_id = event_id
        self.base_key = f"{self.REDIS_PREFIX}:{event_id}"
        self.file_dir = os.path.join(self.TEMP_DIR, str(event_id))
        self._redis_client = None
        
        if self.STORAGE_BACKEND == "file":
            os.makedirs(self.file_dir, exist_ok=True)
    
    @property
    def redis(self):
        """Lazy-loaded Redis client."""
        if self._redis_client is None:
            redis_url = os.getenv(
                "CELERY_BROKER_URL", 
                "redis://localhost:6379/0"
            )
            self._redis_client = redis.from_url(
                redis_url,
                decode_responses=False  # Binary mode for pickled data
            )
        return self._redis_client
    
    def store_batch(self, batch_id: str, faces_data: List[Dict]) -> str:
        """
        Store a batch of face embeddings.
        
        Args:
            batch_id: Unique identifier (usually Celery task ID)
            faces_data: List of dicts with 'embedding', 'image_name', 'photo_id'
            
        Returns:
            Storage key string (NOT the actual data)
            
        Raises:
            ValueError: If faces_data is empty
            RuntimeError: If storage fails
        """
        if not faces_data:
            raise ValueError("Cannot store empty faces_data")
        
        if self.STORAGE_BACKEND == "redis":
            return self._store_redis(batch_id, faces_data)
        else:
            return self._store_file(batch_id, faces_data)
    
    def _store_redis(self, batch_id: str, faces_data: List[Dict]) -> str:
        """Store in Redis with size safety checks."""
        storage_key = f"{self.base_key}:batch:{batch_id}"
        
        try:
            serialized = pickle.dumps(faces_data, protocol=pickle.HIGHEST_PROTOCOL)
            size_mb = len(serialized) / (1024 * 1024)
            
            if size_mb > self.MAX_REDIS_VALUE_MB:
                print(f"⚠ Batch {batch_id} too large ({size_mb:.1f}MB), splitting...")
                return self._store_split(batch_id, faces_data)
            
            ttl_seconds = self.DEFAULT_TTL_HOURS * 3600
            self.redis.setex(storage_key, ttl_seconds, serialized)
            
            print(f"💾 Stored batch {batch_id} → Redis ({size_mb:.1f}MB, {len(faces_data)} faces)")
            return storage_key
            
        except Exception as e:
            print(f"❌ Redis store failed for {batch_id}: {e}")
            raise RuntimeError(f"Failed to store batch {batch_id}: {e}")
    
    def _store_split(self, batch_id: str, faces_data: List[Dict]) -> str:
        """Split oversized batch into smaller chunks."""
        max_faces_per_chunk = (self.MAX_REDIS_VALUE_MB * 1024 * 1024) // 500
        
        sub_keys = []
        for i in range(0, len(faces_data), max_faces_per_chunk):
            chunk = faces_data[i:i + max_faces_per_chunk]
            sub_batch_id = f"{batch_id}_part{i // max_faces_per_chunk}"
            sub_key = self._store_redis(sub_batch_id, chunk)
            sub_keys.append(sub_key)
        
        manifest_key = f"{self.base_key}:manifest:{batch_id}"
        manifest_data = pickle.dumps(sub_keys, protocol=pickle.HIGHEST_PROTOCOL)
        ttl_seconds = self.DEFAULT_TTL_HOURS * 3600
        self.redis.setex(manifest_key, ttl_seconds, manifest_data)
        
        print(f"📦 Split batch {batch_id} into {len(sub_keys)} chunks")
        return manifest_key
    
    def _store_file(self, batch_id: str, faces_data: List[Dict]) -> str:
        """Store as file on disk (for very large datasets)."""
        os.makedirs(self.file_dir, exist_ok=True)
        
        file_path = os.path.join(self.file_dir, f"batch_{batch_id}.pkl")
        
        with open(file_path, 'wb') as f:
            pickle.dump(faces_data, f, protocol=pickle.HIGHEST_PROTOCOL)
        
        size_mb = os.path.getsize(file_path) / (1024 * 1024)
        print(f"💾 Stored batch {batch_id} → File ({size_mb:.1f}MB)")
        
        return file_path
    
    def load_batch(self, storage_key: str) -> List[Dict]:
        """Load a batch from storage using its key."""
        if not storage_key:
            raise ValueError("storage_key cannot be empty")
        
        if ":manifest:" in storage_key:
            return self._load_manifest(storage_key)
        
        elif storage_key.startswith(self.base_key):
            data = self.redis.get(storage_key)
            if data is None:
                raise FileNotFoundError(f"Embedding key not found: {storage_key}")
            return pickle.loads(data)
        
        elif os.path.exists(storage_key):
            with open(storage_key, 'rb') as f:
                return pickle.load(f)
        
        else:
            raise ValueError(f"Unknown storage format: {storage_key}")
    
    def _load_manifest(self, manifest_key: str) -> List[Dict]:
        """Load all parts of a split batch."""
        sub_keys = pickle.loads(self.redis.get(manifest_key))
        all_data = []
        for sub_key in sub_keys:
            part_data = self.load_batch(sub_key)
            all_data.extend(part_data)
        return all_data
    
    def iter_all_batches(self) -> Iterator[tuple[str, List[Dict]]]:
        """
        Generator: Yield batches one at a time (memory-efficient).
        Use this during finalization to avoid loading everything at once.
        """
        if self.STORAGE_BACKEND == "redis":
            pattern = f"{self.base_key}:batch:*"
            keys = self.redis.keys(pattern)
            
            for key in keys:
                key_str = key.decode() if isinstance(key, bytes) else key
                
                if ":manifest:" in key_str:
                    continue
                
                try:
                    data = self.load_batch(key_str)
                    batch_id = key_str.split(":")[-1]
                    yield batch_id, data
                except Exception as e:
                    print(f"⚠ Failed to load batch {key_str}: {e}")
                    continue
        
        else:
            if not os.path.exists(self.file_dir):
                return
            
            for filename in sorted(os.listdir(self.file_dir)):
                if filename.startswith("batch_") and filename.endswith(".pkl"):
                    batch_id = filename.replace("batch_", "").replace(".pkl", "")
                    file_path = os.path.join(self.file_dir, filename)
                    
                    try:
                        data = self.load_batch(file_path)
                        yield batch_id, data
                    except Exception as e:
                        print(f"⚠ Failed to load {filename}: {e}")
                        continue
    
    def get_total_faces_estimate(self) -> int:
        """Estimate total stored faces without loading them."""
        if self.STORAGE_BACKEND == "redis":
            pattern = f"{self.base_key}:batch:*"
            keys = self.redis.keys(pattern)
            
            total = 0
            for key in keys:
                key_str = key.decode() if isinstance(key, bytes) else key
                if ":manifest:" in key_str:
                    continue
                size_bytes = self.redis.strlen(key)
                total += max(1, size_bytes // 500)
            
            return total
        
        else:
            count = 0
            if os.path.exists(self.file_dir):
                for filename in os.listdir(self.file_dir):
                    if filename.endswith(".pkl"):
                        count += 1
            return count * 15
    
    def cleanup(self):
        """Remove all stored embeddings for this event."""
        if self.STORAGE_BACKEND == "redis":
            pattern = f"{self.base_key}:*"
            keys = self.redis.keys(pattern)
            
            if keys:
                deleted = self.redis.delete(*keys)
                print(f"🧹 Cleaned up {deleted} Redis embedding keys")
        
        else:
            if os.path.exists(self.file_dir):
                shutil.rmtree(self.file_dir)
                print(f"🧹 Cleaned up embedding directory: {self.file_dir}")
    
    def get_storage_stats(self) -> dict:
        """Return statistics about current storage usage."""
        stats = {
            "backend": self.STORAGE_BACKEND,
            "event_id": self.event_id,
            "total_batches": 0,
            "estimated_faces": 0,
            "estimated_size_mb": 0,
        }
        
        if self.STORAGE_BACKEND == "redis":
            pattern = f"{self.base_key}:batch:*"
            keys = self.redis.keys(pattern)
            
            stats["total_batches"] = len([k for k in keys if b":manifest:" not in k])
            stats["estimated_faces"] = self.get_total_faces_estimate()
            
            total_size = 0
            for key in keys:
                size = self.redis.strlen(key)
                total_size += size
            stats["estimated_size_mb"] = total_size / (1024 * 1024)
        
        else:
            if os.path.exists(self.file_dir):
                files = [f for f in os.listdir(self.file_dir) if f.endswith(".pkl")]
                stats["total_batches"] = len(files)
                
                total_size = sum(
                    os.path.getsize(os.path.join(self.file_dir, f)) 
                    for f in files
                )
                stats["estimated_size_mb"] = total_size / (1024 * 1024)
        
        return stats