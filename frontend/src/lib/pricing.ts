/**
 * frontend/src/lib/pricing.ts
 *
 * Client-side pricing engine.
 *
 * Single source of truth: app/core/pricing_config.json
 *   - This file reads pricing_config.json at import time.
 *   - Python backend (pricing.py) reads the same file.
 *   - To change any pricing value → edit pricing_config.json only.
 *
 * All monetary values in PAISE internally; helpers convert to ₹.
 */

import config from "@/../../app/core/pricing_config.json";

// ── Re-export raw config for components that need it ─────────────────────────
export const PRICING_CONFIG = config;

// ── Free tier ─────────────────────────────────────────────────────────────────
export const FREE_TIER = {
  photoQuota:   config.free_tier.photo_quota,
  guestQuota:   config.free_tier.guest_quota,
  validityDays: config.free_tier.validity_days,
};

// ── Paid tier limits ──────────────────────────────────────────────────────────
export const MIN_PHOTOS = config.paid_tier.min_photo_quota;
export const MAX_PHOTOS = config.paid_tier.max_photo_quota;
export const MIN_GUEST  = config.paid_tier.min_guest_quota;
export const MAX_GUEST  = config.paid_tier.max_guest_quota;

// ── Pricing constants ─────────────────────────────────────────────────────────
export const BASE_EVENT_FEE_PAISE = config.paid_tier.base_event_fee_paise;

export const PHOTO_TIERS: [number | null, number][] = config.photo_tiers.map(
  (t) => [t.bucket, t.rate_paise]
);

export const GUEST_TIERS: [number | null, number][] = config.guest_tiers.map(
  (t) => [t.bucket, t.rate_paise]
);

export const VALIDITY_OPTIONS = config.validity_options.map((v) => ({
  days:       v.days,
  label:      v.days === 365 ? "1 year" : `${v.days} days`,
  addonPaise: v.addon_paise,
  included:   v.included,
}));

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TierLine {
  label:     string;
  units:     number;
  ratePaise: number;
  subtotal:  number;
}

export interface PriceBreakdown {
  baseFeePaise:       number;
  photoTiers:         TierLine[];
  photoTotalPaise:    number;
  guestTiers:         TierLine[];
  guestTotalPaise:    number;
  validityAddonPaise: number;
  totalPaise:         number;
  totalInr:           number;
  photoQuota:         number;
  guestQuota:         number;
  validityDays:       number;
}

// ── Core calculation ──────────────────────────────────────────────────────────
function tieredCost(
  quantity: number,
  tiers: [number | null, number][],
): [number, TierLine[]] {
  let remaining  = quantity;
  let totalPaise = 0;
  const breakdown: TierLine[] = [];
  let usedSoFar  = 0;

  for (const [bucket, rate] of tiers) {
    if (remaining <= 0) break;
    const units    = bucket === null ? remaining : Math.min(remaining, bucket);
    const subtotal = units * rate;
    totalPaise    += subtotal;
    breakdown.push({
      label:     `${usedSoFar + 1}–${usedSoFar + units}`,
      units,
      ratePaise: rate,
      subtotal,
    });
    remaining  -= units;
    usedSoFar  += units;
  }

  return [totalPaise, breakdown];
}

export function calculatePrice(
  photoQuota:   number,
  guestQuota:   number = 0,
  validityDays: number = 30,
): PriceBreakdown {
  const validityOption = VALIDITY_OPTIONS.find((o) => o.days === validityDays);
  const validityAddon  = validityOption?.addonPaise ?? 0;

  const [photoTotal, photoTiers] = tieredCost(photoQuota, PHOTO_TIERS);
  const [guestTotal, guestTiers] = tieredCost(guestQuota, GUEST_TIERS);

  const totalPaise = BASE_EVENT_FEE_PAISE + photoTotal + guestTotal + validityAddon;

  return {
    baseFeePaise:       BASE_EVENT_FEE_PAISE,
    photoTiers,
    photoTotalPaise:    photoTotal,
    guestTiers,
    guestTotalPaise:    guestTotal,
    validityAddonPaise: validityAddon,
    totalPaise,
    totalInr:           Math.round(totalPaise) / 100,
    photoQuota,
    guestQuota,
    validityDays,
  };
}

// ── Formatting helpers ────────────────────────────────────────────────────────
export function formatInr(paise: number): string {
  const amount = paise / 100;
  return `₹${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

export function formatInrDecimal(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/** Returns the per-photo rate (paise) at the margin of a given quota. */
export function marginalRate(photoQuota: number): number {
  let used = 0;
  for (const [bucket, rate] of PHOTO_TIERS) {
    if (bucket === null) return rate;
    if (photoQuota <= used + bucket) return rate;
    used += bucket;
  }
  return PHOTO_TIERS[PHOTO_TIERS.length - 1][1]!;
}