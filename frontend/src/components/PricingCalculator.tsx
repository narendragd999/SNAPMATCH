"use client";
/**
 * frontend/src/components/PricingCalculator.tsx
 *
 * Reusable interactive pricing calculator with sliders.
 * Used on:
 *   /pricing          (public page, "Create Event & Pay" CTA)
 *   /events/create    (embedded in step 2 of event creation wizard)
 *
 * Props:
 *   onProceed(config)   called when user clicks CTA button
 *   ctaLabel            button label (default: "Create Event & Pay")
 *   showFreeTierNote    whether to show the "or use free event" nudge
 *   freeEventAvailable  if true, show the "Use Free Event" button
 *   onUseFreeEvent      callback for free event button
 *   initialValues       pre-fill sliders
 */

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Users,
  Calendar,
  ChevronDown,
  Zap,
  Info,
  Gift,
  ArrowRight,
} from "lucide-react";
import {
  calculatePrice,
  formatInr,
  MIN_PHOTOS,
  MAX_PHOTOS,
  MAX_GUEST,
  VALIDITY_OPTIONS,
  FREE_TIER,
  type PriceBreakdown,
} from "@/lib/pricing";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PricingConfig {
  photoQuota:   number;
  guestQuota:   number;
  validityDays: number;
  breakdown:    PriceBreakdown;
}

interface Props {
  onProceed?:           (config: PricingConfig) => void;
  ctaLabel?:            string;
  showFreeTierNote?:    boolean;
  freeEventAvailable?:  boolean;
  onUseFreeEvent?:      () => void;
  initialValues?: {
    photoQuota?:   number;
    guestQuota?:   number;
    validityDays?: number;
  };
}

// ── Slider ────────────────────────────────────────────────────────────────────

function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  color = "blue",
}: {
  value:    number;
  min:      number;
  max:      number;
  step?:    number;
  onChange: (v: number) => void;
  color?:   "blue" | "violet" | "emerald";
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const colors = {
    blue:    "accent-blue-500",
    violet:  "accent-violet-500",
    emerald: "accent-emerald-500",
  };

  return (
    <div className="relative">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`w-full h-1.5 rounded-full appearance-none cursor-pointer ${colors[color]}
          bg-zinc-700`}
        style={{
          background: `linear-gradient(to right, ${
            color === "blue" ? "#3b82f6" : color === "violet" ? "#8b5cf6" : "#10b981"
          } ${pct}%, #3f3f46 ${pct}%)`,
        }}
      />
    </div>
  );
}

// ── Preset quick-select buttons ───────────────────────────────────────────────

const PHOTO_PRESETS = [
  { label: "50",   value: 50   },
  { label: "200",  value: 200  },
  { label: "500",  value: 500  },
  { label: "1000", value: 1000 },
  { label: "2000", value: 2000 },
  { label: "5000", value: 5000 },
];

// ── Main Component ────────────────────────────────────────────────────────────

export default function PricingCalculator({
  onProceed,
  ctaLabel           = "Create Event & Pay",
  showFreeTierNote   = false,
  freeEventAvailable = false,
  onUseFreeEvent,
  initialValues,
}: Props) {
  const [photoQuota,    setPhotoQuota]    = useState(initialValues?.photoQuota   ?? 200);
  const [guestEnabled,  setGuestEnabled]  = useState((initialValues?.guestQuota ?? 0) > 0);
  const [guestQuota,    setGuestQuota]    = useState(initialValues?.guestQuota   ?? 20);
  const [validityDays,  setValidityDays]  = useState(initialValues?.validityDays ?? 30);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const effectiveGuestQuota = guestEnabled ? guestQuota : 0;

  const breakdown = useMemo(
    () => calculatePrice(photoQuota, effectiveGuestQuota, validityDays),
    [photoQuota, effectiveGuestQuota, validityDays],
  );

  const handleProceed = useCallback(() => {
    onProceed?.({
      photoQuota,
      guestQuota: effectiveGuestQuota,
      validityDays,
      breakdown,
    });
  }, [onProceed, photoQuota, effectiveGuestQuota, validityDays, breakdown]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-zinc-800 bg-gradient-to-r from-blue-600/8 to-violet-600/8">
        <h3 className="text-sm font-semibold text-zinc-100">Configure Your Event</h3>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          Adjust sliders to calculate your price in real time
        </p>
      </div>

      <div className="p-6 space-y-7">

        {/* ── Photo Quota ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Camera size={13} className="text-blue-400" />
              </div>
              <span className="text-xs font-medium text-zinc-200">Photos</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={photoQuota}
                min={MIN_PHOTOS}
                max={MAX_PHOTOS}
                onChange={(e) => {
                  const v = Math.min(MAX_PHOTOS, Math.max(MIN_PHOTOS, Number(e.target.value)));
                  setPhotoQuota(v);
                }}
                className="w-20 text-right text-xs font-mono font-semibold bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-100 focus:outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-zinc-500">photos</span>
            </div>
          </div>

          <Slider
            value={photoQuota}
            min={MIN_PHOTOS}
            max={MAX_PHOTOS}
            step={50}
            onChange={setPhotoQuota}
            color="blue"
          />

          {/* Quick presets */}
          <div className="flex gap-1.5 flex-wrap">
            {PHOTO_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPhotoQuota(p.value)}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-md border transition-colors ${
                  photoQuota === p.value
                    ? "border-blue-500/60 bg-blue-500/10 text-blue-400"
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Guest Upload ──────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Users size={13} className="text-violet-400" />
              </div>
              <span className="text-xs font-medium text-zinc-200">Guest Uploads</span>
              <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">
                optional
              </span>
            </div>
            {/* Toggle */}
            <button
              onClick={() => setGuestEnabled((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                guestEnabled ? "bg-violet-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  guestEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          <AnimatePresence>
            {guestEnabled && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2 overflow-hidden"
              >
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span>Guest upload slots</span>
                  <span className="font-mono font-semibold text-zinc-300">
                    {guestQuota} slots
                  </span>
                </div>
                <Slider
                  value={guestQuota}
                  min={5}
                  max={MAX_GUEST}
                  step={5}
                  onChange={setGuestQuota}
                  color="violet"
                />
                <p className="text-[10px] text-zinc-600">
                  Guests can upload up to {guestQuota} photos total. Owner approves each submission.
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {!guestEnabled && (
            <p className="text-[10px] text-zinc-600">
              Enable to let event guests contribute their own photos.
            </p>
          )}
        </div>

        {/* ── Validity ──────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Calendar size={13} className="text-emerald-400" />
            </div>
            <span className="text-xs font-medium text-zinc-200">Event Validity</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {VALIDITY_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setValidityDays(opt.days)}
                className={`px-3 py-2.5 rounded-xl border text-center transition-colors ${
                  validityDays === opt.days
                    ? "border-emerald-500/50 bg-emerald-500/8 text-emerald-400"
                    : "border-zinc-700 text-zinc-500 hover:border-zinc-600"
                }`}
              >
                <div className="text-xs font-semibold">{opt.label}</div>
                <div className="text-[10px] mt-0.5">
                  {opt.included
                    ? <span className="text-zinc-600">included</span>
                    : <span className="text-amber-400">+{formatInr(opt.addonPaise)}</span>
                  }
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Price Summary ─────────────────────────────────────────────────── */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Total bar */}
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <div className="text-[11px] text-zinc-500">Total price</div>
              <div className="text-xl font-bold text-zinc-100 mt-0.5">
                {formatInr(breakdown.totalPaise)}
              </div>
            </div>
            <button
              onClick={() => setShowBreakdown((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Info size={11} />
              Breakdown
              <ChevronDown
                size={11}
                className={`transition-transform ${showBreakdown ? "rotate-180" : ""}`}
              />
            </button>
          </div>

          {/* Breakdown detail */}
          <AnimatePresence>
            {showBreakdown && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-zinc-800 overflow-hidden"
              >
                <div className="px-4 py-3 space-y-1.5 text-[11px]">
                  <div className="flex justify-between text-zinc-400">
                    <span>Base event fee</span>
                    <span className="font-mono">{formatInr(breakdown.baseFeePaise)}</span>
                  </div>

                  {breakdown.photoTiers.map((t, i) => (
                    <div key={i} className="flex justify-between text-zinc-500">
                      <span>Photos {t.label} × ₹{(t.ratePaise / 100).toFixed(2)}</span>
                      <span className="font-mono">{formatInr(t.subtotal)}</span>
                    </div>
                  ))}

                  {breakdown.guestTotalPaise > 0 && breakdown.guestTiers.map((t, i) => (
                    <div key={i} className="flex justify-between text-zinc-500">
                      <span>Guest slots {t.label} × ₹{(t.ratePaise / 100).toFixed(2)}</span>
                      <span className="font-mono">{formatInr(t.subtotal)}</span>
                    </div>
                  ))}

                  {breakdown.validityAddonPaise > 0 && (
                    <div className="flex justify-between text-zinc-500">
                      <span>Validity addon ({validityDays}d)</span>
                      <span className="font-mono">{formatInr(breakdown.validityAddonPaise)}</span>
                    </div>
                  )}

                  <div className="border-t border-zinc-800 pt-1.5 flex justify-between text-zinc-200 font-semibold">
                    <span>Total</span>
                    <span className="font-mono">{formatInr(breakdown.totalPaise)}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── CTAs ──────────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <button
            onClick={handleProceed}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
          >
            <Zap size={14} />
            {ctaLabel} — {formatInr(breakdown.totalPaise)}
            <ArrowRight size={14} />
          </button>

          {showFreeTierNote && freeEventAvailable && (
            <button
              onClick={onUseFreeEvent}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-medium py-2.5 rounded-xl transition-colors"
            >
              <Gift size={13} className="text-emerald-400" />
              Or use your free event ({FREE_TIER.photoQuota} photos, {FREE_TIER.validityDays} days)
            </button>
          )}
        </div>

        {/* UPI note */}
        <p className="text-center text-[10px] text-zinc-600">
          Secure payment via Razorpay — UPI, cards, netbanking accepted
        </p>
      </div>
    </div>
  );
}
