from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app.database.db import SessionLocal
from app.models.user import User
from app.core.dependencies import get_current_user
from app.core.razorpay_config import get_razorpay_client
import os
import hmac
import hashlib
import json

router = APIRouter(prefix="/billing", tags=["billing"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ------------------------------------------------
# Create Order
# ------------------------------------------------
@router.post("/create-order")
def create_order(
    plan: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if plan == "pro":
        amount = 49900   # ₹499
    elif plan == "enterprise":
        amount = 199900  # ₹1999
    else:
        raise HTTPException(status_code=400, detail="Invalid plan")

    client = get_razorpay_client()

    order = client.order.create({
        "amount": amount,
        "currency": "INR",
        "payment_capture": 1,
        "notes": {
            "user_id": str(current_user.id),
            "plan": plan
        }
    })

    return {
        "order_id": order["id"],
        "razorpay_key": os.getenv("RAZORPAY_KEY_ID"),
        "amount": amount,
        "currency": "INR",
        "plan": plan
    }


# ------------------------------------------------
# Webhook — FIXED: correct hmac.new() signature
# ------------------------------------------------
@router.post("/webhook")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):

    env = os.getenv("ENV", "prod")

    if env == "dev":
        # Dev mode: skip signature check, use test payload
        payload = {
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "notes": {
                            "user_id": "1",
                            "plan": "pro"
                        }
                    }
                }
            }
        }

    else:
        body = await request.body()

        if not body:
            raise HTTPException(status_code=400, detail="Empty request body")

        signature = request.headers.get("X-Razorpay-Signature")
        webhook_secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")

        if not signature:
            raise HTTPException(status_code=400, detail="Missing Razorpay signature")

        if not webhook_secret:
            raise HTTPException(status_code=500, detail="Webhook secret not configured")

        # FIX: was hmac.new() — correct signature is hmac.new(key, msg, digestmod)
        expected_signature = hmac.new(
            webhook_secret.encode("utf-8"),
            body,
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_signature):
            raise HTTPException(status_code=400, detail="Invalid signature")

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Handle payment.captured
    if payload.get("event") == "payment.captured":
        payment = payload["payload"]["payment"]["entity"]
        notes = payment.get("notes", {})

        user_id = notes.get("user_id")
        plan = notes.get("plan")

        if user_id and plan:
            user = db.query(User).filter(User.id == int(user_id)).first()

            if user:
                user.plan_type = plan
                db.commit()

                return {
                    "status": "success",
                    "message": f"User {user_id} upgraded to {plan}"
                }

    return {"status": "ignored"}


# ------------------------------------------------
# Payment Status
# ------------------------------------------------
@router.get("/payment-status/{payment_id}")
def payment_status(payment_id: str):
    client = get_razorpay_client()
    try:
        payment = client.payment.fetch(payment_id)
        return payment
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------
# Manual Verify
# ------------------------------------------------
@router.post("/verify-payment")
def verify_payment(
    payment_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    client = get_razorpay_client()

    try:
        payment = client.payment.fetch(payment_id)

        if payment["status"] == "captured":
            notes = payment.get("notes", {})
            user_id = notes.get("user_id")
            plan = notes.get("plan")

            if user_id and plan:
                user = db.query(User).filter(User.id == int(user_id)).first()
                if user:
                    user.plan_type = plan
                    db.commit()
                    return {
                        "status": "success",
                        "message": f"User {user_id} upgraded to {plan}"
                    }

        return {"status": "payment_not_captured"}

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
