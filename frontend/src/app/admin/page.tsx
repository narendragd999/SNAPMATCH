"use client";

import { useEffect, useState } from "react";
import { getAdminStats, triggerCleanup } from "@/services/adminApi";
import {
  Users,
  CalendarDays,
  ImageIcon,
  ScanFace,
  TrendingUp,
  Clock,
  Loader2,
  Trash2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface Stats {
  total_users: number;
  total_events: number;
  total_images: number;
  total_faces: number;
  plan_distribution: Record<string, number>;
  status_distribution: Record<string, number>;
  new_users_this_week: number;
  expiring_soon: number;
}

const PLAN_COLORS: Record<string, string> = {
  free:       "bg-zinc-700 text-zinc-300",
  pro:        "bg-blue-500/20 text-blue-400",
  enterprise: "bg-violet-500/20 text-violet-400",
};

const STATUS_COLORS: Record<string, string> = {
  completed:  "text-emerald-400",
  processing: "text-blue-400",
  failed:     "text-red-400",
  pending:    "text-zinc-500",
  queued:     "text-amber-400",
};

export default function AdminDashboard() {
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState("");

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  const handleCleanup = async () => {
    setCleaning(true);
    setCleanMsg("");
    try {
      const res = await triggerCleanup();
      setCleanMsg(`✅ ${res.message}`);
    } catch {
      setCleanMsg("❌ Cleanup failed");
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={22} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  if (!stats) return null;

  const topCards = [
    { label: "Total Users",  value: stats.total_users,  icon: Users,        color: "text-blue-400",    sub: `+${stats.new_users_this_week} this week` },
    { label: "Total Events", value: stats.total_events, icon: CalendarDays, color: "text-violet-400",  sub: `${stats.expiring_soon} expiring soon` },
    { label: "Total Images", value: stats.total_images.toLocaleString(), icon: ImageIcon, color: "text-amber-400", sub: "across all events" },
    { label: "Faces Found",  value: stats.total_faces.toLocaleString(),  icon: ScanFace,  color: "text-emerald-400", sub: "processed embeddings" },
  ];

  return (
    <div className="space-y-7 max-w-5xl">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Dashboard</h1>
        <p className="text-xs text-zinc-600 mt-0.5">System-wide overview</p>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {topCards.map(({ label, value, icon: Icon, color, sub }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-zinc-500">{label}</span>
              <Icon size={14} className={color} />
            </div>
            <p className="text-2xl font-bold text-zinc-100">{value}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Plan + Status distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Plan distribution */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Plan Distribution</h2>
          </div>
          <div className="space-y-2.5">
            {Object.entries(stats.plan_distribution).map(([plan, count]) => {
              const pct = stats.total_users > 0
                ? Math.round((count / stats.total_users) * 100)
                : 0;
              return (
                <div key={plan}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${PLAN_COLORS[plan] || "bg-zinc-700 text-zinc-300"}`}>
                      {plan}
                    </span>
                    <span className="text-xs text-zinc-400">{count} users <span className="text-zinc-600">({pct}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Processing status */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-zinc-500" />
            <h2 className="text-xs font-semibold text-zinc-300">Event Processing Status</h2>
          </div>
          <div className="space-y-2">
            {Object.entries(stats.status_distribution).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between py-1.5 border-b border-zinc-800 last:border-0">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    status === "completed"  ? "bg-emerald-400" :
                    status === "failed"     ? "bg-red-400"     :
                    status === "processing" ? "bg-blue-400"    :
                    status === "queued"     ? "bg-amber-400"   :
                    "bg-zinc-600"
                  }`} />
                  <span className={`text-xs capitalize ${STATUS_COLORS[status] || "text-zinc-500"}`}>
                    {status}
                  </span>
                </div>
                <span className="text-xs font-medium text-zinc-300">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tools */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 size={14} className="text-zinc-500" />
          <h2 className="text-xs font-semibold text-zinc-300">Quick Tools</h2>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleCleanup}
            disabled={cleaning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 transition-colors disabled:opacity-60"
          >
            {cleaning
              ? <Loader2 size={13} className="animate-spin" />
              : <Trash2 size={13} />
            }
            Run Expired Events Cleanup
          </button>
          {cleanMsg && (
            <span className="text-xs text-zinc-400">{cleanMsg}</span>
          )}
        </div>
      </div>
    </div>
  );
}