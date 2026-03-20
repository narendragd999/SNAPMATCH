/**
 * frontend/src/lib/pricing.ts
 *
 * Client-side pricing engine — mirrors app/core/pricing.py exactly.
 * Used by the slider calculator on /pricing and /events/create pages.
 * All monetary values in PAISE internally; helpers convert to ₹.
 *
 * ⚠️  MIRROR FILE — always update pricing.py and pricing.ts together.
 *     Frontend: price preview on slider only.
 *     Backend pricing.py: source of truth for actual charges.
 *
 * ─── Infra cost model (verified against real pipeline) ──────────────────────
 * Image pipeline: 1200px JPEG Q85 = ~1.5 MB/photo → 1000 photos = 1.5 GB
 * Total infra per 1000-photo event: ₹98  (VPS ₹83 + RunPod ₹12 + R2 ₹2)
 * Razorpay effective: 2.36%  (2% + 18% GST on fee)
 *
 * Verified profit at key event sizes:
 *    50 photos → ₹109  charge → ₹22  profit (20% — edge case)
 *   200 photos → ₹139  charge → ₹50  profit (36% margin)
 *   500 photos → ₹199  charge → ₹104 profit (52% margin)
 *  1000 photos → ₹274  charge → ₹170 profit (62% margin)
 *  2000 photos → ₹374  charge → ₹254 profit (68% margin)
 *  5000 photos → ₹614  charge → ₹446 profit (73% margin)
 * 10000 photos → ₹964  charge → ₹718 profit (74% margin)
 */

// ── Base fee (covers fixed VPS overhead ₹83/event) ───────────────────────────
export const BASE_EVENT_FEE_PAISE = 9_900; // ₹99

// ── Photo tiers (paise per photo) ────────────────────────────────────────────
// Low rates, competitive vs Kwikpic (~₹85/event subscription).
// Profitable from 200 photos upward.
export const PHOTO_TIERS: [number | null, number][] = [
  [500,  20],    // ₹0.20/photo — first 500
  [500,  15],    // ₹0.15/photo — 501–1000
  [2000, 10],    // ₹0.10/photo — 1001–3000
  [null,  7],    // ₹0.07/photo — 3001+
];

// ── Guest tiers (paise per guest slot) ───────────────────────────────────────
export const GUEST_TIERS: [number | null, number][] = [
  [50,   10],    // ₹0.10/guest — first 50
  [150,   8],    // ₹0.08/guest — 51–200
  [300,   6],    // ₹0.06/guest — 201–500
  [null,  4],    // ₹0.04/guest — 501+
];

// ── Validity add-ons ──────────────────────────────────────────────────────────
export const VALIDITY_OPTIONS = [
  { days: 30,  label: "30 days",  addonPaise: 0,      included: true  },
  { days: 90,  label: "90 days",  addonPaise: 4_900,  included: false },
  { days: 365, label: "1 year",   addonPaise: 14_900, included: false },
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