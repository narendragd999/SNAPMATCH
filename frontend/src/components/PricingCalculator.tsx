"use client";
/**
 * frontend/src/components/PricingCalculator.tsx
 *
 * Single component, three surfaces:
 *   mode="owner"  — event create page (default)
 *   mode="public" — public event page, no sliders
 *   mode="admin"  — admin panel with full cost breakdown
 *
 * Usage:
 *   <PricingCalculator onProceed={handleConfigProceed}
 *     ctaLabel="Continue to Payment" showFreeTierNote={freeAvail}
 *     freeEventAvailable={freeAvail && isFreeMode}
 *     onUseFreeEvent={handleFreeEvent} />
 *
 *   <PricingCalculator mode="public"
 *     staticConfig={{ photoQuota: event.photo_quota,
 *       validityDays: event.validity_days, guestQuota: event.guest_quota }} />
 *
 *   <PricingCalculator mode="admin"
 *     staticConfig={{ photoQuota: event.photo_quota,
 *       validityDays: event.validity_days, guestQuota: event.guest_quota }} />
 */

import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera, Users, Calendar, ChevronDown, Zap, Info, Gift, ArrowRight,
  Clock, Search, HardDrive, Cpu, Server, CreditCard, TrendingUp,
  Lock, Sparkles, Shield,
} from "lucide-react";
import {
  calculatePrice,
  formatInr,
  MIN_PHOTOS,
  MAX_PHOTOS,
  VALIDITY_OPTIONS,
  FREE_TIER,
  type PriceBreakdown,
} from "@/lib/pricing";

// ── Infra cost constants (admin breakdown only) ───────────────────────────────
// YOUR costs — never shown to photographers.
// 1.5 MB/photo verified from pipeline (1200px JPEG Q85).

const INFRA = {
  R2_STORAGE_PER_GB_MONTH_USD: 0.015,
  R2_CLASS_A_PER_MILLION_USD:  4.50,
  R2_CLASS_B_PER_MILLION_USD:  0.36,
  RUNPOD_PER_HR_USD:           1.04,
  RUNPOD_SECS_PER_PHOTO:       0.5,
  RUNPOD_COLD_START_SECS:      5,
  RAZORPAY_RATE:               0.0236,
  VPS_MONTHLY_INR:             2499,
  VPS_EVENTS_PER_MONTH:        30,
  PHOTO_MB:                    1.5,
  USD_TO_INR:                  84,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PricingConfig {
  photoQuota:   number;
  guestQuota:   number;
  validityDays: number;
  breakdown:    PriceBreakdown;
}

export interface StaticConfig {
  photoQuota:   number;
  validityDays: number;
  guestQuota:   number;
}

interface Props {
  mode?:               "owner" | "public" | "admin";
  staticConfig?:       StaticConfig;
  onProceed?:          (config: PricingConfig) => void;
  ctaLabel?:           string;
  showFreeTierNote?:   boolean;
  freeEventAvailable?: boolean;
  onUseFreeEvent?:     () => void;
  initialValues?: {
    photoQuota?:   number;
    guestQuota?:   number;
    validityDays?: number;
  };
}

interface InfraCost {
  storageCostINR: number;
  opsCostINR:     number;
  gpuCostINR:     number;
  vpsCostINR:     number;
  infraCostINR:   number;
  razorpayFeeINR: number;
  profitINR:      number;
  netMarginPct:   number;
  perPhotoINR:    number;
}

// ── Infra cost engine (admin only) ────────────────────────────────────────────

function calcInfraCost(
  photoQuota: number,
  guestQuota: number,
  validityDays: number,
  ownerRevenue: number,
): InfraCost {
  const fx = INFRA.USD_TO_INR;

  const totalGB        = (photoQuota * INFRA.PHOTO_MB + guestQuota * (INFRA.PHOTO_MB / 2)) / 1024;
  const storageCostINR = totalGB * INFRA.R2_STORAGE_PER_GB_MONTH_USD * (validityDays / 30) * fx;

  const uploads    = (photoQuota + guestQuota) / 1_000_000;
  const searches   = Math.max(50, photoQuota / 2);
  const reads      = (searches * 10) / 1_000_000;
  const opsCostINR = (
    uploads * INFRA.R2_CLASS_A_PER_MILLION_USD +
    reads   * INFRA.R2_CLASS_B_PER_MILLION_USD
  ) * fx;

  const gpuSecs    = photoQuota * INFRA.RUNPOD_SECS_PER_PHOTO + INFRA.RUNPOD_COLD_START_SECS;
  const gpuCostINR = (gpuSecs / 3600) * INFRA.RUNPOD_PER_HR_USD * fx;

  const vpsCostINR     = INFRA.VPS_MONTHLY_INR / INFRA.VPS_EVENTS_PER_MONTH;
  const infraCostINR   = storageCostINR + opsCostINR + gpuCostINR + vpsCostINR;
  const razorpayFeeINR = ownerRevenue * INFRA.RAZORPAY_RATE;
  const profitINR      = ownerRevenue - infraCostINR - razorpayFeeINR;
  const netMarginPct   = ownerRevenue > 0 ? (profitINR / ownerRevenue) * 100 : 0;
  const perPhotoINR    = photoQuota > 0 ? infraCostINR / photoQuota : 0;

  return {
    storageCostINR, opsCostINR, gpuCostINR, vpsCostINR,
    infraCostINR, razorpayFeeINR, profitINR, netMarginPct, perPhotoINR,
  };
}

// ── Slider ────────────────────────────────────────────────────────────────────

function Slider({
  value, min, max, step = 1, onChange, color = "blue",
}: {
  value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void;
  color?: "blue" | "violet" | "emerald";
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const hex  = { blue: "#3b82f6", violet: "#8b5cf6", emerald: "#10b981" }[color];
  return (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
      style={{ background: `linear-gradient(to right, ${hex} ${pct}%, #3f3f46 ${pct}%)` }}
    />
  );
}

// ── Photo presets ─────────────────────────────────────────────────────────────

const PHOTO_PRESETS = [
  { label: "50",  value: 50   },
  { label: "200", value: 200  },
  { label: "500", value: 500  },
  { label: "1K",  value: 1000 },
  { label: "2K",  value: 2000 },
  { label: "5K",  value: 5000 },
];

// ── Feature pills (public mode) ───────────────────────────────────────────────

function FeaturePills({
  photoQuota, guestQuota, validityDays,
}: { photoQuota: number; guestQuota: number; validityDays: number }) {
  const pills = [
    { icon: Camera, label: `${photoQuota.toLocaleString()} photos`,  cls: "text-blue-400    bg-blue-500/10    border-blue-500/20"   },
    { icon: Clock,  label: `${validityDays} days`,                   cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { icon: Search, label: "AI face search",                         cls: "text-violet-400  bg-violet-500/10  border-violet-500/20"  },
    ...(guestQuota > 0 ? [{ icon: Users, label: `${guestQuota} guest slots`,
      cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {pills.map((p) => (
        <span key={p.label} className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full border ${p.cls}`}>
          <p.icon size={10} />
          {p.label}
        </span>
      ))}
    </div>
  );
}

// ── Public mode card ──────────────────────────────────────────────────────────
// Shows event features only — no price, no sliders.

function PublicEventCard({ cfg }: { cfg: StaticConfig }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-zinc-800 bg-gradient-to-r from-violet-600/6 to-blue-600/6 flex items-center gap-2">
        <Sparkles size={12} className="text-violet-400" />
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Event plan</span>
      </div>
      <div className="p-5 space-y-4">
        <FeaturePills
          photoQuota={cfg.photoQuota}
          guestQuota={cfg.guestQuota}
          validityDays={cfg.validityDays}
        />
        <p className="text-[10px] text-zinc-600 pt-2 border-t border-zinc-800/60">
          Includes AI photo processing and secure cloud storage
        </p>
      </div>
    </div>
  );
}

// ── Admin breakdown panel ─────────────────────────────────────────────────────
// YOUR real infra costs, margins and monthly projections.
// Only visible in mode="admin".

const MONTHLY_EVENT_COUNTS = [5, 10, 20, 30] as const;

function AdminBreakdown({
  photoQuota, guestQuota, validityDays, ownerRevenue,
}: { photoQuota: number; guestQuota: number; validityDays: number; ownerRevenue: number }) {
  const [showCostBars, setShowCostBars] = useState(false);

  const c = useMemo(
    () => calcInfraCost(photoQuota, guestQuota, validityDays, ownerRevenue),
    [photoQuota, guestQuota, validityDays, ownerRevenue],
  );

  const totalCostBasis = c.infraCostINR + c.razorpayFeeINR;
  const costItems = [
    { label: "R2 Storage", value: c.storageCostINR, Icon: HardDrive, color: "#3b82f6" },
    { label: "R2 Ops",     value: c.opsCostINR,     Icon: Server,    color: "#8b5cf6" },
    { label: "RunPod GPU", value: c.gpuCostINR,     Icon: Cpu,       color: "#f59e0b" },
    { label: "VPS Share",  value: c.vpsCostINR,     Icon: Server,    color: "#10b981" },
    { label: "Razorpay",   value: c.razorpayFeeINR, Icon: CreditCard,color: "#ef4444" },
  ];

  return (
    <div className="bg-zinc-900 border border-red-500/25 rounded-2xl overflow-hidden">

      <div className="px-5 py-3 border-b border-red-500/15 bg-red-500/5 flex items-center gap-2">
        <Lock size={11} className="text-red-400" />
        <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Admin Only · Your costs</span>
      </div>

      <div className="p-5 space-y-5">

        {/* Summary grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {([
            { label: "Infra Cost",   value: `₹${c.infraCostINR.toFixed(2)}`,   sub: "excl. Razorpay",  cls: "text-orange-400" },
            { label: "Razorpay Fee", value: `₹${c.razorpayFeeINR.toFixed(2)}`, sub: "2.36% effective", cls: "text-red-400"    },
            { label: "Net Profit",   value: `₹${c.profitINR.toFixed(2)}`,      sub: "per event",       cls: "text-emerald-400"},
            { label: "Net Margin",   value: `${c.netMarginPct.toFixed(1)}%`,   sub: "of owner fee",    cls: "text-violet-400" },
          ] as const).map((item) => (
            <div key={item.label} className="bg-zinc-950 rounded-xl border border-zinc-800 px-3 py-2.5">
              <motion.div
                key={item.value}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={`text-base font-bold font-mono ${item.cls}`}
              >
                {item.value}
              </motion.div>
              <div className="text-[10px] text-zinc-500 mt-0.5">{item.label}</div>
              <div className="text-[9px] text-zinc-700">{item.sub}</div>
            </div>
          ))}
        </div>

        {/* Revenue + per-photo cost */}
        <div className="flex items-center justify-between bg-zinc-950 rounded-xl border border-zinc-800 px-4 py-3">
          <div>
            <div className="text-[10px] text-zinc-500">Owner fee (your revenue)</div>
            <div className="text-xl font-bold text-zinc-100">₹{ownerRevenue.toLocaleString()}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-zinc-500">Per-photo infra cost</div>
            <div className="text-sm font-mono font-bold text-amber-400">₹{c.perPhotoINR.toFixed(4)}</div>
          </div>
        </div>

        {/* Collapsible cost bars */}
        <div className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
          <button
            onClick={() => setShowCostBars((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <span className="font-medium">Cost breakdown</span>
            <ChevronDown size={12} className={`transition-transform ${showCostBars ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showCostBars && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-zinc-800"
              >
                <div className="px-4 py-3 space-y-3">
                  {costItems.map((item) => {
                    const pct = totalCostBasis > 0 ? (item.value / totalCostBasis) * 100 : 0;
                    return (
                      <div key={item.label} className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <div className="flex items-center gap-1.5 text-zinc-400">
                            <item.Icon size={10} />
                            {item.label}
                          </div>
                          <div className="flex items-center gap-2.5 font-mono text-zinc-500">
                            <span>{pct.toFixed(1)}%</span>
                            <span>₹{item.value.toFixed(2)}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <motion.div
                            key={`${item.label}-${pct}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[9px] text-zinc-700 pt-2 border-t border-zinc-800 leading-relaxed">
                    R2 $0.015/GB/mo × {validityDays}d · RunPod RTX 4090 $1.04/hr, 0.5s/photo + 5s cold ·
                    Razorpay 2% + 18% GST = 2.36% · VPS ₹{INFRA.VPS_MONTHLY_INR}/mo ÷ {INFRA.VPS_EVENTS_PER_MONTH} events ·
                    1.5 MB/photo · USD/INR = {INFRA.USD_TO_INR}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Monthly projection */}
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            <TrendingUp size={10} />
            Monthly projection
          </div>
          <div className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left  px-3 py-2 text-zinc-600 font-medium">Events/mo</th>
                  <th className="text-right px-3 py-2 text-zinc-600 font-medium">Revenue</th>
                  <th className="text-right px-3 py-2 text-zinc-600 font-medium">Cost</th>
                  <th className="text-right px-3 py-2 text-zinc-600 font-medium">Profit</th>
                </tr>
              </thead>
              <tbody>
                {MONTHLY_EVENT_COUNTS.map((n, i) => {
                  const revenue = ownerRevenue * n;
                  const cost    = (c.infraCostINR + c.razorpayFeeINR) * n;
                  const profit  = revenue - cost;
                  return (
                    <tr key={n} className={i < MONTHLY_EVENT_COUNTS.length - 1 ? "border-b border-zinc-800/50" : ""}>
                      <td className="px-3 py-2 font-mono text-zinc-400">{n}×</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-300">₹{revenue.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-400">₹{Math.round(cost).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-400">₹{Math.round(profit).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-zinc-700 mt-1.5">
            Assumes identical photo/guest config across all events.
          </p>
        </div>

      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PricingCalculator({
  mode               = "owner",
  staticConfig,
  onProceed,
  ctaLabel           = "Continue to Payment",
  showFreeTierNote   = false,
  freeEventAvailable = false,
  onUseFreeEvent,
  initialValues,
}: Props) {
  const [photoQuota,    setPhotoQuota]    = useState(
    initialValues?.photoQuota   ?? staticConfig?.photoQuota   ?? 200,
  );
  const [guestEnabled,  setGuestEnabled]  = useState(
    (initialValues?.guestQuota ?? staticConfig?.guestQuota ?? 0) > 0,
  );
  const [guestQuota,    setGuestQuota]    = useState(
    initialValues?.guestQuota   ?? staticConfig?.guestQuota   ?? 20,
  );
  const [validityDays,  setValidityDays]  = useState(
    initialValues?.validityDays ?? staticConfig?.validityDays ?? 30,
  );
  const [showBreakdown, setShowBreakdown] = useState(false);

  const effectiveGuest = guestEnabled ? guestQuota : 0;

  const breakdown = useMemo(
    () => calculatePrice(photoQuota, effectiveGuest, validityDays),
    [photoQuota, effectiveGuest, validityDays],
  );

  const handleProceed = useCallback(() => {
    onProceed?.({ photoQuota, guestQuota: effectiveGuest, validityDays, breakdown });
  }, [onProceed, photoQuota, effectiveGuest, validityDays, breakdown]);

  // ── PUBLIC MODE ───────────────────────────────────────────────────────────────

  if (mode === "public") {
    return (
      <PublicEventCard cfg={staticConfig ?? { photoQuota: 200, validityDays: 30, guestQuota: 0 }} />
    );
  }

  // ── OWNER / ADMIN SHARED CALCULATOR ──────────────────────────────────────────

  const isAdmin = mode === "admin";

  return (
    <div className="space-y-4">

      {/* ── Calculator card ──────────────────────────────────────────────────── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

        <div className={`px-6 py-5 border-b border-zinc-800 bg-gradient-to-r ${
          isAdmin ? "from-red-600/6 to-orange-600/6" : "from-blue-600/8 to-violet-600/8"
        }`}>
          <h3 className="text-sm font-semibold text-zinc-100">Configure Your Event</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Adjust sliders to calculate your price in real time
          </p>
        </div>

        <div className="p-6 space-y-7">

          {/* ── Photo quota ──────────────────────────────────────────────────── */}
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
                    const v = Number(e.target.value);
                    if (!isNaN(v)) setPhotoQuota(Math.min(MAX_PHOTOS, Math.max(MIN_PHOTOS, v)));
                  }}
                  className="w-20 text-right text-xs font-mono font-semibold bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-zinc-100 focus:outline-none focus:border-blue-500 transition-colors"
                />
                <span className="text-[11px] text-zinc-500">photos</span>
              </div>
            </div>

            <Slider value={photoQuota} min={MIN_PHOTOS} max={MAX_PHOTOS} step={50} onChange={setPhotoQuota} color="blue" />

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

          {/* ── Guest uploads ─────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
                  <Users size={13} className="text-violet-400" />
                </div>
                <span className="text-xs font-medium text-zinc-200">Guest Uploads</span>
                <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">optional</span>
              </div>
              <button
                onClick={() => setGuestEnabled((v) => !v)}
                aria-label={guestEnabled ? "Disable guest uploads" : "Enable guest uploads"}
                className={`relative w-9 h-5 rounded-full transition-colors ${guestEnabled ? "bg-violet-500" : "bg-zinc-700"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${guestEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
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
                    <span className="font-mono font-semibold text-zinc-300">{guestQuota} slots</span>
                  </div>
                  <Slider value={guestQuota} min={5} max={500} step={5} onChange={setGuestQuota} color="violet" />
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

          {/* ── Validity ─────────────────────────────────────────────────────── */}
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

          {/* ── Price summary ─────────────────────────────────────────────────── */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5">
              <div>
                <div className="text-[11px] text-zinc-500">
                  {isAdmin ? "Owner fee (platform revenue)" : "Total price"}
                </div>
                <motion.div
                  key={breakdown.totalPaise}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xl font-bold text-zinc-100 mt-0.5"
                >
                  {formatInr(breakdown.totalPaise)}
                </motion.div>
              </div>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Info size={11} />
                Breakdown
                <ChevronDown size={11} className={`transition-transform ${showBreakdown ? "rotate-180" : ""}`} />
              </button>
            </div>

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
                    <div className="flex justify-between text-zinc-500">
                      <span>{photoQuota.toLocaleString()} photos</span>
                      <span className="font-mono">{formatInr(breakdown.photoTotalPaise)}</span>
                    </div>
                    {breakdown.guestTotalPaise > 0 && (
                      <div className="flex justify-between text-zinc-500">
                        <span>{effectiveGuest} guest slots</span>
                        <span className="font-mono">{formatInr(breakdown.guestTotalPaise)}</span>
                      </div>
                    )}
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

          {/* ── CTAs (owner only) ─────────────────────────────────────────────── */}
          {mode === "owner" && (
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

              <div className="flex items-center justify-center gap-1.5 text-[10px] text-zinc-600">
                <Shield size={9} className="text-zinc-700" />
                Secure payment via Razorpay — UPI, cards, netbanking accepted
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Admin breakdown (admin only) ──────────────────────────────────────── */}
      {isAdmin && (
        <AdminBreakdown
          photoQuota={photoQuota}
          guestQuota={effectiveGuest}
          validityDays={validityDays}
          ownerRevenue={breakdown.totalInr}
        />
      )}

    </div>
  );
}