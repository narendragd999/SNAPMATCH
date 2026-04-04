"""
app/services/clustering_service.py

Enhanced clustering service with size-aware merge logic.

IMPROVEMENTS:
1. Skips expensive merge pass for very large events (>2000 clusters)
2. Uses FAISS-accelerated nearest centroid search (O(n*log n)) instead of O(n²)
3. Union-Find data structure for efficient merge execution
4. Configurable thresholds via environment variables
"""

import numpy as np
from typing import List, Tuple, Optional
from sklearn.cluster import DBSCAN
import time
import os

# ─── CONFIGURATION ──────────────────────────────
EPS_DEFAULT = 0.30  # Cosine distance threshold
MIN_SAMPLES_DEFAULT = 1  # Every face gets assigned
MERGE_THRESHOLD = float(os.getenv("CLUSTER_MERGE_THRESHOLD", "0.72"))
MERGE_CLUSTER_CAP = int(os.getenv("MERGE_CLUSTER_CAP", "2000"))
MERGE_CHUNK_SIZE = int(os.getenv("MERGE_CHUNK_SIZE", "500"))


def cluster_embeddings(embeddings: np.ndarray) -> List[int]:
    """
    Main clustering entry point with automatic merge decision.
    
    Args:
        embeddings: Normalized face embedding matrix (n_samples x dim)
        
    Returns:
        List of cluster labels (-1 = noise/outlier)
    """
    if len(embeddings) == 0:
        return []

    n_samples = len(embeddings)
    
    print(f"🔬 Clustering {n_samples} embeddings (eps={EPS_DEFAULT})")
    start = time.time()

    # Base DBSCAN clustering
    clustering = DBSCAN(
        eps=EPS_DEFAULT,
        min_samples=MIN_SAMPLES_DEFAULT,
        metric="cosine"
    ).fit(embeddings)

    labels = clustering.labels_.tolist()
    unique_clusters = len(set(l for l in labels if l >= 0))
    
    base_time = time.time() - start
    print(f"   DBSCAN: {unique_clusters} clusters in {base_time:.2f}s")

    # Decide whether to run merge pass
    should_merge = (
        unique_clusters > 1 and
        unique_clusters <= MERGE_CLUSTER_CAP and
        n_samples > 100
    )

    if should_merge:
        print(f"   Running merge pass (threshold={MERGE_THRESHOLD}, cap={MERGE_CLUSTER_CAP})...")
        merge_start = time.time()
        
        labels = _merge_clusters_optimized(
            embeddings, 
            labels,
            chunk_size=MERGE_CHUNK_SIZE
        )
        
        merge_time = time.time() - merge_start
        final_unique = len(set(l for l in labels if l >= 0))
        merged_count = unique_clusters - final_unique
        
        print(
            f"   Merge done: {final_unique} clusters in {merge_time:.2f}s "
            f"(merged {merged_count} groups)"
        )

    elif unique_clusters > MERGE_CLUSTER_CAP:
        print(
            f"   ⚠ SKIPPING MERGE: {unique_clusters} clusters exceeds cap "
            f"({MERGE_CLUSTER_CAP})"
        )

    total_time = time.time() - start
    final_unique = len(set(l for l in labels if l >= 0))
    
    print(f"✅ Total: {final_unique} clusters in {total_time:.2f}s")
    
    return labels


def _merge_clusters_optimized(
    embeddings: np.ndarray, 
    initial_labels: List[int],
    chunk_size: int = 500
) -> List[int]:
    """
    Optimized merge pass using FAISS for nearest centroid search.
    
    Instead of comparing every cluster against every other (O(n²)),
    we build a FAISS index of centroids and search for nearest neighbors (O(n*log(n))).
    Then use Union-Find to efficiently execute merges.
    """
    import faiss
    
    labels = initial_labels.copy()
    n_samples = len(labels)
    
    # Get unique cluster IDs (excluding noise=-1)
    unique_ids = sorted(set(l for l in labels if l >= 0))
    n_clusters = len(unique_ids)
    
    if n_clusters <= 1:
        return labels  # Nothing to merge
    
    dim = embeddings.shape[1]
    
    # Calculate centroids for each cluster
    print(f"   Calculating centroids for {n_clusters} clusters...")
    centroids = []
    
    for cid in unique_ids:
        mask = [l == cid for l in labels]
        cluster_embeddings = embeddings[mask]
        centroid = cluster_embeddings.mean(axis=0)
        centroids.append(centroid)
    
    centroids_matrix = np.array(centroids, dtype='float32')
    faiss.normalize_L2(centroids_matrix)
    
    # Build FAISS index for fast nearest neighbor search
    print(f"   Building FAISS centroid index...")
    index = faiss.IndexFlatIP(dim)
    index.add(centroids_matrix)
    
    # For each cluster, find nearest neighbors among OTHER clusters
    print(f"   Searching for merge candidates (threshold={MERGE_THRESHOLD})...")
    merge_pairs = []
    
    # Process in chunks to manage memory
    for i in range(0, n_clusters, chunk_size):
        chunk_end = min(i + chunk_size, n_clusters)
        chunk_centroids = centroids_matrix[i:chunk_end]
        
        # Search for k nearest neighbors (k=3 gives top 2 others besides self)
        k = min(3, n_clusters)
        D, I = index.search(chunk_centroids, k)
        
        for local_idx in range(chunk_end - i):
            global_idx = i + local_idx
            cid_a = unique_ids[global_idx]
            
            # Check neighbors (skip self at position 0)
            for rank in range(1, k):
                neighbor_idx = I[local_idx][rank]
                
                if neighbor_idx < 0 or neighbor_idx >= n_clusters:
                    continue
                    
                cid_b = unique_ids[neighbor_idx]
                
                if cid_a != cid_b:  # Different clusters
                    similarity = D[local_idx][rank]
                    
                    if similarity >= MERGE_THRESHOLD:
                        # Enforce ordering to avoid duplicate pairs
                        pair = tuple(sorted([cid_a, cid_b]))
                        merge_pairs.append((pair, similarity))
    
    print(f"   Found {len(merge_pairs)} potential merge pairs")
    
    if not merge_pairs:
        return labels  # No merges needed
    
    # Execute merges using Union-Find
    print(f"   Executing merges using Union-Find...")
    labels = _execute_union_find_merges(labels, merge_pairs, unique_ids)
    
    return labels


def _execute_union_find_merges(
    labels: List[int], 
    merge_pairs: List[Tuple[Tuple[int, int], float]],
    cluster_ids: List[int]
) -> List[int]:
    """
    Execute cluster merges using Union-Find data structure.
    
    Time complexity: O(n * α(n)) where α is inverse Ackermann (nearly constant).
    """
    # Initialize Union-Find parent pointers
    parent = {cid: cid for cid in cluster_ids}
    rank = {cid: 0 for cid in cluster_ids}
    
    def find(x: int) -> int:
        """Find root with path compression."""
        if parent[x] != x:
            parent[x] = find(parent[x])  # Path compression
        return parent[x]
    
    def union(x: int, y: int) -> None:
        """Union by rank."""
        root_x, root_y = find(x), find(y)
        
        if root_x == root_y:
            return  # Already in same set
        
        # Attach smaller tree under root of larger tree
        if rank[root_x] < rank[root_y]:
            parent[root_x] = root_y
        elif rank[root_x] > rank[root_y]:
            parent[root_y] = root_x
        else:
            parent[root_y] = root_x
            rank[root_x] += 1
    
    # Sort merges by similarity (highest first) for deterministic behavior
    merge_pairs.sort(key=lambda x: -x[1])
    
    # Execute merges
    merge_count = 0
    for (cid_a, cid_b), similarity in merge_pairs:
        if find(cid_a) != find(cid_b):
            union(cid_a, cid_b)
            merge_count += 1
    
    print(f"   Executed {merge_count} merges")
    
    # Relabel all clusters to new sequential IDs
    root_to_new_id = {}
    next_label = 0
    
    new_labels = labels.copy()
    
    for i, old_label in enumerate(labels):
        if old_label < 0:
            continue  # Keep noise as -1
        
        root = find(old_label)
        
        if root not in root_to_new_id:
            root_to_new_id[root] = next_label
            next_label += 1
        
        new_labels[i] = root_to_new_id[root]
    
    final_clusters = next_label
    initial_clusters = len(cluster_ids)
    
    print(
        f"   Result: {initial_clusters} → {final_clusters} clusters "
        f"(merged {initial_clusters - final_clusters} groups)"
    )
    
    return new_labels