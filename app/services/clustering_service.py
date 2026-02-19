import numpy as np
from sklearn.cluster import DBSCAN

def cluster_embeddings(embeddings):
    if len(embeddings) == 0:
        return []

    embeddings = np.array(embeddings)

    clustering = DBSCAN(
        eps=0.6,
        min_samples=2,
        metric="cosine"
    ).fit(embeddings)

    return clustering.labels_.tolist()
