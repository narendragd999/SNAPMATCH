"""
app/api/analytics_routes.py

Analytics API Routes — Event analytics, tracking, and export.

Endpoints:
  GET  /analytics/event/{event_id}       → Get event analytics
  POST /analytics/event/{event_id}/track → Track an event (view, match, download)
  GET  /admin/activity-logs              → Get user activity logs (admin)
  GET  /admin/export/{type}              → Export data as CSV
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, or_
from app.database.db import SessionLocal, get_db
from app.models.user import User
from app.models.event import Event
from app.models.event_order import EventOrder
from app.models.event_analytics import EventAnalytics, EventAnalyticsTotal
from app.models.user_activity_log import UserActivityLog, ActivityType
from app.core.dependencies import get_current_user, get_db
from datetime import datetime, date, timedelta
from typing import Optional
from collections import defaultdict
import csv
import io

router = APIRouter(tags=["analytics"])


def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── EVENT ANALYTICS ────────────────────────────────────────────────────────────

@router.get("/analytics/event/{event_id}")
def get_event_analytics(
    event_id: int,
    days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get analytics for a specific event (owner or admin only)."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Check access: owner or admin
    if event.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    
    # Get totals
    totals = db.query(EventAnalyticsTotal).filter(
        EventAnalyticsTotal.event_id == event_id
    ).first()
    
    # Get daily analytics for the past N days
    start_date = date.today() - timedelta(days=days)
    daily_analytics = (
        db.query(EventAnalytics)
        .filter(
            EventAnalytics.event_id == event_id,
            EventAnalytics.date >= start_date,
        )
        .order_by(EventAnalytics.date.asc())
        .all()
    )
    
    # Fill missing days with zeros
    daily_data = {}
    for da in daily_analytics:
        daily_data[da.date] = {
            "date": da.date.isoformat(),
            "views": da.page_views,
            "matches": da.face_matches,
            "downloads": da.downloads,
            "guest_uploads": da.guest_uploads,
        }
    
    # Fill gaps
    chart_data = []
    current = start_date
    end = date.today()
    while current <= end:
        if current in daily_data:
            chart_data.append(daily_data[current])
        else:
            chart_data.append({
                "date": current.isoformat(),
                "views": 0,
                "matches": 0,
                "downloads": 0,
                "guest_uploads": 0,
            })
        current += timedelta(days=1)
    
    # Calculate summary stats
    total_views = sum(d["views"] for d in chart_data)
    total_matches = sum(d["matches"] for d in chart_data)
    total_downloads = sum(d["downloads"] for d in chart_data)
    total_guest = sum(d["guest_uploads"] for d in chart_data)
    
    return {
        "event_id": event_id,
        "event_name": event.name,
        "period_days": days,
        "totals": {
            "views": totals.total_views if totals else 0,
            "matches": totals.total_matches if totals else 0,
            "downloads": totals.total_downloads if totals else 0,
            "guest_uploads": totals.total_guest_uploads if totals else 0,
        },
        "period_summary": {
            "views": total_views,
            "matches": total_matches,
            "downloads": total_downloads,
            "guest_uploads": total_guest,
        },
        "daily_chart": chart_data,
        "event_info": {
            "image_count": event.image_count,
            "total_faces": event.total_faces,
            "total_clusters": event.total_clusters,
            "processing_status": event.processing_status,
            "created_at": event.created_at.isoformat() if event.created_at else None,
            "expires_at": event.expires_at.isoformat() if event.expires_at else None,
        },
    }


@router.post("/analytics/event/{event_id}/track")
def track_event_activity(
    event_id: int,
    activity_type: str = Query(..., description="view, match, download, or guest_upload"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Track an activity for event analytics."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Map activity type to column
    valid_types = {
        "view": "page_views",
        "match": "face_matches",
        "download": "downloads",
        "guest_upload": "guest_uploads",
    }
    
    if activity_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid activity type. Use: {list(valid_types.keys())}")
    
    column = valid_types[activity_type]
    today = date.today()
    
    # Update or create daily snapshot
    daily = db.query(EventAnalytics).filter(
        EventAnalytics.event_id == event_id,
        EventAnalytics.date == today,
    ).first()
    
    if not daily:
        daily = EventAnalytics(event_id=event_id, date=today)
        db.add(daily)
    
    # Increment the appropriate counter
    current_val = getattr(daily, column) or 0
    setattr(daily, column, current_val + 1)
    
    # Update totals
    totals = db.query(EventAnalyticsTotal).filter(
        EventAnalyticsTotal.event_id == event_id
    ).first()
    
    if not totals:
        totals = EventAnalyticsTotal(event_id=event_id)
        db.add(totals)
    
    total_col = f"total_{column.replace('page_', '')}"
    if column == "page_views":
        total_col = "total_views"
        totals.last_view_at = datetime.utcnow()
    elif column == "face_matches":
        total_col = "total_matches"
        totals.last_match_at = datetime.utcnow()
    elif column == "downloads":
        total_col = "total_downloads"
        totals.last_download_at = datetime.utcnow()
    elif column == "guest_uploads":
        total_col = "total_guest_uploads"
    
    current_total = getattr(totals, total_col) or 0
    setattr(totals, total_col, current_total + 1)
    
    db.commit()
    
    return {"success": True, "tracked": activity_type}


# ── USER ACTIVITY LOGS ──────────────────────────────────────────────────────────

@router.get("/admin/activity-logs")
def get_activity_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    user_id: Optional[int] = Query(None),
    activity_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: str = Query(""),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Get user activity logs (admin only)."""
    query = db.query(UserActivityLog)
    
    # Filters
    if user_id:
        query = query.filter(UserActivityLog.user_id == user_id)
    if activity_type:
        query = query.filter(UserActivityLog.activity_type == activity_type)
    if status:
        query = query.filter(UserActivityLog.status == status)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                UserActivityLog.action.ilike(search_term),
                UserActivityLog.description.ilike(search_term),
                UserActivityLog.ip_address.ilike(search_term),
            )
        )
    
    total = query.count()
    logs = query.order_by(UserActivityLog.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    
    # Enrich with user emails
    result = []
    for log in logs:
        user = db.query(User).filter(User.id == log.user_id).first() if log.user_id else None
        result.append({
            "id": log.id,
            "user_id": log.user_id,
            "user_email": user.email if user else "anonymous",
            "activity_type": log.activity_type,
            "action": log.action,
            "description": log.description,
            "event_id": log.event_id,
            "order_id": log.order_id,
            "ip_address": log.ip_address,
            "status": log.status,
            "error_message": log.error_message,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        })
    
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": (total + limit - 1) // limit,
        "logs": result,
    }


@router.get("/admin/activity-logs/stats")
def get_activity_stats(
    days: int = Query(7, ge=1, le=30),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Get activity log statistics."""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Activity counts by type
    activity_counts = (
        db.query(
            UserActivityLog.activity_type,
            UserActivityLog.status,
            func.count(UserActivityLog.id).label("count")
        )
        .filter(UserActivityLog.created_at >= start_date)
        .group_by(UserActivityLog.activity_type, UserActivityLog.status)
        .all()
    )
    
    # Daily activity trend
    daily_activity = (
        db.query(
            func.date(UserActivityLog.created_at).label("date"),
            func.count(UserActivityLog.id).label("count")
        )
        .filter(UserActivityLog.created_at >= start_date)
        .group_by(func.date(UserActivityLog.created_at))
        .order_by(func.date(UserActivityLog.created_at))
        .all()
    )
    
    # Top active users
    top_users = (
        db.query(
            User.email,
            func.count(UserActivityLog.id).label("activity_count")
        )
        .join(UserActivityLog, User.id == UserActivityLog.user_id)
        .filter(UserActivityLog.created_at >= start_date)
        .group_by(User.id)
        .order_by(desc("activity_count"))
        .limit(10)
        .all()
    )
    
    return {
        "period_days": days,
        "activity_breakdown": [
            {"type": t, "status": s, "count": c}
            for t, s, c in activity_counts
        ],
        "daily_trend": [
            {"date": str(d), "count": c}
            for d, c in daily_activity
        ],
        "top_users": [
            {"email": email, "count": count}
            for email, count in top_users
        ],
    }


# ── EXPORT REPORTS ──────────────────────────────────────────────────────────────

@router.get("/admin/export/{export_type}")
def export_data(
    export_type: str,
    format: str = Query("csv", description="csv or json"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """
    Export data as CSV or JSON.
    
    export_type: orders, users, events, activity_logs
    """
    # Parse dates
    start_dt = None
    end_dt = None
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            end_dt = end_dt.replace(hour=23, minute=59, second=59)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")
    
    # Build query based on export type
    if export_type == "orders":
        query = db.query(EventOrder)
        if start_dt:
            query = query.filter(EventOrder.created_at >= start_dt)
        if end_dt:
            query = query.filter(EventOrder.created_at <= end_dt)
        orders = query.order_by(EventOrder.created_at.desc()).all()
        
        data = []
        for o in orders:
            user = db.query(User).filter(User.id == o.user_id).first() if o.user_id else None
            data.append({
                "order_id": o.id,
                "event_name": o.event_name,
                "user_email": user.email if user else "deleted",
                "amount_inr": (o.amount_paise or 0) / 100,
                "photo_quota": o.photo_quota,
                "guest_quota": o.guest_quota,
                "validity_days": o.validity_days,
                "status": o.status,
                "razorpay_order_id": o.razorpay_order_id,
                "razorpay_payment_id": o.razorpay_payment_id,
                "created_at": o.created_at.isoformat() if o.created_at else "",
                "paid_at": o.paid_at.isoformat() if o.paid_at else "",
            })
        filename = f"orders_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
    elif export_type == "users":
        query = db.query(User)
        if start_dt:
            query = query.filter(User.created_at >= start_dt)
        if end_dt:
            query = query.filter(User.created_at <= end_dt)
        users = query.order_by(User.created_at.desc()).all()
        
        data = []
        for u in users:
            event_count = db.query(Event).filter(Event.owner_id == u.id).count()
            data.append({
                "user_id": u.id,
                "email": u.email,
                "role": u.role,
                "plan_type": u.plan_type,
                "free_event_used": u.free_event_used,
                "event_count": event_count,
                "created_at": u.created_at.isoformat() if u.created_at else "",
            })
        filename = f"users_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
    elif export_type == "events":
        query = db.query(Event)
        if start_dt:
            query = query.filter(Event.created_at >= start_dt)
        if end_dt:
            query = query.filter(Event.created_at <= end_dt)
        events = query.order_by(Event.created_at.desc()).all()
        
        data = []
        for e in events:
            owner = db.query(User).filter(User.id == e.owner_id).first()
            data.append({
                "event_id": e.id,
                "event_name": e.name,
                "owner_email": owner.email if owner else "deleted",
                "processing_status": e.processing_status,
                "image_count": e.image_count,
                "total_faces": e.total_faces,
                "total_clusters": e.total_clusters,
                "photo_quota": e.photo_quota,
                "guest_quota": e.guest_quota,
                "is_free_tier": e.is_free_tier,
                "payment_status": e.payment_status,
                "amount_paid_inr": (e.amount_paid_paise or 0) / 100,
                "expires_at": e.expires_at.isoformat() if e.expires_at else "",
                "created_at": e.created_at.isoformat() if e.created_at else "",
            })
        filename = f"events_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
    elif export_type == "activity_logs":
        query = db.query(UserActivityLog)
        if start_dt:
            query = query.filter(UserActivityLog.created_at >= start_dt)
        if end_dt:
            query = query.filter(UserActivityLog.created_at <= end_dt)
        logs = query.order_by(UserActivityLog.created_at.desc()).limit(10000).all()
        
        data = []
        for log in logs:
            user = db.query(User).filter(User.id == log.user_id).first() if log.user_id else None
            data.append({
                "log_id": log.id,
                "user_email": user.email if user else "anonymous",
                "activity_type": log.activity_type,
                "action": log.action,
                "description": log.description,
                "event_id": log.event_id,
                "ip_address": log.ip_address,
                "status": log.status,
                "created_at": log.created_at.isoformat() if log.created_at else "",
            })
        filename = f"activity_logs_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
    else:
        raise HTTPException(status_code=400, detail=f"Invalid export type. Use: orders, users, events, activity_logs")
    
    # Return based on format
    if format == "json":
        return {"data": data, "count": len(data)}
    
    # CSV format
    output = io.StringIO()
    if data:
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
    
    csv_content = output.getvalue()
    
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}.csv"
        }
    )


# ── HELPER: LOG ACTIVITY ─────────────────────────────────────────────────────────

def log_activity(
    db: Session,
    activity_type: str,
    action: str,
    user_id: Optional[int] = None,
    event_id: Optional[int] = None,
    order_id: Optional[int] = None,
    description: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    request_path: Optional[str] = None,
    request_method: Optional[str] = None,
    status: str = "success",
    error_message: Optional[str] = None,
    metadata: Optional[dict] = None,
):
    """Helper function to log user activity."""
    import json as json_lib
    
    log = UserActivityLog(
        user_id=user_id,
        activity_type=activity_type,
        action=action,
        description=description,
        event_id=event_id,
        order_id=order_id,
        ip_address=ip_address,
        user_agent=user_agent,
        request_path=request_path,
        request_method=request_method,
        status=status,
        error_message=error_message,
        metadata_json=json_lib.dumps(metadata) if metadata else None,
    )
    db.add(log)
    db.commit()
    return log
