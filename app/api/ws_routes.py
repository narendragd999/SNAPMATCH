"""
app/api/ws_routes.py

WebSocket endpoint for real-time slideshow updates.

This module provides WebSocket connections for:
  - Live slideshow photo updates
  - Real-time notification when new photos are uploaded/processed
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session
from typing import Dict, Set
import asyncio
import json

from app.database.db import SessionLocal
from app.models.event import Event
from app.models.photo import Photo
from app.services import storage_service

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTION MANAGER
# ═══════════════════════════════════════════════════════════════════════════════

class SlideshowConnectionManager:
    """
    Manages WebSocket connections for slideshow updates.
    Uses event_id as the room key for broadcasting.
    """
    def __init__(self):
        # event_id -> set of websocket connections
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, event_id: int):
        """Accept and register a new WebSocket connection"""
        await websocket.accept()
        async with self._lock:
            if event_id not in self.active_connections:
                self.active_connections[event_id] = set()
            self.active_connections[event_id].add(websocket)
        print(f"[WS] Client connected to slideshow event {event_id}. Total: {len(self.active_connections.get(event_id, []))}")

    async def disconnect(self, websocket: WebSocket, event_id: int):
        """Remove a WebSocket connection"""
        async with self._lock:
            if event_id in self.active_connections:
                self.active_connections[event_id].discard(websocket)
                if not self.active_connections[event_id]:
                    del self.active_connections[event_id]
        print(f"[WS] Client disconnected from slideshow event {event_id}")

    async def broadcast_to_event(self, event_id: int, message: dict):
        """Broadcast a message to all connections for a specific event"""
        if event_id not in self.active_connections:
            return

        dead_connections = set()
        for connection in self.active_connections[event_id]:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.add(connection)

        # Clean up dead connections
        if dead_connections:
            async with self._lock:
                for conn in dead_connections:
                    self.active_connections[event_id].discard(conn)

    async def broadcast_new_photo(self, event_id: int, photo_data: dict):
        """Broadcast a new photo notification to all slideshow viewers"""
        await self.broadcast_to_event(event_id, {
            "type": "new_photo",
            "data": photo_data
        })


# Global connection manager
slideshow_manager = SlideshowConnectionManager()


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET ENDPOINT
# ═══════════════════════════════════════════════════════════════════════════════

@router.websocket("/ws/slideshow/{public_token}")
async def slideshow_websocket(
    websocket: WebSocket,
    public_token: str,
    last_id: int = Query(default=0)
):
    """
    WebSocket endpoint for real-time slideshow updates.

    Flow:
    1. Client connects with their last seen photo ID
    2. Server sends any new photos since last_id
    3. Server keeps connection alive and pushes new photos as they're processed

    Message Types:
    - new_photo: A new photo is available
    - ping/pong: Keep-alive
    """
    db: Session = SessionLocal()
    event_id = None

    try:
        # Get event
        event = db.query(Event).filter(Event.public_token == public_token).first()
        if not event:
            await websocket.close(code=4004, reason="Event not found")
            return

        if not event.slideshow_enabled:
            await websocket.close(code=4003, reason="Slideshow not enabled")
            return

        event_id = event.id

        # Connect
        await slideshow_manager.connect(websocket, event_id)

        # Send initial confirmation
        await websocket.send_json({
            "type": "connected",
            "event_id": event_id,
            "event_name": event.name,
            "total_photos": event.image_count
        })

        # If client has a last_id, send new photos
        if last_id > 0:
            new_photos = db.query(Photo).filter(
                Photo.event_id == event_id,
                Photo.status == "processed",
                Photo.approval_status == "approved",
                Photo.id > last_id
            ).order_by(Photo.id.asc()).all()

            for photo in new_photos:
                image_name = photo.optimized_filename or photo.stored_filename
                if image_name:
                    await websocket.send_json({
                        "type": "new_photo",
                        "data": {
                            "id": photo.id,
                            "image_name": image_name,
                            "url": storage_service.get_file_url(event_id, image_name),
                            "uploaded_at": photo.uploaded_at.isoformat() if photo.uploaded_at else None,
                            "scene_label": photo.scene_label,
                        }
                    })

        # Keep connection alive and listen for messages
        while True:
            try:
                # Wait for any message from client (ping/pong or commands)
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)

                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})

                elif data.get("type") == "get_latest":
                    # Client requests latest photos after a specific ID
                    request_last_id = data.get("last_id", 0)
                    new_photos = db.query(Photo).filter(
                        Photo.event_id == event_id,
                        Photo.status == "processed",
                        Photo.approval_status == "approved",
                        Photo.id > request_last_id
                    ).order_by(Photo.id.asc()).limit(20).all()

                    for photo in new_photos:
                        image_name = photo.optimized_filename or photo.stored_filename
                        if image_name:
                            await websocket.send_json({
                                "type": "new_photo",
                                "data": {
                                    "id": photo.id,
                                    "image_name": image_name,
                                    "url": storage_service.get_file_url(event_id, image_name),
                                    "uploaded_at": photo.uploaded_at.isoformat() if photo.uploaded_at else None,
                                    "scene_label": photo.scene_label,
                                }
                            })

            except asyncio.TimeoutError:
                # Send ping to check connection
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        if event_id:
            await slideshow_manager.disconnect(websocket, event_id)
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTION FOR BROADCASTING NEW PHOTOS
# ═══════════════════════════════════════════════════════════════════════════════

async def notify_new_photo(event_id: int, photo_id: int):
    """
    Call this function when a new photo is processed.
    It will broadcast to all connected slideshow viewers.

    Usage in photo processing tasks:
        from app.api.ws_routes import notify_new_photo
        await notify_new_photo(event_id, photo.id)
    """
    db: Session = SessionLocal()
    try:
        photo = db.query(Photo).filter(Photo.id == photo_id).first()
        if not photo:
            return

        event = db.query(Event).filter(Event.id == event_id).first()
        if not event or not event.slideshow_enabled:
            return

        image_name = photo.optimized_filename or photo.stored_filename
        if image_name:
            await slideshow_manager.broadcast_new_photo(event_id, {
                "id": photo.id,
                "image_name": image_name,
                "url": storage_service.get_file_url(event_id, image_name),
                "uploaded_at": photo.uploaded_at.isoformat() if photo.uploaded_at else None,
                "scene_label": photo.scene_label,
            })
    finally:
        db.close()


def notify_new_photo_sync(event_id: int, photo_id: int):
    """
    Synchronous wrapper for notify_new_photo.
    Use this in Celery tasks where async isn't available.
    """
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(notify_new_photo(event_id, photo_id))
    except RuntimeError:
        # No event loop, create one
        asyncio.run(notify_new_photo(event_id, photo_id))