"""
app/api/guest_upload_utils.py
Shared utilities for guest upload approval workflow.
"""

import os
from app.core.config import STORAGE_PATH


def delete_guest_preview(photo) -> None:
    """
    Delete the guest preview thumbnail from disk after approve or reject.
    Safe to call even if the file doesn't exist or column is None.
    """
    if not photo.guest_preview_filename:
        return

    preview_path = os.path.join(
        STORAGE_PATH,
        str(photo.event_id),
        "guest_previews",
        photo.guest_preview_filename
    )

    try:
        if os.path.exists(preview_path):
            os.remove(preview_path)
            print(f"🗑 Deleted guest preview: {photo.guest_preview_filename}")
    except Exception as e:
        print(f"⚠ Could not delete preview {photo.guest_preview_filename}: {e}")