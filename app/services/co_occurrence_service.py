"""
app/services/co_occurrence_service.py

Co-occurrence analysis service for Group/Family Detection.

This service handles:
1. Building co-occurrence relationships during photo processing
2. Querying "people who appear with you" for search results
3. Identifying relationship strengths between clusters

Performance characteristics:
- Building: O(photos × faces_per_photo²) - typically milliseconds per event
- Querying: O(matched_clusters) - single indexed query per search
"""

from collections import defaultdict
from itertools import combinations
from typing import List, Dict, Set, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from app.models.cluster import Cluster
from app.models.co_occurrence import CoOccurrence


# ── Configuration ─────────────────────────────────────────────────────────────

# Minimum number of photos two people must appear in together
# to be considered a "relationship" (couple, family, friends)
# Set to 1 to show all group photos, can increase for stricter matching
MIN_CO_OCCURRENCE_THRESHOLD = 1

# Minimum co-occurrence count to be considered "strong" relationship
# (e.g., a couple appearing in 20+ photos together)
STRONG_RELATIONSHIP_THRESHOLD = 10


# ── Building Co-occurrence Data ────────────────────────────────────────────────

def build_co_occurrence_index(db: Session, event_id: int) -> int:
    """
    Build co-occurrence relationships for an event.
    
    This should be called during finalize_event after all clusters are created.
    It analyzes which clusters (people) appear together in the same photos.
    
    Args:
        db: Database session
        event_id: Event ID to process
        
    Returns:
        Number of co-occurrence relationships created/updated
    """
    # Get all clusters grouped by image_name
    # Each image can have multiple clusters (multiple faces detected)
    clusters = db.query(Cluster).filter(Cluster.event_id == event_id).all()
    
    # Group clusters by image_name
    image_clusters: Dict[str, Set[int]] = defaultdict(set)
    for cluster in clusters:
        image_clusters[cluster.image_name].add(cluster.cluster_id)
    
    # Count co-occurrences
    # co_occurrence_counts[(a, b)] = number of photos where both appear
    co_occurrence_counts: Dict[Tuple[int, int], int] = defaultdict(int)
    
    for image_name, cluster_ids in image_clusters.items():
        # Only process images with 2+ faces (potential relationships)
        if len(cluster_ids) < 2:
            continue
        
        # Generate all pairs (always store with smaller id first for consistency)
        for cluster_a, cluster_b in combinations(sorted(cluster_ids), 2):
            co_occurrence_counts[(cluster_a, cluster_b)] += 1
    
    if not co_occurrence_counts:
        return 0
    
    # Clear existing co-occurrence data for this event
    db.query(CoOccurrence).filter(CoOccurrence.event_id == event_id).delete()
    
    # Bulk insert new co-occurrence records
    new_records = []
    for (cluster_a, cluster_b), count in co_occurrence_counts.items():
        new_records.append(CoOccurrence(
            event_id=event_id,
            cluster_id_a=cluster_a,
            cluster_id_b=cluster_b,
            photo_count=count,
        ))
    
    db.bulk_save_objects(new_records)
    db.commit()
    
    print(f"📊 Co-occurrence: {len(new_records)} relationships indexed for event {event_id}")
    return len(new_records)


def update_co_occurrence_for_photo(
    db: Session, 
    event_id: int, 
    cluster_ids: List[int]
) -> None:
    """
    Incrementally update co-occurrence for a single new photo.
    
    This can be called for incremental processing instead of rebuilding
    the entire index. Useful for guest upload workflows.
    
    Args:
        db: Database session
        event_id: Event ID
        cluster_ids: List of cluster IDs detected in the new photo
    """
    if len(cluster_ids) < 2:
        return
    
    for cluster_a, cluster_b in combinations(sorted(cluster_ids), 2):
        # Try to find existing record
        existing = db.query(CoOccurrence).filter(
            CoOccurrence.event_id == event_id,
            CoOccurrence.cluster_id_a == cluster_a,
            CoOccurrence.cluster_id_b == cluster_b,
        ).first()
        
        if existing:
            existing.photo_count += 1
        else:
            db.add(CoOccurrence(
                event_id=event_id,
                cluster_id_a=cluster_a,
                cluster_id_b=cluster_b,
                photo_count=1,
            ))
    
    db.commit()


# ── Querying Co-occurrence Data ────────────────────────────────────────────────

def get_co_occurring_clusters(
    db: Session, 
    event_id: int, 
    matched_cluster_ids: List[int],
    min_count: int = MIN_CO_OCCURRENCE_THRESHOLD
) -> Dict[int, List[Dict]]:
    """
    Find clusters that frequently appear with the matched clusters.
    
    This is the core function for "people who appear with you" feature.
    
    Args:
        db: Database session
        event_id: Event ID
        matched_cluster_ids: Cluster IDs from the user's selfie search
        min_count: Minimum co-occurrence count to consider
        
    Returns:
        Dict mapping matched_cluster_id -> list of co-occurring clusters
        Each entry has: {cluster_id, photo_count, strength}
    """
    if not matched_cluster_ids:
        return {}
    
    # Query all co-occurrences involving any matched cluster
    # Using OR to find relationships in either direction
    matched_set = set(matched_cluster_ids)
    
    print(f"👥 [Co-occurrence] Querying: event={event_id}, matched_set={matched_set}, min_count={min_count}")
    
    co_occurrences = db.query(CoOccurrence).filter(
        CoOccurrence.event_id == event_id,
        CoOccurrence.photo_count >= min_count,
        or_(
            CoOccurrence.cluster_id_a.in_(matched_cluster_ids),
            CoOccurrence.cluster_id_b.in_(matched_cluster_ids),
        )
    ).all()
    
    print(f"👥 [Co-occurrence] Found {len(co_occurrences)} raw co-occurrence records")
    
    # Build result map
    result: Dict[int, List[Dict]] = defaultdict(list)
    
    for co in co_occurrences:
        # Determine which cluster is "matched" and which is "co-occurring"
        if co.cluster_id_a in matched_set:
            matched_id = co.cluster_id_a
            co_occurring_id = co.cluster_id_b
        else:
            matched_id = co.cluster_id_b
            co_occurring_id = co.cluster_id_a
        
        # Skip if co-occurring cluster is also in matched set
        # (we want OTHER people, not the user themselves)
        if co_occurring_id in matched_set:
            print(f"👥 [Co-occurrence] Skipping {co.cluster_id_a}-{co.cluster_id_b} (count={co.photo_count}): both in matched_set")
            continue
        
        print(f"👥 [Co-occurrence] Found relationship: matched={matched_id}, co_occurring={co_occurring_id}, count={co.photo_count}")
        
        strength = "strong" if co.photo_count >= STRONG_RELATIONSHIP_THRESHOLD else "moderate"
        
        result[matched_id].append({
            "cluster_id": co_occurring_id,
            "photo_count": co.photo_count,
            "strength": strength,
        })
    
    # Sort by photo_count descending within each group
    for matched_id in result:
        result[matched_id].sort(key=lambda x: x["photo_count"], reverse=True)
    
    return dict(result)


def get_photos_with_co_occurring_clusters(
    db: Session,
    event_id: int,
    matched_cluster_ids: List[int],
    min_count: int = MIN_CO_OCCURRENCE_THRESHOLD,
    limit: int = 100
) -> List[str]:
    """
    Get photos that contain both the matched user AND their co-occurring people.
    
    This returns photos where:
    1. The user appears (matched_cluster_ids)
    2. At least one other person appears who frequently appears with them
    
    Args:
        db: Database session
        event_id: Event ID
        matched_cluster_ids: Cluster IDs from the user's selfie search
        min_count: Minimum co-occurrence count to consider
        limit: Maximum number of photos to return
        
    Returns:
        List of image_names containing the user + co-occurring people
    """
    print(f"👥 [Co-occurrence] get_photos_with_co_occurring_clusters: event={event_id}, matched={matched_cluster_ids}")
    
    # First, get clusters that co-occur with matched clusters
    co_occurring_map = get_co_occurring_clusters(
        db, event_id, matched_cluster_ids, min_count
    )
    
    print(f"👥 [Co-occurrence] co_occurring_map result: {co_occurring_map}")
    
    if not co_occurring_map:
        print(f"👥 [Co-occurrence] No co_occurring_map returned")
        return []
    
    # Collect all co-occurring cluster IDs
    co_occurring_ids = set()
    for relationships in co_occurring_map.values():
        for rel in relationships:
            co_occurring_ids.add(rel["cluster_id"])
    
    print(f"👥 [Co-occurrence] Co-occurring cluster IDs: {co_occurring_ids}")
    
    if not co_occurring_ids:
        print(f"👥 [Co-occurrence] No co_occurring_ids found")
        return []
    
    # Find photos that have BOTH matched AND co-occurring clusters
    # Get all clusters for these images
    print(f"👥 [Co-occurrence] Querying Cluster table for matched={matched_cluster_ids} + co_occurring={list(co_occurring_ids)}")
    
    all_relevant_clusters = db.query(Cluster).filter(
        Cluster.event_id == event_id,
        or_(
            Cluster.cluster_id.in_(matched_cluster_ids),
            Cluster.cluster_id.in_(co_occurring_ids),
        )
    ).all()
    
    print(f"👥 [Co-occurrence] Found {len(all_relevant_clusters)} cluster records from query")
    
    # Group by image_name
    image_cluster_map: Dict[str, Set[int]] = defaultdict(set)
    for cluster in all_relevant_clusters:
        image_cluster_map[cluster.image_name].add(cluster.cluster_id)
    
    print(f"👥 [Co-occurrence] Grouped into {len(image_cluster_map)} unique images")
    
    # Filter images that have BOTH a matched cluster AND a co-occurring cluster
    matched_set = set(matched_cluster_ids)
    result_images = []
    
    for image_name, cluster_ids in image_cluster_map.items():
        has_matched = bool(cluster_ids & matched_set)
        has_co_occurring = bool(cluster_ids & co_occurring_ids)
        
        if has_matched and has_co_occurring:
            result_images.append(image_name)
            print(f"👥 [Co-occurrence] ✅ Photo {image_name} has both: matched={cluster_ids & matched_set}, co_occurring={cluster_ids & co_occurring_ids}")
    
    print(f"👥 [Co-occurrence] Found {len(result_images)} photos with both matched and co-occurring clusters")
    
    return result_images[:limit]


def get_friends_photos(
    db: Session,
    event_id: int,
    matched_cluster_ids: List[int],
    min_count: int = MIN_CO_OCCURRENCE_THRESHOLD,
    limit: int = 500
) -> List[Dict]:
    """
    Main entry point for populating friends_photos in search results.
    
    Returns a list of photos where the user appears with people they
    frequently appear with (family, friends, partners).
    
    Args:
        db: Database session
        event_id: Event ID
        matched_cluster_ids: Cluster IDs from the user's selfie search
        min_count: Minimum co-occurrence threshold
        limit: Max results to return
        
    Returns:
        List of dicts with image_name and co_occurrence metadata
    """
    print(f"👥 [get_friends_photos] CALLED: event_id={event_id}, matched_cluster_ids={matched_cluster_ids}, min_count={min_count}")
    
    if not matched_cluster_ids:
        print(f"👥 [get_friends_photos] No matched cluster IDs provided - returning empty list")
        return []
    
    print(f"👥 [get_friends_photos] Searching for friends photos...")
    
    # Get photos with co-occurring people
    image_names = get_photos_with_co_occurring_clusters(
        db, event_id, matched_cluster_ids, min_count, limit
    )
    
    print(f"👥 [get_friends_photos] get_photos_with_co_occurring_clusters returned {len(image_names)} images")
    
    if not image_names:
        print(f"👥 [get_friends_photos] No image_names returned - returning empty list")
        return []
    
    # Get co-occurrence details for enrichment
    co_occurring_map = get_co_occurring_clusters(
        db, event_id, matched_cluster_ids, min_count
    )
    
    # Calculate total co-occurrence strength per image
    # Get all clusters for the result images
    clusters = db.query(Cluster).filter(
        Cluster.event_id == event_id,
        Cluster.image_name.in_(image_names),
    ).all()
    
    image_cluster_map: Dict[str, Set[int]] = defaultdict(set)
    for cluster in clusters:
        image_cluster_map[cluster.image_name].add(cluster.cluster_id)
    
    # Build enriched result
    results = []
    matched_set = set(matched_cluster_ids)
    
    for image_name in image_names:
        cluster_ids_in_image = image_cluster_map[image_name]
        
        # Calculate aggregate co-occurrence score
        total_co_occurrence = 0
        strengths = []
        
        for matched_id in matched_set & cluster_ids_in_image:
            if matched_id in co_occurring_map:
                for rel in co_occurring_map[matched_id]:
                    if rel["cluster_id"] in cluster_ids_in_image:
                        total_co_occurrence += rel["photo_count"]
                        strengths.append(rel["strength"])
        
        # Determine overall strength
        has_strong = "strong" in strengths
        strength = "strong" if has_strong else ("moderate" if strengths else "weak")
        
        results.append({
            "image_name": image_name,
            "co_occurrence_count": total_co_occurrence,
            "relationship_strength": strength,
        })
    
    # Sort by co_occurrence_count descending (strongest relationships first)
    results.sort(key=lambda x: x["co_occurrence_count"], reverse=True)
    
    return results


# ── Analytics & Debug ──────────────────────────────────────────────────────────

def get_event_relationship_stats(db: Session, event_id: int) -> Dict:
    """
    Get relationship statistics for an event.
    Useful for debugging and analytics.
    """
    total_relationships = db.query(CoOccurrence).filter(
        CoOccurrence.event_id == event_id
    ).count()
    
    strong_relationships = db.query(CoOccurrence).filter(
        CoOccurrence.event_id == event_id,
        CoOccurrence.photo_count >= STRONG_RELATIONSHIP_THRESHOLD
    ).count()
    
    top_relationships = db.query(CoOccurrence).filter(
        CoOccurrence.event_id == event_id
    ).order_by(CoOccurrence.photo_count.desc()).limit(10).all()
    
    return {
        "total_relationships": total_relationships,
        "strong_relationships": strong_relationships,
        "top_relationships": [
            {
                "clusters": [r.cluster_id_a, r.cluster_id_b],
                "photo_count": r.photo_count,
            }
            for r in top_relationships
        ],
    }