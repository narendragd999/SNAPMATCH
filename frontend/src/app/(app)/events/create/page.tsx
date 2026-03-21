"use client";
/**
 * frontend/src/app/(app)/events/create/page.tsx
 *
 * 3-step event creation wizard:
 *   Step 1: Event details (name, description)
 *   Step 2: Quota configuration (PricingCalculator)
 *   Step 3: Payment (Razorpay) — or instant for free tier
 *
 * URL params:
 *   ?free=1   → skip to free event creation
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Check, Loader2,
  Calendar, Camera, Users, Gift, Zap,
  AlertCircle,
} from "lucide-react";
import PricingCalculator, { type PricingConfig } from "@/components/PricingCalculator";
import { useRazorpay } from "@/hooks/useRazorpay";
import { getPricingConfig, getFreeTier, formatInr } from "@/lib/pricing";

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

interface EventDetails {
  name:        string;
  description: string;
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepBadge({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${active ? "opacity-100" : done ? "opacity-60" : "opacity-30"}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
        done   ? "bg-emerald-500 text-white" :
        active ? "bg-blue-500 text-white"    :
                 "bg-zinc-700 text-zinc-400"
      }`}>
        {done ? <Check size={11} /> : n}
      </div>
      <span className={`text-xs hidden sm:block ${active ? "text-zinc-200 font-medium" : "text-zinc-500"}`}>
        {label}
      </span>
    </div>
  );
}

// ── Inner form (uses useSearchParams — must be inside Suspense) ───────────────

function CreateEventForm() {
  const router          = useRouter();
  const params          = useSearchParams();
  const { openPayment } = useRazorpay();

  const isFreeMode = params.get("free") === "1";

  const [step,      setStep]      = useState<Step>(isFreeMode ? 2 : 1);
  const [details,   setDetails]   = useState<EventDetails>({ name: "", description: "" });
  const [config,    setConfig]    = useState<PricingCalculatorConfig | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [freeAvail, setFreeAvail] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [freeTier,  setFreeTier]  = useState({ photoQuota: 50, guestQuota: 10, validityDays: 7 });

  // Load user status on mount
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }

    const user = JSON.parse(localStorage.getItem("user") ?? "{}");
    setUserEmail(user?.email ?? "");

    // Check free event availability
    fetch(`${API}/billing/user-status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setFreeAvail(d.free_event_available ?? false))
      .catch(() => {});

    // Load live free tier quotas from pricing config
    getPricingConfig()
      .then((cfg) => setFreeTier(getFreeTier(cfg)))
      .catch(() => {});

    // Restore pre-filled config from pricing page
    if (!isFreeMode) {
      const saved = sessionStorage.getItem("pendingEventConfig");
      if (saved) {
        try {
          sessionStorage.removeItem("pendingEventConfig");
        } catch {}
      }
    }
  }, [router, isFreeMode]);

  // ── Step 1 → Step 2 ──────────────────────────────────────────────────────

  const handleDetailsNext = useCallback(() => {
    if (!details.name.trim()) {
      setError("Please enter an event name.");
      return;
    }
    setError(null);
    setStep(2);
  }, [details]);

  // ── Step 2 → Step 3 (paid) ────────────────────────────────────────────────

  const handleConfigProceed = useCallback(async (cfg: PricingConfig) => {
    if (!details.name.trim()) {
      setStep(1);
      return;
    }
    setConfig(cfg);
    setError(null);
    setLoading(true);

    const token = localStorage.getItem("token") ?? "";

    try {
      const res = await fetch(`${API}/billing/create-event-order`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          event_name:    details.name,
          description:   details.description,
          photo_quota:   cfg.photoQuota,
          guest_quota:   cfg.guestQuota,
          validity_days: cfg.validityDays,
        }),
      });

      const orderData = await res.json();

      if (!res.ok) {
        setError(orderData.detail ?? "Failed to create order. Please try again.");
        setLoading(false);
        return;
      }

      setLoading(false);

      // Open Razorpay
      openPayment({
        orderData: {
          ...orderData,
          prefill_email: userEmail,
        },
        onSuccess: (result) => {
          if (result.success) {
            router.push(`/events/${result.eventId}?created=1`);
          } else {
            setError(result.error ?? "Payment failed. Please try again.");
          }
        },
        onDismiss: () => {
          setError("Payment was cancelled. Your event is saved — you can complete payment later.");
        },
      });
    } catch {
      setLoading(false);
      setError("Network error. Please check your connection.");
    }
  }, [details, openPayment, router, userEmail]);

  // ── Free event creation ───────────────────────────────────────────────────

  const handleFreeEvent = useCallback(async () => {
    if (!details.name.trim()) {
      setError("Please enter an event name first.");
      setStep(1);
      return;
    }
    setError(null);
    setLoading(true);

    const token = localStorage.getItem("token") ?? "";

    try {
      const res = await fetch(`${API}/billing/create-free-event`, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          event_name:  details.name,
          description: details.description,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoading(false);
        setError(data.detail ?? "Failed to create free event.");
        return;
      }

      router.push(`/events/${data.event_id}?created=1&free=1`);
    } catch {
      setLoading(false);
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [details, router]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="border-b border-zinc-800/60 px-5 py-3 flex items-center gap-4">
        <button
          onClick={() => step > 1 ? setStep((s) => (s - 1) as Step) : router.back()}
          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-semibold text-zinc-200">Create New Event</h1>

        {/* Step indicators */}
        <div className="ml-auto flex items-center gap-4">
          <StepBadge n={1} label="Details"  active={step === 1} done={step > 1} />
          <div className="w-6 h-px bg-zinc-700 hidden sm:block" />
          <StepBadge n={2} label="Quota"    active={step === 2} done={step > 2} />
          <div className="w-6 h-px bg-zinc-700 hidden sm:block" />
          <StepBadge n={3} label="Payment"  active={step === 3} done={false}    />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* Error banner */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2.5 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3 mb-6"
          >
            <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{error}</p>
          </motion.div>
        )}

        <AnimatePresence mode="wait">

          {/* ── Step 1: Event Details ──────────────────────────────────────── */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5"
            >
              <div>
                <h2 className="text-lg font-bold text-zinc-100">Event details</h2>
                <p className="text-xs text-zinc-500 mt-1">Give your event a name and optional description.</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Event name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul & Priya Wedding 2025"
                    value={details.name}
                    onChange={(e) => setDetails((d) => ({ ...d, name: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
                    maxLength={100}
                    onKeyDown={(e) => e.key === "Enter" && handleDetailsNext()}
                  />
                  <div className="text-right text-[10px] text-zinc-600 mt-1">
                    {details.name.length}/100
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Description <span className="text-zinc-600">(optional)</span>
                  </label>
                  <textarea
                    placeholder="A short note about this event..."
                    value={details.description}
                    onChange={(e) => setDetails((d) => ({ ...d, description: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                    rows={3}
                    maxLength={500}
                  />
                </div>
              </div>

              {/* Free event banner */}
              {freeAvail && (
                <div className="flex items-center justify-between bg-emerald-500/6 border border-emerald-500/20 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Gift size={14} className="text-emerald-400" />
                    <div>
                      <p className="text-xs font-medium text-emerald-300">You have a free event available!</p>
                      <p className="text-[10px] text-zinc-500">
                        {freeTier.photoQuota} photos · {freeTier.guestQuota} guest slots · {freeTier.validityDays} days
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!details.name.trim()) { setError("Enter event name first."); return; }
                      handleFreeEvent();
                    }}
                    disabled={loading}
                    className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    Use Free →
                  </button>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleDetailsNext}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  Continue <ArrowRight size={14} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Configure ─────────────────────────────────────────── */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-5"
            >
              <div>
                <h2 className="text-lg font-bold text-zinc-100">Configure your event</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Set photo quota, guest slots, and validity period for{" "}
                  <span className="text-zinc-300">"{details.name}"</span>.
                </p>
              </div>

              <PricingCalculator
                onProceed={handleConfigProceed}
                ctaLabel="Continue to Payment"
                showFreeTierNote={freeAvail}
                freeEventAvailable={freeAvail && isFreeMode}
                onUseFreeEvent={handleFreeEvent}
              />
            </motion.div>
          )}

          {/* ── Step 3: Payment processing ────────────────────────────────── */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-6 py-16 text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Loader2 size={22} className="text-blue-400 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-200">Processing Payment</p>
                <p className="text-xs text-zinc-500 mt-1">Please complete the payment in the Razorpay window</p>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* Global loading overlay */}
        {loading && step !== 3 && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-blue-400" />
              <p className="text-sm text-zinc-300">Creating your event…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Default export — wraps with Suspense (useSearchParams requirement) ─────────

export default function CreateEventPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 size={22} className="text-zinc-600 animate-spin" />
      </div>
    }>
      <CreateEventForm />
    </Suspense>
  );
}