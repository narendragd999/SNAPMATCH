"use client";
/**
 * frontend/src/app/(public)/pricing/page.tsx   OR
 * frontend/src/app/pricing/page.tsx
 *
 * Public pricing page — no auth required.
 * Features:
 *   - Interactive slider calculator
 *   - Free tier card
 *   - Feature comparison
 *   - FAQ
 */

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Scan, Check, Zap, Shield, Camera, Users, Calendar,
  HelpCircle, ChevronDown, ArrowRight, Gift, Star,
} from "lucide-react";
import PricingCalculator, { type PricingConfig } from "@/components/PricingCalculator";
import { getPricingConfig, getFreeTier, formatInr } from "@/lib/pricing";

// ── FAQ data ──────────────────────────────────────────────────────────────────

const FAQ = [
  {
    q: "What counts as a 'photo' for billing?",
    a: "Each unique image uploaded by the event owner counts as one photo. Guest-uploaded photos are tracked separately via the guest quota — they don't consume your owner photo quota.",
  },
  {
    q: "Does image file size affect the price?",
    a: "No. All uploaded photos are automatically compressed by our system. Pricing is based on the number of photos (processing units), not file size.",
  },
  {
    q: "What happens when my guest quota is full?",
    a: "When the guest quota is exhausted, the contribute link will show a 'quota full' message and no new guest submissions will be accepted. You can disable guest uploads from the event settings at any time.",
  },
  {
    q: "What is the free event?",
    a: `Every new account gets one free event: owner photos, guest slots, and validity are configurable — check the free tier card below for current limits. No credit card needed.`,
  },
  {
    q: "What payment methods are accepted?",
    a: "We accept UPI (PhonePe, Google Pay, Paytm, BHIM), debit/credit cards (Visa, Mastercard, RuPay), and all major netbanking. Payments are processed securely by Razorpay.",
  },
  {
    q: "Can I extend an event's validity?",
    a: "Validity is chosen at the time of purchase. Currently you cannot extend validity after payment — simply create a new event if you need more time.",
  },
  {
    q: "What happens to photos after an event expires?",
    a: "Expired events become read-only for the owner but the public link stops working. Photos are not deleted immediately — you can still access them from your dashboard.",
  },
];

// ── Features list ──────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: <Camera size={14} />, text: "AI face recognition & clustering" },
  { icon: <Scan   size={14} />, text: "Guest selfie search (find yourself)" },
  { icon: <Users  size={14} />, text: "Guest photo upload with approval workflow" },
  { icon: <Shield size={14} />, text: "Private event with public QR link" },
  { icon: <Zap    size={14} />, text: "Fast GPU-powered photo processing" },
  { icon: <Star   size={14} />, text: "Scene & object detection (AI)" },
];

// ── FAQ Accordion ─────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-800 last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-sm font-medium text-zinc-200">{q}</span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <p className="pb-4 text-[13px] text-zinc-500 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const router  = useRouter();
  const [calcConfig, setCalcConfig] = useState<PricingConfig | null>(null);
  const [freeTier, setFreeTier] = useState({ photoQuota: 50, guestQuota: 10, validityDays: 7 });

  useEffect(() => {
    getPricingConfig()
      .then((cfg) => setFreeTier(getFreeTier(cfg)))
      .catch(() => {});
  }, []);

  // Check auth & free event status (client side)
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const isLoggedIn = Boolean(token);

  const handleProceed = useCallback((config: PricingConfig) => {
    if (!isLoggedIn) {
      router.push(`/login?redirect=/events/create`);
      return;
    }
    // Pass config to create page via sessionStorage
    if (typeof window !== "undefined") {
      sessionStorage.setItem("pendingEventConfig", JSON.stringify({
        photoQuota:   config.photoQuota,
        guestQuota:   config.guestQuota,
        validityDays: config.validityDays,
      }));
    }
    router.push("/events/create");
  }, [isLoggedIn, router]);

  const handleFreeEvent = useCallback(() => {
    if (!isLoggedIn) {
      router.push("/login?redirect=/events/create?free=1");
      return;
    }
    router.push("/events/create?free=1");
  }, [isLoggedIn, router]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">

      {/* Nav */}
      <nav className="border-b border-zinc-800/60 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
            <Scan size={13} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-zinc-100">SnapFind AI</span>
        </Link>
        <div className="flex items-center gap-3">
          {isLoggedIn ? (
            <Link href="/dashboard" className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
                Sign in
              </Link>
              <Link href="/login" className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 mb-6">
            <Zap size={10} /> Pay only for what you need
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-zinc-50 tracking-tight">
            Simple, transparent pricing
          </h1>
          <p className="text-base text-zinc-500 mt-4 max-w-xl mx-auto leading-relaxed">
            One event, one payment. No subscriptions, no monthly fees.
            Configure exactly the photo quota you need and pay once.
          </p>
        </motion.div>
      </div>

      {/* Main content: calculator + free tier */}
      <div className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid lg:grid-cols-5 gap-6 items-start">

          {/* Calculator (wider) */}
          <div className="lg:col-span-3">
            <PricingCalculator
              onProceed={handleProceed}
              ctaLabel={isLoggedIn ? "Create Event & Pay" : "Sign up & Create Event"}
              showFreeTierNote={true}
              freeEventAvailable={true}
              onUseFreeEvent={handleFreeEvent}
            />
          </div>

          {/* Right column: free tier + features */}
          <div className="lg:col-span-2 space-y-5">

            {/* Free tier card */}
            <div className="bg-gradient-to-br from-emerald-600/10 to-teal-600/10 border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Gift size={16} className="text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300">Free Event</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  One per account
                </span>
              </div>
              <ul className="space-y-2 mb-5">
                {[
                  `${freeTier.photoQuota} owner photos`,
                  `${freeTier.guestQuota} guest upload slots`,
                  `${freeTier.validityDays}-day validity`,
                  "AI face search enabled",
                  "No credit card required",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-xs text-zinc-300">
                    <Check size={11} className="text-emerald-400 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <button
                onClick={handleFreeEvent}
                className="w-full text-xs font-semibold py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 transition-colors flex items-center justify-center gap-1.5"
              >
                <Gift size={12} />
                Start with free event
              </button>
            </div>

            {/* Features */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <h3 className="text-xs font-semibold text-zinc-300 mb-4">
                All events include
              </h3>
              <ul className="space-y-2.5">
                {FEATURES.map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-xs text-zinc-400">
                    <span className="text-blue-400">{f.icon}</span>
                    {f.text}
                  </li>
                ))}
              </ul>
            </div>

            {/* Payment methods */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <p className="text-[11px] text-zinc-600 text-center">
                Secure payments via Razorpay
              </p>
              <div className="flex items-center justify-center gap-3 mt-2.5 flex-wrap">
                {["UPI", "PhonePe", "GPay", "Cards", "Netbanking"].map((m) => (
                  <span
                    key={m}
                    className="text-[10px] font-medium px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* How pricing works (tier table) */}
        <div className="mt-16">
          <h2 className="text-xl font-bold text-center text-zinc-100 mb-8">
            How pricing works
          </h2>
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[
              { label: "Base fee",        detail: "Every event",              price: "₹49" },
              { label: "1–200 photos",    detail: "₹0.50 per photo",          price: "up to ₹100" },
              { label: "201–500 photos",  detail: "₹0.40 per photo",          price: "up to ₹120" },
              { label: "501–1000 photos", detail: "₹0.30 per photo",          price: "up to ₹150" },
              { label: "1001–2000",       detail: "₹0.25 per photo",          price: "up to ₹250" },
              { label: "2000+ photos",    detail: "₹0.15–0.20 per photo",     price: "bulk savings" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                <div>
                  <div className="text-xs font-medium text-zinc-200">{row.label}</div>
                  <div className="text-[11px] text-zinc-500">{row.detail}</div>
                </div>
                <div className="text-xs font-mono text-blue-400">{row.price}</div>
              </div>
            ))}
          </div>
          <p className="text-center text-[11px] text-zinc-600 mt-4">
            Guest upload slots add ₹0.04–₹0.10 each. Validity add-ons: 90 days (+₹99), 1 year (+₹299).
          </p>
        </div>

        {/* FAQ */}
        <div className="mt-16 max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-center text-zinc-100 mb-8">
            Frequently asked questions
          </h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-6 divide-y divide-zinc-800">
            {FAQ.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center">
          <h2 className="text-2xl font-bold text-zinc-100 mb-3">
            Ready to create your event?
          </h2>
          <p className="text-sm text-zinc-500 mb-6">
            Use the calculator above or start with your free event.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleFreeEvent}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-medium transition-colors"
            >
              <Gift size={14} className="text-emerald-400" />
              Try free event
            </button>
            <button
              onClick={() => document.querySelector(".pricing-calculator")?.scrollIntoView({ behavior: "smooth" })}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
            >
              <Zap size={14} />
              Create paid event
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}