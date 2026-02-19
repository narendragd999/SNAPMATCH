"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import API from "@/services/api";
import {
  Sparkles, Folder, ImageIcon, Activity,
  PlusCircle, Rocket, AlertTriangle, Crown,
  TrendingUp, Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import CountUp from "react-countup";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Stats {
  total_events:         number;
  total_images:         number;
  total_process_runs:   number;
  average_progress:     number;
  plan_type:            string;
  max_events:           number;
  max_images_per_event: number;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, accent = false,
}: {
  icon: any; label: string; value: any; accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      className={`rounded-2xl p-5 border flex flex-col gap-3 transition-colors ${
        accent
          ? "bg-blue-600/10 border-blue-500/20 hover:border-blue-500/35"
          : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
      }`}
    >
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
        accent
          ? "bg-blue-500/15 border-blue-500/25 text-blue-400"
          : "bg-zinc-800 border-zinc-700 text-zinc-500"
      }`}>
        <Icon size={14} />
      </div>
      <div>
        <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
        <p className={`text-xl font-bold tracking-tight capitalize ${accent ? "text-blue-300" : "text-zinc-100"}`}>
          {value}
        </p>
      </div>
    </motion.div>
  );
}

// ─── Usage Card ───────────────────────────────────────────────────────────────
function UsageCard({
  title, percentage, subtitle, icon: Icon,
}: {
  title: string; percentage: number; subtitle: string; icon: any;
}) {
  const [hovered, setHovered] = useState(false);
  const safe      = Math.min(percentage, 100);
  const isWarning = safe >= 80;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-5 space-y-4 transition-colors"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500">
            <Icon size={13} />
          </div>
          <span className="text-xs font-medium text-zinc-300">{title}</span>
          {isWarning && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle size={9} />
              Near limit
            </span>
          )}
        </div>
        <span className={`text-sm font-bold tabular-nums ${
          isWarning ? "text-amber-400" : "text-zinc-200"
        }`}>
          <CountUp end={safe} duration={1.2} decimals={safe % 1 !== 0 ? 1 : 0} />%
        </span>
      </div>

      {/* Bar */}
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${safe}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-full rounded-full ${
            isWarning
              ? "bg-gradient-to-r from-amber-500 to-red-500"
              : "bg-blue-500"
          }`}
        />
      </div>

      <p className="text-[11px] text-zinc-600">{subtitle}</p>

      {/* Tooltip */}
      {hovered && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-14 right-4 bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px] px-3 py-2 rounded-lg shadow-xl z-10 max-w-[200px] leading-relaxed"
        >
          Usage = (current / limit) × 100
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.replace("/login"); return; }

    API.get("/events/dashboard/stats")
      .then(res  => setStats(res.data))
      .catch(()  => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  // ─── Loading skeleton ──────────────────────────────────────────────────────
  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-48 bg-zinc-800 rounded-lg animate-pulse" />
            <div className="h-3 w-32 bg-zinc-800 rounded animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-24 bg-zinc-800 rounded-lg animate-pulse" />
            <div className="h-8 w-24 bg-zinc-800 rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-28 animate-pulse" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const eventUsagePercent = Math.min((stats.total_events / stats.max_events) * 100, 100);
  const imageUsagePercent = Math.min((stats.total_images / stats.max_images_per_event) * 100, 100);

  return (
    <div className="space-y-6">

      {/* ── HEADER ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">Dashboard</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Real-time usage &amp; AI performance</p>
        </div>

        <div className="flex gap-2">
          <Link
            href="/events/create"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            <PlusCircle size={12} />
            Create Event
          </Link>
          <Link
            href="/pricing"
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-zinc-200 transition-colors"
          >
            <Rocket size={12} />
            Upgrade
          </Link>
        </div>
      </div>

      {/* ── PLAN BANNER (if free) ── */}
      {stats.plan_type?.toLowerCase() === "free" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-4 bg-gradient-to-r from-blue-600/10 to-violet-600/10 border border-blue-500/20 rounded-2xl px-5 py-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-blue-400 flex-shrink-0">
              <Crown size={14} />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-200">You're on the Free plan</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Upgrade to unlock more events, images, and priority processing</p>
            </div>
          </div>
          <Link
            href="/pricing"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors flex-shrink-0"
          >
            <Zap size={11} />
            Upgrade
          </Link>
        </motion.div>
      )}

      {/* ── STATS GRID ── */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <StatCard
          icon={Sparkles}
          label="Plan"
          value={stats.plan_type || "Free"}
          accent
        />
        <StatCard
          icon={Folder}
          label="Events"
          value={`${stats.total_events} / ${stats.max_events}`}
        />
        <StatCard
          icon={ImageIcon}
          label="Images"
          value={stats.total_images.toLocaleString()}
        />
        <StatCard
          icon={Activity}
          label="Process Runs"
          value={stats.total_process_runs}
        />
      </div>

      {/* ── USAGE CARDS ── */}
      <div>
        <p className="text-[11px] font-medium text-zinc-600 uppercase tracking-widest mb-3">
          Usage &amp; Limits
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <UsageCard
            icon={Folder}
            title="Event Usage"
            percentage={eventUsagePercent}
            subtitle={`${stats.total_events} of ${stats.max_events} events used`}
          />
          <UsageCard
            icon={ImageIcon}
            title="Image Limit"
            percentage={imageUsagePercent}
            subtitle={`${stats.total_images.toLocaleString()} of ${stats.max_images_per_event.toLocaleString()} images`}
          />
          <UsageCard
            icon={TrendingUp}
            title="AI Processing"
            percentage={stats.average_progress}
            subtitle="Average completion rate across all events"
          />
        </div>
      </div>

    </div>
  );
}