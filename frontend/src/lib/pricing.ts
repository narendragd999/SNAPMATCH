/**
 * frontend/src/lib/pricing.ts
 *
 * Client-side pricing engine — mirrors app/core/pricing.py exactly.
 * Used by the slider calculator on /pricing and /events/create pages.
 * All monetary values in PAISE internally; helpers convert to ₹.
 */

export const BASE_EVENT_FEE_PAISE = 4_900; // ₹49

export const PHOTO_TIERS: [number | null, number][] = [
  [200, 50],   // ₹0.50
  [300, 40],   // ₹0.40
  [500, 30],   // ₹0.30
  [1000, 25],  // ₹0.25
  [3000, 20],  // ₹0.20
  [null, 15],  // ₹0.15
];

export const GUEST_TIERS: [number | null, number][] = [
  [50, 10],    // ₹0.10
  [150, 8],    // ₹0.08
  [300, 6],    // ₹0.06
  [null, 4],   // ₹0.04
];

export const VALIDITY_OPTIONS = [
  { days: 30,  label: "30 days",  addonPaise: 0,      included: true  },
  { days: 90,  label: "90 days",  addonPaise: 9_900,  included: false },
  { days: 365, label: "1 year",   addonPaise: 29_900, included: false },
] as const;

export const MIN_PHOTOS  = 50;
export const MAX_PHOTOS  = 10_000;
export const MIN_GUEST   = 0;
export const MAX_GUEST   = 1_000;

export const FREE_TIER = {
  photoQuota:   50,
  guestQuota:   10,
  validityDays: 7,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TierLine {
  label:      string;
  units:      number;
  ratePaise:  number;
  subtotal:   number;
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
  let remaining   = quantity;
  let totalPaise  = 0;
  const breakdown: TierLine[] = [];
  let usedSoFar   = 0;

  for (const [bucket, rate] of tiers) {
    if (remaining <= 0) break;
    const units = bucket === null ? remaining : Math.min(remaining, bucket);
    const subtotal = units * rate;
    totalPaise += subtotal;

    breakdown.push({
      label:     `${usedSoFar + 1}–${usedSoFar + units}`,
      units,
      ratePaise: rate,
      subtotal,
    });

    remaining   -= units;
    usedSoFar   += units;
  }

  return [totalPaise, breakdown];
}

export function calculatePrice(
  photoQuota:   number,
  guestQuota:   number  = 0,
  validityDays: number  = 30,
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
