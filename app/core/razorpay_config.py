import razorpay
import os

def get_razorpay_client():
    return razorpay.Client(
        auth=(
            os.getenv("RAZORPAY_KEY_ID"),
            os.getenv("RAZORPAY_KEY_SECRET")
        )
    )
