-- ============================================================
-- reset_processing.sql
-- Resets event processing state WITHOUT deleting uploaded photos.
-- Run this when you want to re-process without re-uploading.
--
-- Usage:
--   docker exec -i event_postgres psql -U postgres -d event_ai < reset_processing.sql
--   OR for a specific event:
--   docker exec -i event_postgres psql -U postgres -d event_ai -v event_id=1 < reset_processing.sql
-- ============================================================

-- 1. Reset ALL photos back to "uploaded" status (keeps the file, just resets state)
UPDATE photos
SET
    status              = 'uploaded',
    optimized_filename  = NULL,
    faces_detected      = 0
WHERE status IN ('processed', 'failed');

-- To reset only one event's photos, use:
-- WHERE event_id = 1 AND status IN ('processed', 'failed');

-- 2. Delete all clusters (face groupings) — rebuilt during processing
DELETE FROM clusters;

-- To delete only one event:
-- DELETE FROM clusters WHERE event_id = 1;

-- 3. Reset event processing status back to pending
UPDATE events
SET
    processing_status     = 'pending',
    processing_progress   = 0,
    processing_started_at = NULL,
    processing_completed_at = NULL,
    total_clusters        = 0,
    total_faces           = 0
WHERE processing_status IN ('completed', 'processing', 'failed');

-- To reset only one event:
-- WHERE id = 1;

-- 4. Clear Redis progress keys (optional — they expire anyway)
-- Run separately: redis-cli -n 0 KEYS "event:*" | xargs redis-cli DEL

-- 5. Confirm results
SELECT
    id,
    name,
    processing_status,
    processing_progress,
    total_clusters,
    total_faces
FROM events
ORDER BY id;

SELECT
    event_id,
    status,
    COUNT(*) as photo_count
FROM photos
GROUP BY event_id, status
ORDER BY event_id, status;
