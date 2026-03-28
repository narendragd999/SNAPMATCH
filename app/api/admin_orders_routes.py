"""
app/api/admin_orders_routes.py

Admin Orders Management — View all event orders (paid + free events).

Endpoints:
  GET /admin/orders/stats   → get order statistics (MUST be before /orders/{order_id})
  GET /admin/orders         → list all orders with pagination and filters
  GET /admin/orders/{order_id} → get order details
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, extract
from app.database.db import SessionLocal
from app.models.user import User
from app.models.event import Event
from app.models.event_order import EventOrder
from app.core.dependencies import get_current_user, get_db
from datetime import datetime, timedelta
from typing import Optional, List
from collections import defaultdict

router = APIRouter(prefix="/admin", tags=["admin-orders"])


def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── GET /admin/orders/stats ────────────────────────────────────────────────────
# IMPORTANT: This route MUST come before /orders/{order_id} to avoid route conflicts

@router.get("/orders/stats")
def get_orders_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Get summary statistics for orders."""
    
    # Total orders count
    total_orders = db.query(EventOrder).count()
    
    # Count by status
    status_counts = (
        db.query(EventOrder.status, func.count(EventOrder.id))
        .group_by(EventOrder.status)
        .all()
    )
    
    # Total revenue (sum of paid orders)
    paid_orders = db.query(EventOrder).filter(EventOrder.status == "paid").all()
    total_revenue_paise = sum(o.amount_paise or 0 for o in paid_orders)
    
    # Free events count - use is_(None) for proper SQL generation
    free_events_count = db.query(EventOrder).filter(
        or_(EventOrder.status == "free", EventOrder.razorpay_order_id.is_(None))
    ).count()
    
    # Orders this month
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    orders_this_month = db.query(EventOrder).filter(
        EventOrder.created_at >= month_start
    ).count()
    
    revenue_this_month_paise = sum(
        o.amount_paise or 0 
        for o in db.query(EventOrder).filter(
            EventOrder.status == "paid",
            EventOrder.paid_at >= month_start
        ).all()
    )
    
    return {
        "total_orders":               total_orders,
        "status_distribution":        {s: c for s, c in status_counts},
        "total_revenue_paise":        total_revenue_paise,
        "total_revenue_inr":          total_revenue_paise / 100,
        "total_revenue_formatted":    f"₹{total_revenue_paise / 100:,.2f}",
        "free_events_count":          free_events_count,
        "paid_events_count":          total_orders - free_events_count,
        "orders_this_month":          orders_this_month,
        "revenue_this_month_paise":   revenue_this_month_paise,
        "revenue_this_month_inr":     revenue_this_month_paise / 100,
        "revenue_this_month_formatted": f"₹{revenue_this_month_paise / 100:,.2f}",
    }


# ── GET /admin/orders/analytics ─────────────────────────────────────────────────
# IMPORTANT: This route MUST come before /orders/{order_id} to avoid route conflicts

@router.get("/orders/analytics")
def get_revenue_analytics(
    period: str = Query("30d", description="Period: 7d, 30d, 90d, 12m"),
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    Get detailed revenue analytics for charts.
    
    Returns:
    - Daily/Weekly/Monthly revenue trends
    - Payment method breakdown
    - MRR (Monthly Recurring Revenue) tracking
    - Growth metrics
    """
    now = datetime.utcnow()
    
    # Determine date range based on period
    if period == "7d":
        start_date = now - timedelta(days=7)
        group_format = "%Y-%m-%d"  # Daily
        period_label = "Last 7 Days"
    elif period == "30d":
        start_date = now - timedelta(days=30)
        group_format = "%Y-%m-%d"  # Daily
        period_label = "Last 30 Days"
    elif period == "90d":
        start_date = now - timedelta(days=90)
        group_format = "%Y-%W"  # Weekly
        period_label = "Last 90 Days"
    elif period == "12m":
        start_date = now - timedelta(days=365)
        group_format = "%Y-%m"  # Monthly
        period_label = "Last 12 Months"
    else:
        start_date = now - timedelta(days=30)
        group_format = "%Y-%m-%d"
        period_label = "Last 30 Days"
    
    # Get all paid orders in the period
    orders = (
        db.query(EventOrder)
        .filter(
            EventOrder.status == "paid",
            EventOrder.paid_at >= start_date,
            EventOrder.paid_at <= now,
        )
        .order_by(EventOrder.paid_at.asc())
        .all()
    )
    
    # ── Revenue Trends ───────────────────────────────────────────────────────
    revenue_by_period = defaultdict(int)
    orders_by_period = defaultdict(int)
    
    for order in orders:
        if order.paid_at:
            if period in ["7d", "30d"]:
                key = order.paid_at.strftime(group_format)
            elif period == "90d":
                # Weekly grouping
                year, week, _ = order.paid_at.isocalendar()
                key = f"{year}-W{week:02d}"
            else:
                # Monthly grouping
                key = order.paid_at.strftime(group_format)
            
            revenue_by_period[key] += order.amount_paise or 0
            orders_by_period[key] += 1
    
    # Fill missing periods with zeros
    if period in ["7d", "30d"]:
        current = start_date
        while current <= now:
            key = current.strftime("%Y-%m-%d")
            if key not in revenue_by_period:
                revenue_by_period[key] = 0
                orders_by_period[key] = 0
            current += timedelta(days=1)
    
    # Build revenue trend data
    revenue_trend = []
    for key in sorted(revenue_by_period.keys()):
        revenue_inr = revenue_by_period[key] / 100
        revenue_trend.append({
            "date": key,
            "revenue": revenue_inr,
            "revenue_formatted": f"₹{revenue_inr:,.0f}",
            "orders": orders_by_period[key],
        })
    
    # ── MRR Calculation ───────────────────────────────────────────────────────
    # For pay-per-event model, MRR is calculated as total revenue this month
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    mrr_orders = (
        db.query(EventOrder)
        .filter(
            EventOrder.status == "paid",
            EventOrder.paid_at >= month_start,
        )
        .all()
    )
    current_mrr = sum(o.amount_paise or 0 for o in mrr_orders) / 100
    
    # Previous month MRR for comparison
    prev_month_start = (month_start - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    prev_month_orders = (
        db.query(EventOrder)
        .filter(
            EventOrder.status == "paid",
            EventOrder.paid_at >= prev_month_start,
            EventOrder.paid_at < month_start,
        )
        .all()
    )
    prev_mrr = sum(o.amount_paise or 0 for o in prev_month_orders) / 100
    mrr_growth = ((current_mrr - prev_mrr) / prev_mrr * 100) if prev_mrr > 0 else 0
    
    # ── Payment Method Breakdown ─────────────────────────────────────────────
    # Razorpay vs Free events
    total_paid_orders = db.query(EventOrder).filter(EventOrder.status == "paid").count()
    free_orders_count = db.query(EventOrder).filter(EventOrder.status == "free").count()
    created_orders_count = db.query(EventOrder).filter(EventOrder.status == "created").count()
    failed_orders_count = db.query(EventOrder).filter(EventOrder.status == "failed").count()
    
    payment_breakdown = [
        {"name": "Paid (Razorpay)", "value": total_paid_orders, "color": "#10b981"},
        {"name": "Free Tier", "value": free_orders_count, "color": "#8b5cf6"},
        {"name": "Pending", "value": created_orders_count, "color": "#f59e0b"},
        {"name": "Failed", "value": failed_orders_count, "color": "#ef4444"},
    ]
    
    # ── Average Order Value ──────────────────────────────────────────────────
    total_revenue_period = sum(o.amount_paise or 0 for o in orders)
    avg_order_value = (total_revenue_period / len(orders) / 100) if orders else 0
    
    # Previous period comparison
    prev_start = start_date - (now - start_date)
    prev_orders = (
        db.query(EventOrder)
        .filter(
            EventOrder.status == "paid",
            EventOrder.paid_at >= prev_start,
            EventOrder.paid_at < start_date,
        )
        .all()
    )
    prev_revenue = sum(o.amount_paise or 0 for o in prev_orders) / 100
    current_revenue = total_revenue_period / 100
    revenue_growth = ((current_revenue - prev_revenue) / prev_revenue * 100) if prev_revenue > 0 else 0
    
    prev_avg = (sum(o.amount_paise or 0 for o in prev_orders) / len(prev_orders) / 100) if prev_orders else 0
    aov_growth = ((avg_order_value - prev_avg) / prev_avg * 100) if prev_avg > 0 else 0
    
    # ── Top Customers ────────────────────────────────────────────────────────
    top_customers_query = (
        db.query(
            User.email,
            User.plan_type,
            func.count(EventOrder.id).label("order_count"),
            func.sum(EventOrder.amount_paise).label("total_spent"),
        )
        .join(EventOrder, User.id == EventOrder.user_id)
        .filter(EventOrder.status == "paid")
        .group_by(User.id)
        .order_by(func.sum(EventOrder.amount_paise).desc())
        .limit(5)
        .all()
    )
    
    top_customers = [
        {
            "email": email,
            "plan": plan,
            "orders": count,
            "total_spent": (total or 0) / 100,
            "total_formatted": f"₹{(total or 0) / 100:,.0f}",
        }
        for email, plan, count, total in top_customers_query
    ]
    
    # ── Recent Transactions ──────────────────────────────────────────────────
    recent_orders = (
        db.query(EventOrder)
        .filter(EventOrder.status.in_(["paid", "free"]))
        .order_by(EventOrder.created_at.desc())
        .limit(5)
        .all()
    )
    
    recent_transactions = []
    for o in recent_orders:
        user = db.query(User).filter(User.id == o.user_id).first() if o.user_id else None
        recent_transactions.append({
            "id": o.id,
            "event_name": o.event_name,
            "user_email": user.email if user else "deleted",
            "amount": (o.amount_paise or 0) / 100,
            "amount_formatted": f"₹{(o.amount_paise or 0) / 100:,.0f}" if o.amount_paise else "Free",
            "status": o.status,
            "date": o.created_at.isoformat() if o.created_at else None,
        })
    
    return {
        "period": period,
        "period_label": period_label,
        # Revenue trends for charts
        "revenue_trend": revenue_trend,
        # Payment breakdown
        "payment_breakdown": payment_breakdown,
        # MRR metrics
        "mrr": {
            "current": current_mrr,
            "current_formatted": f"₹{current_mrr:,.0f}",
            "previous": prev_mrr,
            "previous_formatted": f"₹{prev_mrr:,.0f}",
            "growth_percent": round(mrr_growth, 1),
            "trend": "up" if mrr_growth > 0 else "down" if mrr_growth < 0 else "neutral",
        },
        # Summary metrics
        "summary": {
            "total_revenue": current_revenue,
            "total_revenue_formatted": f"₹{current_revenue:,.0f}",
            "revenue_growth_percent": round(revenue_growth, 1),
            "total_orders": len(orders),
            "avg_order_value": avg_order_value,
            "avg_order_value_formatted": f"₹{avg_order_value:,.0f}",
            "aov_growth_percent": round(aov_growth, 1),
        },
        # Top customers
        "top_customers": top_customers,
        # Recent transactions
        "recent_transactions": recent_transactions,
    }


# ── GET /admin/orders ─────────────────────────────────────────────────────────

@router.get("/orders")
def list_orders(
    page:       int = Query(1, ge=1),
    limit:      int = Query(20, ge=1, le=100),
    search:     str = Query(""),
    status:     str = Query(""),
    order_type: str = Query(""),  # "paid" | "free" | ""
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """
    List all orders (paid via Razorpay + free tier events).
    
    Free events are shown as orders with:
      - status = "free"
      - amount_paise = 0
      - razorpay_order_id = null
    """
    # Build base query - join EventOrder with Event and User
    query = (
        db.query(EventOrder)
        .outerjoin(Event, EventOrder.event_id == Event.id)
        .outerjoin(User, EventOrder.user_id == User.id)
    )
    
    # Search filter
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                EventOrder.event_name.ilike(search_term),
                User.email.ilike(search_term),
                EventOrder.razorpay_order_id.ilike(search_term),
            )
        )
    
    # Status filter
    if status:
        query = query.filter(EventOrder.status == status)
    
    # Order type filter - use is_not(None) for proper SQL generation
    if order_type == "paid":
        query = query.filter(EventOrder.razorpay_order_id.is_not(None))
    elif order_type == "free":
        query = query.filter(EventOrder.status == "free")
    
    # Get total count
    total = query.count()
    
    # Get paginated results
    orders = query.order_by(EventOrder.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    
    result = []
    for o in orders:
        # Get user email
        user = db.query(User).filter(User.id == o.user_id).first() if o.user_id else None
        
        # Get event details
        event = db.query(Event).filter(Event.id == o.event_id).first() if o.event_id else None
        
        # Format amount in INR
        amount_inr = o.amount_paise / 100 if o.amount_paise else 0
        
        result.append({
            "id":                   o.id,
            "event_id":             o.event_id,
            "event_name":           o.event_name or (event.name if event else "Unknown"),
            "user_id":              o.user_id,
            "user_email":           user.email if user else "deleted",
            "user_plan":            user.plan_type if user else "-",
            "amount_paise":         o.amount_paise,
            "amount_inr":           amount_inr,
            "amount_formatted":     f"₹{amount_inr:,.2f}" if amount_inr > 0 else "Free",
            "photo_quota":          o.photo_quota,
            "guest_quota":          o.guest_quota,
            "validity_days":        o.validity_days,
            "razorpay_order_id":    o.razorpay_order_id,
            "razorpay_payment_id":  o.razorpay_payment_id,
            "razorpay_signature":   o.razorpay_signature,
            "status":               o.status,
            "order_type":           "free" if o.status == "free" or not o.razorpay_order_id else "paid",
            "created_at":           o.created_at.isoformat() if o.created_at else None,
            "paid_at":              o.paid_at.isoformat() if o.paid_at else None,
            # Additional event details
            "event_status":         event.processing_status if event else "unknown",
            "event_public_status":  event.public_status if event else "unknown",
            "event_expires_at":     event.expires_at.isoformat() if event and event.expires_at else None,
            "event_image_count":    event.image_count if event else 0,
        })
    
    return {
        "total":       total,
        "page":        page,
        "limit":       limit,
        "total_pages": (total + limit - 1) // limit,
        "orders":      result,
    }


# ── GET /admin/orders/{order_id} ──────────────────────────────────────────────
# IMPORTANT: This route MUST come AFTER /orders/stats to avoid route conflicts

@router.get("/orders/{order_id}")
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Get detailed information about a specific order."""
    order = db.query(EventOrder).filter(EventOrder.id == order_id).first()
    
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    # Get user details
    user = db.query(User).filter(User.id == order.user_id).first() if order.user_id else None
    
    # Get event details
    event = db.query(Event).filter(Event.id == order.event_id).first() if order.event_id else None
    
    # Calculate quota usage if event exists
    quota_info = {}
    if event:
        quota_info = {
            "photo_quota":      event.photo_quota,
            "photos_used":      event.image_count,
            "photos_remaining": max(0, event.photo_quota - event.image_count),
            "photo_pct":        round((event.image_count / max(event.photo_quota, 1)) * 100, 1),
            "guest_quota":      event.guest_quota,
            "guest_used":       event.guest_uploads_used,
            "guest_remaining":  max(0, event.guest_quota - event.guest_uploads_used),
            "guest_pct":        round((event.guest_uploads_used / max(event.guest_quota, 1)) * 100, 1) if event.guest_quota else 0,
        }
    
    amount_inr = order.amount_paise / 100 if order.amount_paise else 0
    
    return {
        "id":                   order.id,
        "event_id":             order.event_id,
        "event_name":           order.event_name or (event.name if event else "Unknown"),
        "user_id":              order.user_id,
        "user_email":           user.email if user else "deleted",
        "user_plan":            user.plan_type if user else "-",
        "user_created_at":      user.created_at.isoformat() if user and user.created_at else None,
        "amount_paise":         order.amount_paise,
        "amount_inr":           amount_inr,
        "amount_formatted":     f"₹{amount_inr:,.2f}" if amount_inr > 0 else "Free",
        "photo_quota":          order.photo_quota,
        "guest_quota":          order.guest_quota,
        "validity_days":        order.validity_days,
        "razorpay_order_id":    order.razorpay_order_id,
        "razorpay_payment_id":  order.razorpay_payment_id,
        "razorpay_signature":   order.razorpay_signature,
        "status":               order.status,
        "order_type":           "free" if order.status == "free" or not order.razorpay_order_id else "paid",
        "created_at":           order.created_at.isoformat() if order.created_at else None,
        "paid_at":              order.paid_at.isoformat() if order.paid_at else None,
        # Event details
        "event": {
            "id":                 event.id if event else None,
            "name":               event.name if event else None,
            "slug":               event.slug if event else None,
            "public_token":       event.public_token if event else None,
            "processing_status":  event.processing_status if event else None,
            "public_status":      event.public_status if event else None,
            "expires_at":         event.expires_at.isoformat() if event and event.expires_at else None,
            "image_count":        event.image_count if event else 0,
            "total_faces":        event.total_faces if event else 0,
            "total_clusters":     event.total_clusters if event else 0,
            "created_at":         event.created_at.isoformat() if event and event.created_at else None,
            "is_free_tier":       event.is_free_tier if event else False,
        } if event else None,
        # Quota usage
        "quota": quota_info if quota_info else None,
    }