# app/core/plans.py  — shim, delegates to pricing.py
from app.core.pricing import PLANS  # noqa: F401

PLANS = {
    "free": {
        "event_validity_days": 7,
        "max_events": 5,
        "max_images_per_event": 1000,
    },
    "pro": {
        "event_validity_days": 30,
        "max_events": 10,
        "max_images_per_event": 10000,
    },
    "enterprise": {
        "event_validity_days": 365,
        "max_events": 100,
        "max_images_per_event": 100000,
    }
}
