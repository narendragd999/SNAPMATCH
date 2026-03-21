/**
 * frontend/src/lib/pricing.ts
 *
 * Client-side pricing engine — reads config from API (GET /api/pricing/config).
 * No JSON file imports. No hardcoded constants.
 *
 * Usage:
 *   const config = await getPricingConfig();
 *   const breakdown = calculatePrice(config, photoQuota, guestQuota, validityDays);
 *   const freeTier = getFreeTier(config);
 *   const options  = getValidityOptions(config);
 *
 * After admin updates pricing:
 *   invalidatePricingConfig();   // next getPricingConfig() call fetches fresh data
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TierItem {
  bucket:     number | null;
  rate_paise: number;
}

export interface ValidityOption {
  days:        number;
  addon_paise: number;
  included:    boolean;
}

export interface PricingConfig {
  id: number;
  free_tier: {
    photo_quota:   number;
    guest_quota:   number;
    validity_days: number;
  };
  paid_tier: {
    min_photo_quota:      number;
    max_photo_quota:      number;
    min_guest_quota:      number;
    max_guest_quota:      number;
    base_event_fee_paise: number;
  };
  photo_tiers:      TierItem[];
  guest_tiers:      TierItem[];
  validity_options: ValidityOption[];
  updated_at: string | null;
}

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

// ── Module-scope cache ────────────────────────────────────────────────────────
// One fetch per browser session per tab. Survives React re-renders and
// route changes. Invalidated explicitly after admin pricing updates.

let _cache: PricingConfig | null = null;
let _fetchPromise: Promise<PricingConfig> | null = null;

const API = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export async function getPricingConfig(): Promise<PricingConfig> {
  if (_cache) return _cache;

  // Deduplicate concurrent calls — only one fetch in flight at a time
  if (!_fetchPromise) {
    _fetchPromise = fetch(`${API}/pricing/config`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch pricing config: ${r.status}`);
        return r.json() as Promise<PricingConfig>;
      })
      .then((data) => {
        _cache = data;
        _fetchPromise = null;
        return data;
      })
      .catch((err) => {
        _fetchPromise = null;
        throw err;
      });
  }

  return _fetchPromise;
}

/** Call this after admin saves new pricing so the next fetch gets fresh data. */
export function invalidatePricingConfig(): void {
  _cache = null;
  _fetchPromise = null;
}

// ── Config-derived helpers ────────────────────────────────────────────────────

export function getFreeTier(config: PricingConfig) {
  return {
    photoQuota:   config.free_tier.photo_quota,
    guestQuota:   config.free_tier.guest_quota,
    validityDays: config.free_tier.validity_days,
  };
}

export function getValidityOptions(config: PricingConfig) {
  return config.validity_options.map((v) => ({
    days:       v.days,
    label:      v.days === 365 ? "1 year" : `${v.days} days`,
    addonPaise: v.addon_paise,
    included:   v.included,
  }));
}

// ── Core calculation ──────────────────────────────────────────────────────────

function tieredCost(
  quantity: number,
  tiers: TierItem[],
): [number, TierLine[]] {
  let remaining  = quantity;
  let totalPaise = 0;
  const breakdown: TierLine[] = [];
  let usedSoFar  = 0;

  for (const { bucket, rate_paise: rate } of tiers) {
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
  config:       PricingConfig,
  photoQuota:   number,
  guestQuota:   number = 0,
  validityDays: number = 30,
): PriceBreakdown {
  const validityOption = config.validity_options.find((o) => o.days === validityDays);
  const validityAddon  = validityOption?.addon_paise ?? 0;

  const [photoTotal, photoTiers] = tieredCost(photoQuota, config.photo_tiers);
  const [guestTotal, guestTiers] = tieredCost(guestQuota, config.guest_tiers);

  const totalPaise =
    config.paid_tier.base_event_fee_paise + photoTotal + guestTotal + validityAddon;

  return {
    baseFeePaise:       config.paid_tier.base_event_fee_paise,
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
export function marginalRate(config: PricingConfig, photoQuota: number): number {
  let used = 0;
  for (const { bucket, rate_paise } of config.photo_tiers) {
    if (bucket === null) return rate_paise;
    if (photoQuota <= used + bucket) return rate_paise;
    used += bucket;
  }
  return config.photo_tiers[config.photo_tiers.length - 1].rate_paise;
}
