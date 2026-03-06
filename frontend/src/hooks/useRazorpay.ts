"use client";
/**
 * frontend/src/hooks/useRazorpay.ts
 *
 * Hook that handles the full Razorpay payment flow:
 *   1. Dynamically loads checkout.js script
 *   2. Opens the Razorpay modal with UPI + cards + netbanking
 *   3. Calls /billing/verify-payment on success
 *   4. Returns status to caller
 */

import { useCallback, useRef } from "react";

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key:          string;
  amount:       number;
  currency:     string;
  order_id:     string;
  name:         string;
  description?: string;
  image?:       string;
  prefill?: {
    name?:  string;
    email?: string;
    contact?: string;
  };
  notes?:       Record<string, string>;
  theme?: { color?: string };
  method?: {
    upi?:        boolean;
    card?:       boolean;
    netbanking?: boolean;
    wallet?:     boolean;
  };
  handler:      (response: RazorpayResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

interface RazorpayResponse {
  razorpay_order_id:   string;
  razorpay_payment_id: string;
  razorpay_signature:  string;
}

interface RazorpayInstance {
  open(): void;
  on(event: string, handler: () => void): void;
}

// ── Script loader (singleton) ─────────────────────────────────────────────────

let scriptLoaded  = false;
let scriptLoading = false;
const callbacks: Array<() => void> = [];

function loadScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();

  return new Promise((resolve) => {
    callbacks.push(resolve);

    if (scriptLoading) return;
    scriptLoading = true;

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      callbacks.forEach((cb) => cb());
      callbacks.length = 0;
    };
    document.body.appendChild(script);
  });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface PaymentResult {
  success:    boolean;
  eventId?:   number;
  eventSlug?: string;
  error?:     string;
}

interface OpenPaymentArgs {
  orderData: {
    order_id:      string;
    razorpay_key:  string;
    amount_paise:  number;
    event_id:      number;
    event_name:    string;
    prefill_email?: string;
  };
  onSuccess: (result: PaymentResult) => void;
  onDismiss?: () => void;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function useRazorpay() {
  const pendingRef = useRef(false);

  const openPayment = useCallback(async ({
    orderData,
    onSuccess,
    onDismiss,
  }: OpenPaymentArgs) => {
    if (pendingRef.current) return;
    pendingRef.current = true;

    try {
      await loadScript();
    } catch {
      pendingRef.current = false;
      onSuccess({ success: false, error: "Failed to load payment gateway. Please refresh and try again." });
      return;
    }

    const options: RazorpayOptions = {
      key:      orderData.razorpay_key,
      amount:   orderData.amount_paise,
      currency: "INR",
      order_id: orderData.order_id,
      name:     "SnapFind AI",
      description: `Event: ${orderData.event_name}`,
      prefill: {
        email: orderData.prefill_email ?? "",
      },
      theme: { color: "#3B82F6" },
      method: {
        upi:        true,   // ✅ UPI / PhonePe / GPay / Paytm
        card:       true,
        netbanking: true,
        wallet:     true,
      },
      modal: {
        ondismiss: () => {
          pendingRef.current = false;
          onDismiss?.();
        },
      },
      handler: async (response: RazorpayResponse) => {
        // Verify payment on backend
        try {
          const token = localStorage.getItem("token") ?? "";
          const res = await fetch(`${API}/billing/verify-payment`, {
            method: "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              event_id:            orderData.event_id,
            }),
          });

          const data = await res.json();

          if (res.ok && data.success) {
            pendingRef.current = false;
            onSuccess({
              success:   true,
              eventId:   data.event_id,
              eventSlug: data.event_slug,
            });
          } else {
            pendingRef.current = false;
            onSuccess({
              success: false,
              error:   data.detail ?? "Payment verification failed",
            });
          }
        } catch {
          pendingRef.current = false;
          onSuccess({ success: false, error: "Network error during payment verification" });
        }
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  }, []);

  return { openPayment };
}
