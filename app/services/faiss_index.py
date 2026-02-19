import faiss
import numpy as np
import os
from app.core.config import INDEXES_PATH


class EventFaissIndex:
    def __init__(self, event_id: int, dimension=512):
        self.event_id = event_id
        self.dimension = dimension

        os.makedirs(INDEXES_PATH, exist_ok=True)

        self.index_path = os.path.join(
            INDEXES_PATH,
            f"event_{event_id}.index"
        )
        self.map_path = os.path.join(
            INDEXES_PATH,
            f"event_{event_id}_map.npy"
        )

        if os.path.exists(self.index_path):
            self.index = faiss.read_index(self.index_path)
            self.id_map = np.load(self.map_path).tolist()
        else:
            self.index = faiss.IndexFlatIP(dimension)
            self.id_map = []

    def add_embeddings(self, embeddings, db_ids):

        if not embeddings:
            return

        embeddings = np.array(embeddings).astype("float32")
        faiss.normalize_L2(embeddings)

        self.index.add(embeddings)
        self.id_map.extend(db_ids)

        self.save()

    def search(self, embedding, top_k=20):

        if self.index.ntotal == 0:
            return []

        embedding = np.array([embedding]).astype("float32")
        faiss.normalize_L2(embedding)

        distances, indices = self.index.search(embedding, top_k)

        results = []

        for idx, score in zip(indices[0], distances[0]):
            if idx != -1 and idx < len(self.id_map):
                results.append({
                    "db_id": self.id_map[idx],
                    "score": float(score)
                })

        return results

    def save(self):
        faiss.write_index(self.index, self.index_path)
        np.save(self.map_path, np.array(self.id_map))
