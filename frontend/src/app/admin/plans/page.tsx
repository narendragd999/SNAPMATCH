"use client";

import { useEffect, useState } from "react";
import { getAdminPlans } from "@/services/adminApi";
import { Loader2, CheckCircle2, ImageIcon, CalendarDays, Zap } from "lucide-react";

type Plans = Record<string, {
  max_events: number;
  max_images_per_event: number;
  event_validity_days: number;
}>;

const PLAN_STYLE: Record<string, { border: string; badge: string; glow: string }> = {
  free:       { border: "border-zinc-800",    badge: "bg-zinc-800 text-zinc-400",                           glow: "" },
  pro:        { border: "border-blue-500/30", badge: "bg-blue-500/15 text-blue-400 border border-blue-500/30",    glow: "shadow-blue-500/5 shadow-lg" },
  enterprise: { border: "border-violet-500/30", badge: "bg-violet-500/15 text-violet-400 border border-violet-500/30", glow: "shadow-violet-500/5 shadow-lg" },
};

const FEATURES: Record<string, string[]> = {
  free:       ["5 events", "1,000 images / event", "7-day validity", "Selfie search", "Public event link"],
  pro:        ["10 events", "10,000 images / event", "30-day validity", "Selfie search", "Public event link", "Cluster ZIP download"],
  enterprise: ["100 events", "100,000 images / event", "365-day validity", "Selfie search", "Public event link", "Cluster ZIP download", "Priority support"],
};

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plans | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminPlans().then(setPlans).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={20} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="space-y-7 max-w-4xl">
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Plans</h1>
        <p className="text-xs text-zinc-600 mt-0.5">
          Current plan configuration from <code className="text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">app/core/plans.py</code>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans && Object.entries(plans).map(([name, config]) => {
          const style = PLAN_STYLE[name] || PLAN_STYLE.free;
          return (
            <div key={name} className={`bg-zinc-900 border ${style.border} rounded-2xl p-6 ${style.glow} relative overflow-hidden`}>
              {name === "pro" && (
                <div className="absolute top-3 right-3">
                  <span className="text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-medium">Popular</span>
                </div>
              )}

              {/* Name */}
              <span className={`text-[11px] font-semibold capitalize px-2.5 py-1 rounded-full ${style.badge}`}>
                {name}
              </span>

              {/* Stats */}
              <div className="mt-5 space-y-3">
                <div className="flex items-center gap-2.5">
                  <CalendarDays size={13} className="text-zinc-600 shrink-0" />
                  <div>
                    <p className="text-[10px] text-zinc-600">Max Events</p>
                    <p className="text-sm font-bold text-zinc-200">{config.max_events.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <ImageIcon size={13} className="text-zinc-600 shrink-0" />
                  <div>
                    <p className="text-[10px] text-zinc-600">Max Images / Event</p>
                    <p className="text-sm font-bold text-zinc-200">{config.max_images_per_event.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Zap size={13} className="text-zinc-600 shrink-0" />
                  <div>
                    <p className="text-[10px] text-zinc-600">Event Validity</p>
                    <p className="text-sm font-bold text-zinc-200">{config.event_validity_days} days</p>
                  </div>
                </div>
              </div>

              {/* Feature list */}
              <div className="mt-5 pt-4 border-t border-zinc-800 space-y-2">
                {(FEATURES[name] || []).map(f => (
                  <div key={f} className="flex items-center gap-2">
                    <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                    <span className="text-[11px] text-zinc-500">{f}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <p className="text-xs text-zinc-600 leading-relaxed">
          <span className="text-zinc-400 font-medium">Note:</span> Plan limits are enforced in <code className="text-zinc-500 bg-zinc-800 px-1 py-0.5 rounded text-[10px]">app/core/plans.py</code>.
          To change limits, update that file and redeploy. Plan upgrades for users are handled via Razorpay webhooks
          or manually through the Users page.
        </p>
      </div>
    </div>
  );
}