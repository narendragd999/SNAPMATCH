/**
 * frontend/src/lib/pricing.ts
 *
 * Single source of truth: pricing_config DB table
 *   - No JSON file imports, no hardcoded values
 *   - Fetches GET /api/pricing/config once and caches in module scope
 *   - Admin updates via PUT /api/pricing/config → call invalidatePricingConfig()
 */

// ── Types ─────────────────────────────────────────────────────────────────────

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
  photo_tiers:      { bucket: number | null; rate_paise: number }[];
  guest_tiers:      { bucket: number | null; rate_paise: number }[];
  validity_options: { days: number; addon_paise: number; included: boolean }[];
  updated_at:       string | null;
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

// ── Config cache ──────────────────────────────────────────────────────────────

let _cache: PricingConfig | null = null;

export async function getPricingConfig(): Promise<PricingConfig> {
  if (_cache) return _cache;
  const res = await fetch("/api/pricing/config");
  if (!res.ok) throw new Error("Failed to load pricing config");
  _cache = await res.json();
  return _cache!;
}

/** Call after admin saves changes so next fetch gets fresh data. */
export function invalidatePricingConfig(): void {
  _cache = null;
}

// ── Derived helpers ───────────────────────────────────────────────────────────

export function getValidityOptions(config: PricingConfig) {
  return config.validity_options.map((v) => ({
    days:       v.days,
    label:      v.days === 365 ? "1 year" : `${v.days} days`,
    addonPaise: v.addon_paise,
    included:   v.included,
  }));
}

export function getFreeTier(config: PricingConfig) {
  return {
    photoQuota:   config.free_tier.photo_quota,
    guestQuota:   config.free_tier.guest_quota,
    validityDays: config.free_tier.validity_days,
  };
}

// ── Core calculation ──────────────────────────────────────────────────────────

function tieredCost(
  quantity: number,
  tiers: { bucket: number | null; rate_paise: number }[],
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
  const baseFee        = config.paid_tier.base_event_fee_paise;

  const [photoTotal, photoTiers] = tieredCost(photoQuota, config.photo_tiers);
  const [guestTotal, guestTiers] = tieredCost(guestQuota, config.guest_tiers);
  const totalPaise               = baseFee + photoTotal + guestTotal + validityAddon;

  return {
    baseFeePaise:       baseFee,
    photoTiers,         photoTotalPaise: photoTotal,
    guestTiers,         guestTotalPaise: guestTotal,
    validityAddonPaise: validityAddon,
    totalPaise,         totalInr: Math.round(totalPaise) / 100,
    photoQuota,         guestQuota,      validityDays,
  };
}

export function marginalRate(config: PricingConfig, photoQuota: number): number {
  let used = 0;
  for (const { bucket, rate_paise } of config.photo_tiers) {
    if (bucket === null) return rate_paise;
    if (photoQuota <= used + bucket) return rate_paise;
    used += bucket;
  }
  return config.photo_tiers[config.photo_tiers.length - 1].rate_paise;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatInr(paise: number): string {
  const amount = paise / 100;
  return `₹${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

export function formatInrDecimal(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}