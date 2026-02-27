import numpy as np
from sklearn.cluster import DBSCAN

def cluster_embeddings(embeddings):
    if len(embeddings) == 0:
        return []

    embeddings = np.array(embeddings)

    # eps = cosine distance threshold = 1 - similarity_threshold
    # eps=0.28 → similarity ≈ 0.72, matching the merge-pass MERGE_THRESHOLD
    # in tasks.py so both stages agree on "same person".
    #
    # Tuning guide (change BOTH eps here AND MERGE_THRESHOLD in tasks.py together):
    #   eps=0.32 (sim≈0.68) → aggressive, fewer clusters, risk of merging different people
    #   eps=0.28 (sim≈0.72) → balanced default ✓
    #   eps=0.22 (sim≈0.78) → conservative, more clusters, safer for lookalikes
    #
    # min_samples=1: every face gets assigned — no outliers discarded.
    clustering = DBSCAN(
        eps=0.28,
        min_samples=1,
        metric="cosine"
    ).fit(embeddings)

    return clustering.labels_.tolist()