"use client";

/**
 * Admin Pricing Config Page
 * Replaces the pricing-related fields that were previously in admin/settings.
 *
 * Add to admin nav: { href: "/admin/pricing", label: "Pricing", icon: IndianRupee }
 * Add route: app/admin/pricing/page.tsx → <AdminPricingPage />
 */

import { useEffect, useState, useCallback } from "react";
import {
  getAdminPricingConfig,
  updateAdminPricingConfig,
} from "@/services/adminApi";
import {
  Loader2, Save, RefreshCw, CheckCircle2, AlertCircle,
  IndianRupee, Camera, Users, Calendar, BarChart3,
} from "lucide-react";

interface PricingConfig {
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
  updated_at: string | null;
}

// ── Number field ──────────────────────────────────────────────────────────────

function NumField({
  label, value, onChange, min, max, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; suffix?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-zinc-500 block mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-200 font-mono"
        />
        {suffix && <span className="text-[11px] text-zinc-600 shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

// ── Tier editor ───────────────────────────────────────────────────────────────

function TierEditor({
  label, tiers, onChange,
}: {
  label: string;
  tiers: { bucket: number | null; rate_paise: number }[];
  onChange: (tiers: { bucket: number | null; rate_paise: number }[]) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-500 mb-2">{label}</p>
      <div className="space-y-1.5">
        {tiers.map((tier, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <input
                type="number"
                placeholder="bucket (null = rest)"
                value={tier.bucket ?? ""}
                onChange={(e) => {
                  const next = [...tiers];
                  next[i] = { ...tier, bucket: e.target.value === "" ? null : Number(e.target.value) };
                  onChange(next);
                }}
                className="w-full px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-300 font-mono"
              />
            </div>
            <span className="text-[11px] text-zinc-600">→</span>
            <div className="flex-1">
              <input
                type="number"
                placeholder="paise"
                value={tier.rate_paise}
                onChange={(e) => {
                  const next = [...tiers];
                  next[i] = { ...tier, rate_paise: Number(e.target.value) };
                  onChange(next);
                }}
                className="w-full px-2 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500/60 focus:outline-none text-xs text-zinc-300 font-mono"
              />
            </div>
            <span className="text-[10px] text-zinc-600 shrink-0">
              ₹{(tier.rate_paise / 100).toFixed(2)}/photo
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPricingPage() {
  const [config,   setConfig]   = useState<PricingConfig | null>(null);
  const [draft,    setDraft]    = useState<PricingConfig | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminPricingConfig();
      setConfig(data);
      setDraft(JSON.parse(JSON.stringify(data)));
    } catch {
      setSaveMsg({ ok: false, text: "Failed to load config" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateAdminPricingConfig({
        free_photo_quota:      draft.free_tier.photo_quota,
        free_guest_quota:      draft.free_tier.guest_quota,
        free_validity_days:    draft.free_tier.validity_days,
        min_photo_quota:       draft.paid_tier.min_photo_quota,
        max_photo_quota:       draft.paid_tier.max_photo_quota,
        min_guest_quota:       draft.paid_tier.min_guest_quota,
        max_guest_quota:       draft.paid_tier.max_guest_quota,
        base_event_fee_paise:  draft.paid_tier.base_event_fee_paise,
        photo_tiers:           draft.photo_tiers,
        guest_tiers:           draft.guest_tiers,
        validity_options:      draft.validity_options,
      });
      setSaveMsg({ ok: true, text: "Pricing config saved. Frontend cache invalidated." });
      load();
    } catch {
      setSaveMsg({ ok: false, text: "Save failed. Check values and try again." });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !draft) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={20} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  const setFreeTier = (k: keyof PricingConfig["free_tier"], v: number) =>
    setDraft((d) => d ? { ...d, free_tier: { ...d.free_tier, [k]: v } } : d);

  const setPaidTier = (k: keyof PricingConfig["paid_tier"], v: number) =>
    setDraft((d) => d ? { ...d, paid_tier: { ...d.paid_tier, [k]: v } } : d);

  return (
    <div className="space-y-7 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">Pricing Config</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            {config?.updated_at
              ? `Last updated: ${new Date(config.updated_at).toLocaleString()}`
              : "Sourced from pricing_config table"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-400 transition-colors"
          >
            <RefreshCw size={12} />
            Reload
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {saveMsg && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-xs ${
          saveMsg.ok
            ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-400"
            : "bg-red-500/8 border-red-500/20 text-red-400"
        }`}>
          {saveMsg.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {saveMsg.text}
        </div>
      )}

      {/* Free tier */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Camera size={14} className="text-emerald-400" />
          <h2 className="text-xs font-semibold text-zinc-300">Free Tier</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <NumField label="Photo quota"    value={draft.free_tier.photo_quota}   onChange={(v) => setFreeTier("photo_quota", v)}   min={1} max={10000} suffix="photos" />
          <NumField label="Guest quota"    value={draft.free_tier.guest_quota}   onChange={(v) => setFreeTier("guest_quota", v)}   min={0} max={1000}  suffix="slots" />
          <NumField label="Validity (days)" value={draft.free_tier.validity_days} onChange={(v) => setFreeTier("validity_days", v)} min={1} max={365}   suffix="days" />
        </div>
      </div>

      {/* Paid tier limits */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <IndianRupee size={14} className="text-blue-400" />
          <h2 className="text-xs font-semibold text-zinc-300">Paid Tier Limits &amp; Base Fee</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <NumField label="Min photo quota"      value={draft.paid_tier.min_photo_quota}      onChange={(v) => setPaidTier("min_photo_quota", v)}      min={1} />
          <NumField label="Max photo quota"      value={draft.paid_tier.max_photo_quota}      onChange={(v) => setPaidTier("max_photo_quota", v)}      max={100000} />
          <NumField label="Min guest quota"      value={draft.paid_tier.min_guest_quota}      onChange={(v) => setPaidTier("min_guest_quota", v)}      min={0} />
          <NumField label="Max guest quota"      value={draft.paid_tier.max_guest_quota}      onChange={(v) => setPaidTier("max_guest_quota", v)}      max={10000} />
          <NumField
            label="Base event fee"
            value={draft.paid_tier.base_event_fee_paise}
            onChange={(v) => setPaidTier("base_event_fee_paise", v)}
            min={0}
            suffix={`paise (₹${(draft.paid_tier.base_event_fee_paise / 100).toFixed(2)})`}
          />
        </div>
      </div>

      {/* Photo tiers */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={14} className="text-violet-400" />
          <h2 className="text-xs font-semibold text-zinc-300">Photo Pricing Tiers</h2>
          <span className="text-[10px] text-zinc-600 ml-1">bucket = number of photos in this tier; null = all remaining</span>
        </div>
        <TierEditor
          label="Photo tiers"
          tiers={draft.photo_tiers}
          onChange={(t) => setDraft((d) => d ? { ...d, photo_tiers: t } : d)}
        />
      </div>

      {/* Guest tiers */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users size={14} className="text-amber-400" />
          <h2 className="text-xs font-semibold text-zinc-300">Guest Upload Pricing Tiers</h2>
        </div>
        <TierEditor
          label="Guest tiers"
          tiers={draft.guest_tiers}
          onChange={(t) => setDraft((d) => d ? { ...d, guest_tiers: t } : d)}
        />
      </div>

      {/* Validity options */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={14} className="text-teal-400" />
          <h2 className="text-xs font-semibold text-zinc-300">Validity Options</h2>
        </div>
        <div className="space-y-3">
          {draft.validity_options.map((opt, i) => (
            <div key={i} className="flex items-center gap-4">
              <NumField
                label={`Option ${i + 1} — days`}
                value={opt.days}
                onChange={(v) => {
                  const next = [...draft.validity_options];
                  next[i] = { ...opt, days: v };
                  setDraft((d) => d ? { ...d, validity_options: next } : d);
                }}
                min={1} max={365}
              />
              <NumField
                label="Add-on (paise)"
                value={opt.addon_paise}
                onChange={(v) => {
                  const next = [...draft.validity_options];
                  next[i] = { ...opt, addon_paise: v };
                  setDraft((d) => d ? { ...d, validity_options: next } : d);
                }}
                min={0}
                suffix={`₹${(opt.addon_paise / 100).toFixed(2)}`}
              />
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  checked={opt.included}
                  onChange={(e) => {
                    const next = [...draft.validity_options];
                    next[i] = { ...opt, included: e.target.checked };
                    setDraft((d) => d ? { ...d, validity_options: next } : d);
                  }}
                  className="rounded"
                />
                <span className="text-[11px] text-zinc-500">Included (no add-on)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-zinc-600 pb-4">
        Changes take effect immediately after saving. The frontend module-scope cache is automatically invalidated so all new price calculations use the updated values.
      </p>
    </div>
  );
}
