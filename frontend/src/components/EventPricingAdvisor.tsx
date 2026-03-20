"use client";

/**
 * EventPricingAdvisor.tsx
 *
 * Three named exports — one shared calculation core, three UI surfaces:
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  EventPricingAdvisor   → event create page (owner, paid events)     │
 * │    Shows: recommended price + what's included                       │
 * │    Hidden: R2, GPU, VPS, Razorpay, margins, profits, tiers         │
 * │                                                                     │
 * │  PublicPricingDisplay  → public event page                         │
 * │    Shows: recommended price + what's included (same as owner)      │
 * │    Hidden: everything financial                                     │
 * │                                                                     │
 * │  AdminPricingAdvisor   → admin panel only                          │
 * │    Shows: full breakdown, all tiers, margins, profits, Razorpay    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * USAGE — Event create page (owner, paid events only):
 *   import { EventPricingAdvisor } from "@/components/EventPricingAdvisor";
 *   {form.plan_type === "paid" && (
 *     <EventPricingAdvisor
 *       photoQuota={form.photo_quota}
 *       validityDays={form.validity_days}
 *       guestQuota={form.guest_quota}
 *     />
 *   )}
 *
 * USAGE — Public event page:
 *   import { PublicPricingDisplay } from "@/components/EventPricingAdvisor";
 *   <PublicPricingDisplay
 *     photoQuota={event.photo_quota}
 *     validityDays={event.validity_days}
 *     guestQuota={event.guest_quota}
 *   />
 *
 * USAGE — Admin panel:
 *   import { AdminPricingAdvisor } from "@/components/EventPricingAdvisor";
 *   <AdminPricingAdvisor
 *     photoQuota={event.photo_quota}
 *     validityDays={event.validity_days}
 *     guestQuota={event.guest_quota}
 *   />
 */

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, IndianRupee, TrendingUp, Info, ShieldCheck } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// COST CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const COST = {
  r2StoragePerGBMonth:   0.015,   // Cloudflare R2 $/GB/month
  r2ClassAPerMillion:    4.50,    // R2 upload ops $/million
  r2ClassBPerMillion:    0.36,    // R2 read ops $/million
  runpodRTX4090PerHr:    1.04,    // RTX 4090 community cloud $/hr
  clipSecPerImage:       0.5,     // inference seconds per owner photo
  razorpayRate:          0.02,    // 2% base
  razorpayGST:           0.18,    // 18% GST on fee → effective 2.36%
  vpsMonthlyINR:         2499,    // Hostinger KVM8
  eventsPerMonth:        30,      // VPS amortisation denominator
  avgOwnerPhotoGB:       0.0016,  // ~1.6 MB after optimization pipeline
  avgGuestPhotoGB:       0.0008,  // ~800 KB guest uploads
  searchResultsPerQuery: 10,      // avg photos fetched per face-search
  USD_TO_INR:            84,
  TARGET_MARGIN:         0.40,    // 40% used for base price calculation
};

const RZ_EFF = COST.razorpayRate * (1 + COST.razorpayGST); // 2.36%

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface AdvisorProps {
  photoQuota:   number;
  validityDays: number;
  guestQuota?:  number;
}

interface Breakdown {
  storageINR: number;
  opsINR:     number;
  gpuINR:     number;
  vpsINR:     number;
  totalINR:   number;
  queries:    number;
}



// ─────────────────────────────────────────────────────────────────────────────
// SHARED CALCULATION CORE
// All math runs here — never exposed to owner or public surfaces
// ─────────────────────────────────────────────────────────────────────────────

function calculate(photoQuota: number, validityDays: number, guestQuota: number) {
  const p = Math.max(photoQuota,   1);
  const d = Math.max(validityDays, 1);
  const g = Math.max(guestQuota,   0);

  // Storage — pro-rated by validity days
  const storageGB  = p * COST.avgOwnerPhotoGB + g * COST.avgGuestPhotoGB;
  const storageINR = storageGB * (d / 30) * COST.r2StoragePerGBMonth * COST.USD_TO_INR;

  // R2 ops — Class A (upload) + Class B (search reads)
  const queries = Math.max(50, Math.round(p / 2));
  const opsINR  = (
    ((p + g) / 1_000_000) * COST.r2ClassAPerMillion +
    (queries * COST.searchResultsPerQuery / 1_000_000) * COST.r2ClassBPerMillion
  ) * COST.USD_TO_INR;

  // RunPod GPU — owner photos only (guests bypass CLIP pipeline)
  const gpuINR = ((p * COST.clipSecPerImage + 5) / 3600) * COST.runpodRTX4090PerHr * COST.USD_TO_INR;

  // VPS share
  const vpsINR    = COST.vpsMonthlyINR / COST.eventsPerMonth;
  const totalINR  = storageINR + opsINR + gpuINR + vpsINR;

  // Base recommended price at 40% target margin
  const basePrice = Math.ceil((totalINR / (1 - COST.TARGET_MARGIN - RZ_EFF)) / 100) * 100;

  // Single best tier — standard (40% target margin, rounded up to nearest ₹100)
  const price  = basePrice;
  const rzFee  = price * RZ_EFF;
  const profit = price - totalINR - rzFee;
  const margin = (profit / price) * 100;
  const recommended = { price, rzFee, profit, margin };

  const breakdown: Breakdown = { storageINR, opsINR, gpuINR, vpsINR, totalINR, queries };
  return { recommended, breakdown };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

const fmtINR = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED PRICE CARD
// Used by both EventPricingAdvisor (owner) and PublicPricingDisplay (public)
// Shows ONLY price + what's included — zero financial details
// ─────────────────────────────────────────────────────────────────────────────

function PriceCard({
  price, photoQuota, validityDays, guestQuota, context,
}: {
  price: number; photoQuota: number; validityDays: number;
  guestQuota: number; context: "owner" | "public";
}) {
  const pills = [
    `${photoQuota.toLocaleString()} photos`,
    `${validityDays}-day access`,
    ...(guestQuota > 0 ? [`${guestQuota} guest uploads`] : []),
    "AI face search",
  ];

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0c1220 0%, #0f172a 100%)",
        border: "1px solid rgba(99,102,241,0.2)",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.25)" }}
        >
          <IndianRupee size={13} className="text-indigo-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-200">
            {context === "owner" ? "Suggested Event Price" : "Event Price"}
          </p>
          <p className="text-[10px] text-zinc-500">
            {context === "owner"
              ? "Based on your configuration"
              : `${photoQuota.toLocaleString()} photos · ${validityDays} days`}
          </p>
        </div>
      </div>

      {/* Price */}
      <div className="px-4 py-5">
        <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">
          Recommended price
        </p>
        <div className="flex items-baseline gap-2 mb-4">
          <span
            className="font-bold text-white"
            style={{ fontSize: "44px", letterSpacing: "-2px", lineHeight: 1 }}
          >
            {fmtINR(price)}
          </span>
          <span className="text-sm text-zinc-500">/ event</span>
        </div>

        {/* Included features */}
        <div className="flex flex-wrap gap-2">
          {pills.map(item => (
            <span
              key={item}
              className="text-[10px] font-medium px-2.5 py-1 rounded-full"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#94a3b8",
              }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 text-[10px] text-zinc-600"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(99,102,241,0.03)" }}
      >
        <ShieldCheck size={10} className="text-indigo-600 flex-shrink-0" />
        {context === "owner"
          ? "Set your final price in the plan configuration above"
          : "Pricing includes AI photo processing and secure cloud storage"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT 1 — EventPricingAdvisor
// Event create page (owner). Gate with: form.plan_type === "paid"
// ─────────────────────────────────────────────────────────────────────────────

export function EventPricingAdvisor({ photoQuota, validityDays, guestQuota = 0 }: AdvisorProps) {
  const { recommended } = useMemo(
    () => calculate(photoQuota || 0, validityDays || 30, guestQuota || 0),
    [photoQuota, validityDays, guestQuota],
  );
  if (!photoQuota || photoQuota < 1) return null;
  return (
    <PriceCard
      price={recommended.price}
      photoQuota={photoQuota}
      validityDays={validityDays}
      guestQuota={guestQuota}
      context="owner"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT 2 — PublicPricingDisplay
// Public event page. Identical UI to owner view.
// ─────────────────────────────────────────────────────────────────────────────

export function PublicPricingDisplay({ photoQuota, validityDays, guestQuota = 0 }: AdvisorProps) {
  const { recommended } = useMemo(
    () => calculate(photoQuota || 0, validityDays || 30, guestQuota || 0),
    [photoQuota, validityDays, guestQuota],
  );
  if (!photoQuota || photoQuota < 1) return null;
  return (
    <PriceCard
      price={recommended.price}
      photoQuota={photoQuota}
      validityDays={validityDays}
      guestQuota={guestQuota}
      context="public"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT 3 — AdminPricingAdvisor
// Admin panel only. Full financial breakdown.
// ─────────────────────────────────────────────────────────────────────────────

export function AdminPricingAdvisor({ photoQuota, validityDays, guestQuota = 0 }: AdvisorProps) {
  const [expanded, setExpanded] = useState(true);

  const { recommended, breakdown } = useMemo(
    () => calculate(photoQuota || 0, validityDays || 30, guestQuota || 0),
    [photoQuota, validityDays, guestQuota],
  );

  if (!photoQuota || photoQuota < 1) return null;

  const breakdownRows = [
    { icon: "💾", label: "Cloudflare R2 Storage",          value: breakdown.storageINR, color: "#d97706" },
    { icon: "⚙️", label: "R2 Operations (upload + reads)",  value: breakdown.opsINR,    color: "#3b82f6" },
    { icon: "🖥️", label: "RunPod GPU — CLIP inference",    value: breakdown.gpuINR,    color: "#8b5cf6" },
    { icon: "🔧", label: "VPS share — Hostinger KVM8",     value: breakdown.vpsINR,    color: "#10b981" },
    { icon: "💳", label: `Razorpay — 2.36% effective`,     value: recommended.rzFee,   color: "#ef4444" },
  ];

  const marginColor = (m: number) =>
    m > 35 ? "#10b981" : m > 20 ? "#f59e0b" : "#ef4444";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "#0a0f1c", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Admin header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.25)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <TrendingUp size={13} className="text-red-400" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-200">Pricing Analysis</p>
            <p className="text-[10px] text-zinc-500">Admin view — full cost breakdown</p>
          </div>
        </div>
        <span
          className="text-[9px] font-bold px-2 py-0.5 rounded tracking-wide"
          style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.15)" }}
        >
          ADMIN ONLY
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-px" style={{ background: "rgba(255,255,255,0.04)" }}>
        {[
          { label: "Infra cost",  value: fmtINR(breakdown.totalINR),   color: "#f59e0b" },
          { label: "Razorpay",   value: fmtINR(recommended.rzFee),     color: "#ef4444" },
          { label: "Profit",     value: fmtINR(recommended.profit),    color: "#10b981" },
          { label: "Net margin", value: fmtPct(recommended.margin),    color: marginColor(recommended.margin) },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="flex flex-col items-center py-3 px-2 text-center"
            style={{ background: "#0a0f1c" }}
          >
            <span className="text-[10px] text-zinc-600 mb-1">{label}</span>
            <span className="text-sm font-bold" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>



      {/* Collapsible full breakdown */}
      <div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          style={{ borderBottom: expanded ? "1px solid rgba(255,255,255,0.05)" : "none" }}
        >
          <span className="flex items-center gap-1.5">
            <TrendingUp size={10} />
            Full breakdown · {fmtINR(breakdown.totalINR)} infra · {fmtINR(breakdown.totalINR / photoQuota)} per photo
          </span>
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>

        {expanded && (
          <div className="px-4 pb-4">
            {/* Breakdown bars */}
            <div className="mb-3">
              {breakdownRows.map((row, i) => {
                const base  = breakdown.totalINR + recommended.rzFee;
                const pct   = (row.value / base) * 100;
                return (
                  <div
                    key={row.label}
                    className="flex items-center gap-3 py-2.5"
                    style={{ borderBottom: i < breakdownRows.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                  >
                    <span className="text-sm w-5 text-center flex-shrink-0">{row.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-xs text-zinc-400 truncate">{row.label}</span>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                          <span className="text-[10px] text-zinc-600 w-8 text-right">{fmtPct(pct)}</span>
                          <span className="text-xs font-semibold w-16 text-right" style={{ color: row.color }}>
                            {fmtINR(row.value)}
                          </span>
                        </div>
                      </div>
                      <div className="h-1 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: row.color }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Assumptions */}
            <div
              className="rounded-lg p-2.5 text-[10px] text-zinc-600 leading-relaxed mb-3"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
            >
              <span className="flex items-center gap-1 text-zinc-500 font-medium mb-1">
                <Info size={10} /> Assumptions
              </span>
              ~1.6 MB/photo post-pipeline · RTX 4090 GPU · {breakdown.queries} estimated searches
              {guestQuota > 0 && ` · ${guestQuota} guest slots at ~800 KB each`}
              {" · "}₹2,499/mo VPS ÷ {COST.eventsPerMonth} events · ₹{COST.USD_TO_INR}/USD · 40% target margin
            </div>

            {/* Monthly projection */}
            <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">
              Monthly projection — standard tier
            </p>
            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
              {[5, 10, 20, 30].map((evts, i) => {
                const rev    = recommended.price * evts;
                const costs  = (breakdown.totalINR + recommended.rzFee) * evts;
                const profit = rev - costs;
                return (
                  <div
                    key={evts}
                    className="grid px-3 py-2 text-[11px]"
                    style={{
                      gridTemplateColumns: "52px 1fr 1fr 1fr",
                      gap: "8px",
                      borderBottom: i < 3 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      background: i % 2 ? "rgba(255,255,255,0.01)" : "transparent",
                    }}
                  >
                    <span className="text-zinc-400 font-medium">{evts} events</span>
                    <span className="text-indigo-400">{fmtINR(rev)} revenue</span>
                    <span className="text-amber-500">{fmtINR(costs)} costs</span>
                    <span
                      className="font-semibold text-right"
                      style={{ color: profit > 0 ? "#10b981" : "#ef4444" }}
                    >
                      {fmtINR(profit)} profit
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
