"""
app/api/guest_upload_utils.py
Shared utilities for guest upload approval workflow.
"""

from app.services import storage_service


def delete_guest_preview(photo) -> None:
    """
    Delete the guest preview thumbnail after approve or reject.
    Works for local, MinIO, and R2 backends via storage_service.
    Safe to call even if the file doesn't exist or column is None.
    """
    if not photo.guest_preview_filename:
        return

    try:
        storage_service.delete_guest_preview(photo.event_id, photo.guest_preview_filename)
        print(f"🗑 Deleted guest preview: {photo.guest_preview_filename}")
    except Exception as e:
        print(f"⚠ Could not delete guest preview {photo.guest_preview_filename}: {e}")
