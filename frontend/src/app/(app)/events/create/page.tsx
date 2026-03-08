"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Check, Loader2,
  Calendar, Camera, Users, Gift, Zap,
  AlertCircle,
} from "lucide-react";
import PricingCalculator, { type PricingConfig } from "@/components/PricingCalculator";
import { useRazorpay } from "@/hooks/useRazorpay";
import { FREE_TIER, formatInr } from "@/lib/pricing";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Step = 1 | 2 | 3;
interface EventDetails { name: string; description: string; }

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

// ── Inner component — uses useSearchParams, must be inside <Suspense> ──────────

function CreateEventForm() {
  const router          = useRouter();
  const params          = useSearchParams();
  const { openPayment } = useRazorpay();

  const isFreeMode = params.get("free") === "1";

  const [step,      setStep]      = useState<Step>(isFreeMode ? 2 : 1);
  const [details,   setDetails]   = useState<EventDetails>({ name: "", description: "" });
  const [config,    setConfig]    = useState<PricingConfig | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [freeAvail, setFreeAvail] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    const user = JSON.parse(localStorage.getItem("user") ?? "{}");
    setUserEmail(user?.email ?? "");
    fetch(`${API}/billing/user-status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setFreeAvail(d.free_event_available ?? false))
      .catch(() => {});
    if (!isFreeMode) {
      const saved = sessionStorage.getItem("pendingEventConfig");
      if (saved) { try { sessionStorage.removeItem("pendingEventConfig"); } catch {} }
    }
  }, [router, isFreeMode]);

  const handleDetailsNext = useCallback(() => {
    if (!details.name.trim()) { setError("Please enter an event name."); return; }
    setError(null); setStep(2);
  }, [details]);

  const handleConfigProceed = useCallback(async (cfg: PricingConfig) => {
    if (!details.name.trim()) { setStep(1); return; }
    setConfig(cfg); setError(null); setLoading(true);
    const token = localStorage.getItem("token") ?? "";
    try {
      const res = await fetch(`${API}/billing/create-event-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          event_name: details.name, description: details.description,
          photo_quota: cfg.photoQuota, guest_quota: cfg.guestQuota, validity_days: cfg.validityDays,
        }),
      });
      const orderData = await res.json();
      if (!res.ok) { setError(orderData.detail ?? "Failed to create order."); setLoading(false); return; }
      setLoading(false);
      openPayment({
        orderData: { ...orderData, prefill_email: userEmail },
        onSuccess: (result) => {
          if (result.success) router.push(`/events/${result.eventId}?created=1`);
          else setError(result.error ?? "Payment failed.");
        },
        onDismiss: () => setError("Payment was cancelled. You can complete it later."),
      });
    } catch {
      setLoading(false);
      setError("Network error. Please check your connection.");
    }
  }, [details, openPayment, router, userEmail]);

  const handleFreeEvent = useCallback(async () => {
    if (!details.name.trim()) { setError("Please enter an event name first."); setStep(1); return; }
    setLoading(true); setError(null);
    const token = localStorage.getItem("token") ?? "";
    try {
      const res = await fetch(`${API}/billing/create-free-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ event_name: details.name, description: details.description }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail ?? "Failed to create free event."); return; }
      router.push(`/events/${data.event_id}?created=1`);
    } catch {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [details, router]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="border-b border-zinc-800/60 px-6 py-4 flex items-center justify-between">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors group">
          <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
          Back
        </button>
        <div className="flex items-center gap-6">
          {[
            { n: 1, label: "Event Details" },
            { n: 2, label: "Configure"     },
            { n: 3, label: "Payment"       },
          ].map(s => (
            <StepBadge key={s.n} n={s.n} label={s.label}
              active={step === s.n} done={step > s.n} />
          ))}
        </div>
        <div className="w-16" />
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">

          {/* Step 1 — Event Details */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }} className="space-y-6">
              <div>
                <h1 className="text-xl font-bold text-zinc-50">Create an Event</h1>
                <p className="text-sm text-zinc-500 mt-1">Give your event a name and description</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-2">Event Name *</label>
                  <input value={details.name} onChange={e => setDetails(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Sarah & John's Wedding" maxLength={100}
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-sm text-zinc-200 placeholder:text-zinc-600 transition-colors" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-2">Description <span className="text-zinc-600">(optional)</span></label>
                  <textarea value={details.description} onChange={e => setDetails(p => ({ ...p, description: e.target.value }))}
                    placeholder="Add a short description…" rows={3} maxLength={500}
                    className="w-full px-3 py-2.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-blue-500/60 focus:outline-none text-sm text-zinc-200 placeholder:text-zinc-600 transition-colors resize-none" />
                </div>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle size={12} /> {error}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={handleDetailsNext}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
                  Continue <ArrowRight size={14} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2 — Configure */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }} className="space-y-6">
              <div>
                <h1 className="text-xl font-bold text-zinc-50">Configure Your Event</h1>
                <p className="text-sm text-zinc-500 mt-1">Set photo quota, guest slots, and validity period</p>
              </div>
              <PricingCalculator
                onProceed={handleConfigProceed}
                ctaLabel="Continue to Payment"
                showFreeTierNote={freeAvail}
                freeEventAvailable={freeAvail && isFreeMode}
                onUseFreeEvent={handleFreeEvent}
              />
              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
                  <AlertCircle size={12} /> {error}
                </div>
              )}
              <div className="flex justify-between">
                <button onClick={() => setStep(1)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                  <ArrowLeft size={12} /> Back
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3 — Payment processing */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-6 py-16 text-center">
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

// ── Default export wraps inner form in Suspense ────────────────────────────────

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