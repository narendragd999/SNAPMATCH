"use client";
/**
 * frontend/src/components/EventQuotaBar.tsx
 *
 * Quota usage bars for the event detail page overview tab.
 * Shows:
 *   - Photo quota usage (owner uploads)
 *   - Guest quota usage (approved guest photos)
 *   - Event validity / expiry
 *   - Payment status
 *
 * Usage in EventDetail page:
 *   import EventQuotaBar from "@/components/EventQuotaBar";
 *   <EventQuotaBar eventId={eventId} />
 */

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Camera, Users, Calendar, Clock, Zap,
  AlertTriangle, CheckCircle, Gift,
  ToggleLeft, ToggleRight, Loader2,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuotaData {
  event_id:         number;
  event_name:       string;
  photo_quota:      number;
  photos_used:      number;
  photos_remaining: number;
  photo_pct:        number;
  guest_quota:      number;
  guest_used:       number;
  guest_remaining:  number;
  guest_pct:        number;
  guest_enabled:    boolean;
  validity_days:    number;
  is_free_tier:     boolean;
  payment_status:   string;
  expires_at:       string | null;
  is_expired:       boolean;
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function QuotaBar({
  used,
  total,
  pct,
  color,
}: {
  used:  number;
  total: number;
  pct:   number;
  color: "blue" | "violet" | "amber";
}) {
  const colors = {
    blue:   { bar: "bg-blue-500",   track: "bg-blue-500/10" },
    violet: { bar: "bg-violet-500", track: "bg-violet-500/10" },
    amber:  { bar: "bg-amber-500",  track: "bg-amber-500/10" },
  };

  const isNearFull = pct >= 85;
  const barColor = isNearFull ? "bg-amber-500" : colors[color].bar;

  return (
    <div className="space-y-1.5">
      <div className={`w-full h-1.5 rounded-full ${colors[color].track} overflow-hidden`}>
        <motion.div
          className={`h-full rounded-full ${barColor} transition-colors`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(pct, 100)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-zinc-500">
        <span>{used.toLocaleString()} used</span>
        <span>{total.toLocaleString()} total</span>
      </div>
    </div>
  );
}

// ── Days remaining ────────────────────────────────────────────────────────────

function daysRemaining(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  eventId:           number | string;
  guestEnabled?:     boolean;  // controlled externally from event detail
  onToggleGuest?:    (enabled: boolean) => void;
  showGuestToggle?:  boolean;
}

export default function EventQuotaBar({
  eventId,
  showGuestToggle = true,
  onToggleGuest,
}: Props) {
  const [quota,         setQuota]         = useState<QuotaData | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [toggling,      setToggling]      = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem("token") ?? "";
    try {
      const res = await fetch(`${API}/billing/event-quota/${eventId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setQuota(await res.json());
    } catch {}
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleGuestToggle = useCallback(async () => {
    if (!quota || toggling) return;
    setToggling(true);
    const token = localStorage.getItem("token") ?? "";
    const newEnabled = !quota.guest_enabled;

    try {
      const res = await fetch(`${API}/events/${eventId}/guest-upload`, {
        method: "PATCH",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      if (res.ok) {
        setQuota((q) => q ? { ...q, guest_enabled: newEnabled } : q);
        onToggleGuest?.(newEnabled);
      }
    } catch {}
    setToggling(false);
  }, [quota, toggling, eventId, onToggleGuest]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-600 py-4">
        <Loader2 size={12} className="animate-spin" />
        Loading quota...
      </div>
    );
  }

  if (!quota) return null;

  const days    = daysRemaining(quota.expires_at);
  const expired = quota.is_expired;
  const paid    = quota.payment_status === "paid" || quota.payment_status === "free";

  return (
    <div className="space-y-3">

      {/* Payment / expiry status banner */}
      {!paid && (
        <div className="flex items-center gap-2.5 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
          <p className="text-xs text-amber-400">
            Payment pending — complete payment to start uploading photos.
          </p>
        </div>
      )}

      {expired && (
        <div className="flex items-center gap-2.5 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle size={13} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-400">This event has expired. Photos are read-only.</p>
        </div>
      )}

      {/* Quota cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {/* Photo quota */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Camera size={11} className="text-blue-400" />
              </div>
              <span className="text-xs font-medium text-zinc-300">Photos</span>
              {quota.is_free_tier && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  Free
                </span>
              )}
            </div>
            <span className={`text-xs font-semibold font-mono ${
              quota.photo_pct >= 85 ? "text-amber-400" : "text-blue-400"
            }`}>
              {quota.photo_pct.toFixed(0)}%
            </span>
          </div>
          <QuotaBar
            used={quota.photos_used}
            total={quota.photo_quota}
            pct={quota.photo_pct}
            color="blue"
          />
          <p className="text-[10px] text-zinc-600 mt-2">
            {quota.photos_remaining} slot{quota.photos_remaining !== 1 ? "s" : ""} remaining
          </p>
        </div>

        {/* Guest quota */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Users size={11} className="text-violet-400" />
              </div>
              <span className="text-xs font-medium text-zinc-300">Guest Uploads</span>
            </div>

            {/* Toggle (only if quota > 0 and not expired) */}
            {showGuestToggle && quota.guest_quota > 0 && !expired && (
              <button
                onClick={handleGuestToggle}
                disabled={toggling}
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
                title={quota.guest_enabled ? "Disable guest uploads" : "Enable guest uploads"}
              >
                {toggling ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : quota.guest_enabled ? (
                  <ToggleRight size={16} className="text-violet-400" />
                ) : (
                  <ToggleLeft size={16} className="text-zinc-600" />
                )}
                {quota.guest_enabled ? "On" : "Off"}
              </button>
            )}
          </div>

          {quota.guest_quota === 0 ? (
            <p className="text-[11px] text-zinc-600">
              No guest upload quota purchased. Create a new event with guest slots to enable.
            </p>
          ) : (
            <>
              <QuotaBar
                used={quota.guest_used}
                total={quota.guest_quota}
                pct={quota.guest_pct}
                color="violet"
              />
              <p className="text-[10px] text-zinc-600 mt-2">
                {quota.guest_remaining} slot{quota.guest_remaining !== 1 ? "s" : ""} remaining
                {!quota.guest_enabled && " · Currently disabled"}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Validity row */}
      {quota.expires_at && (
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <div className="w-6 h-6 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
            <Calendar size={11} className={expired ? "text-red-400" : days && days <= 7 ? "text-amber-400" : "text-zinc-400"} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-zinc-300">
              {expired
                ? "Event expired"
                : days !== null && days <= 7
                  ? `Expires in ${days} day${days !== 1 ? "s" : ""}!`
                  : `Expires ${new Date(quota.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
              }
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {quota.validity_days}-day validity ·{" "}
              {quota.is_free_tier ? "Free tier" : `Paid event`}
            </p>
          </div>
          {!expired && (
            <CheckCircle size={13} className="text-emerald-400 flex-shrink-0" />
          )}
        </div>
      )}
    </div>
  );
}
