"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import API from "@/services/api";
import {
  Sparkles, Folder, ImageIcon, Activity, Users, HardDrive,
  PlusCircle, Rocket, AlertTriangle, Crown, TrendingUp, Zap,
  Eye, Trash2, Settings, Share2, CheckCircle2, Loader2, X,
  AlertCircle, FolderOpen, Images, Clock, ChevronRight,
  RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  unprocessed_photos?:  number;
}

interface EventItem {
  id:                  number;
  name:                string;
  slug:                string;
  public_token:        string;
  processing_status:   "pending" | "processing" | "completed" | "failed";
  processing_progress: number;
  image_count:         number;
  total_faces:         number;
  total_clusters:      number;
  created_at:          string;
  cover_image_url:     string | null;
  public_status:       "active" | "disabled";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const statusConfig = (s: string) => {
  switch (s) {
    case "completed":  return { label: "Completed",  cls: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" };
    case "processing": return { label: "Processing", cls: "bg-amber-500/10 border-amber-500/25 text-amber-400" };
    case "failed":     return { label: "Failed",     cls: "bg-red-500/10 border-red-500/25 text-red-400" };
    default:           return { label: "Pending",    cls: "bg-zinc-500/10 border-zinc-500/25 text-zinc-400" };
  }
};

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, suffix, sublabel, countUp = false, accent = false,
}: {
  icon: any; label: string; value: any; suffix?: string;
  sublabel?: string; countUp?: boolean; accent?: boolean;
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
        <div className="flex items-baseline gap-1.5">
          <p className={`text-xl font-bold tracking-tight ${accent ? "text-blue-300" : "text-zinc-100"}`}>
            {countUp && typeof value === "number"
              ? <CountUp end={value} duration={1.4} separator="," />
              : value}
          </p>
          {suffix && <span className="text-xs text-zinc-600 font-medium">{suffix}</span>}
        </div>
        {sublabel && <p className="text-[11px] text-zinc-600 mt-0.5">{sublabel}</p>}
      </div>
    </motion.div>
  );
}

// ─── UsageCard ────────────────────────────────────────────────────────────────

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500">
            <Icon size={13} />
          </div>
          <span className="text-xs font-medium text-zinc-300">{title}</span>
          {isWarning && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle size={9} /> Near limit
            </span>
          )}
        </div>
        <span className={`text-sm font-bold tabular-nums ${isWarning ? "text-amber-400" : "text-zinc-200"}`}>
          <CountUp end={safe} duration={1.2} decimals={safe % 1 !== 0 ? 1 : 0} />%
        </span>
      </div>

      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${safe}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={`h-full rounded-full ${isWarning ? "bg-gradient-to-r from-amber-500 to-red-500" : "bg-blue-500"}`}
        />
      </div>

      <p className="text-[11px] text-zinc-600">{subtitle}</p>

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

// ─── Table Skeleton Row ───────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-t border-zinc-800/60">
      {[180, 90, 60, 55, 90, 110].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="animate-pulse bg-zinc-800 rounded"
            style={{ height: i === 1 ? 20 : 13, width: w, borderRadius: i === 1 ? 99 : 4 }}
          />
        </td>
      ))}
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();

  const [stats,         setStats]         = useState<Stats | null>(null);
  const [events,        setEvents]        = useState<EventItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [copiedToken,   setCopiedToken]   = useState<string | null>(null);
  const [error,         setError]         = useState<string | null>(null);

  // ── Auth check + fetch stats ──
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.replace("/login"); return; }

    API.get("/events/dashboard/stats")
      .then(res  => setStats(res.data))
      .catch(()  => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  // ── Fetch events list ──
  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setError(null);
    try {
      const res = await API.get("/events/my");
      setEvents(res.data?.events || res.data || []);
    } catch {
      setError("Failed to load events");
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // ── Delete event ──
  const handleDelete = useCallback(async (id: number) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await API.delete(`/events/${id}`);
      setEvents(prev => prev.filter(e => e.id !== id));
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  }, [deleting]);

  // ── Share: copy Public Page link ──
  const handleShare = useCallback((event: EventItem) => {
    const url = `${window.location.origin}/public/${event.public_token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedToken(event.public_token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  }, []);

  // ── Derived values ──
  const totalFaces = useMemo(
    () => events.reduce((s, e) => s + (e.total_faces || 0), 0),
    [events]
  );
  const estimatedStorage = useMemo(
    () => formatBytes((stats?.total_images || 0) * 2 * 1024 * 1024),
    [stats?.total_images]
  );
  const eventUsagePct = stats ? Math.min((stats.total_events / stats.max_events) * 100, 100)           : 0;
  const imageUsagePct = stats ? Math.min((stats.total_images / stats.max_images_per_event) * 100, 100) : 0;

  // ─── Full-page loading skeleton ───────────────────────────────────────────
  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-48 bg-zinc-800 rounded-lg animate-pulse" />
            <div className="h-3 w-32 bg-zinc-800 rounded animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-28 bg-zinc-800 rounded-lg animate-pulse" />
            <div className="h-8 w-24 bg-zinc-800 rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-28 animate-pulse" />
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 h-28 animate-pulse" />
          ))}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl h-64 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-50">Dashboard</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Real-time usage &amp; AI performance</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchEvents}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw size={12} className={eventsLoading ? "animate-spin" : ""} />
            Refresh
          </button>
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

      {/* ── PLAN BANNER (free only) ─────────────────────────────────────────── */}
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
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Upgrade to unlock more events, images, and priority processing
              </p>
            </div>
          </div>
          <Link
            href="/pricing"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors flex-shrink-0"
          >
            <Zap size={11} /> Upgrade
          </Link>
        </motion.div>
      )}

      {/* Unprocessed photos alert */}
      {stats.unprocessed_photos != null && stats.unprocessed_photos > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3"
        >
          <Clock size={14} className="text-amber-400 flex-shrink-0" />
          <p className="text-xs font-medium text-amber-400">
            {stats.unprocessed_photos} photo{stats.unprocessed_photos !== 1 ? "s" : ""} pending processing
          </p>
        </motion.div>
      )}

      {/* ── STATS GRID — 6 cards ────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-medium text-zinc-600 uppercase tracking-widest mb-3">Overview</p>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <StatCard
            icon={Sparkles}
            label="Plan"
            value={stats.plan_type || "Free"}
            accent
          />
          <StatCard
            icon={Folder}
            label="Total Events"
            value={stats.total_events}
            suffix={`/ ${stats.max_events}`}
            countUp
          />
          <StatCard
            icon={ImageIcon}
            label="Total Images"
            value={stats.total_images}
            countUp
          />
          <StatCard
            icon={Users}
            label="Face Matches"
            value={totalFaces}
            sublabel="Detected across events"
            countUp
          />
          <StatCard
            icon={HardDrive}
            label="Storage Used"
            value={estimatedStorage}
            sublabel="Approximate"
          />
          <StatCard
            icon={Activity}
            label="Process Runs"
            value={stats.total_process_runs}
            countUp
          />
        </div>
      </div>

      {/* ── USAGE & LIMITS ──────────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-medium text-zinc-600 uppercase tracking-widest mb-3">
          Usage &amp; Limits
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <UsageCard
            icon={Folder}
            title="Event Usage"
            percentage={eventUsagePct}
            subtitle={`${stats.total_events} of ${stats.max_events} events used`}
          />
          <UsageCard
            icon={ImageIcon}
            title="Image Limit"
            percentage={imageUsagePct}
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

      {/* ── EVENTS TABLE ────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium text-zinc-600 uppercase tracking-widest">Your Events</p>
          <Link
            href="/events"
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            View all <ChevronRight size={12} />
          </Link>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <FolderOpen size={14} className="text-blue-400" />
              <span className="text-xs font-semibold text-zinc-300">Events</span>
              {!eventsLoading && events.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {events.length}
                </span>
              )}
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-red-500/5 border-b border-red-500/15">
              <div className="flex items-center gap-2">
                <AlertCircle size={13} className="text-red-400" />
                <span className="text-xs text-red-400">{error}</span>
              </div>
              <button
                onClick={fetchEvents}
                className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!eventsLoading && events.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-4">
                <Folder size={20} className="text-zinc-600" />
              </div>
              <p className="text-sm font-semibold text-zinc-300 mb-1">No events yet</p>
              <p className="text-xs text-zinc-600 mb-5">Create your first event to start matching faces</p>
              <Link
                href="/events/create"
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                <PlusCircle size={12} /> Create Event
              </Link>
            </div>
          )}

          {/* Table */}
          {(eventsLoading || events.length > 0) && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-zinc-800/40">
                    {["Event", "Status", "Photos", "Faces", "Created", "Actions"].map((h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 ${
                          i === 5 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eventsLoading ? (
                    <><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
                  ) : (
                    <AnimatePresence>
                      {events.map((event, idx) => {
                        const st         = statusConfig(event.processing_status);
                        const galleryUrl = `/public/${event.public_token}`;

                        return (
                          <motion.tr
                            key={event.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{ delay: idx * 0.025 }}
                            className="border-t border-zinc-800/60 hover:bg-zinc-800/30 transition-colors"
                          >
                            {/* Event name + thumbnail */}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {event.cover_image_url ? (
                                  <img
                                    src={event.cover_image_url}
                                    alt={event.name}
                                    className="w-10 h-7 object-cover rounded-md border border-zinc-700 flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-10 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0">
                                    <ImageIcon size={11} className="text-zinc-600" />
                                  </div>
                                )}
                                <span className="text-sm font-medium text-zinc-200 truncate max-w-[160px]">
                                  {event.name}
                                </span>
                              </div>
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${st.cls}`}>
                                {event.processing_status === "processing" && (
                                  <Loader2 size={10} className="animate-spin" />
                                )}
                                {event.processing_status === "completed" && <CheckCircle2 size={10} />}
                                {event.processing_status === "failed"    && <AlertCircle  size={10} />}
                                {st.label}
                              </span>
                            </td>

                            {/* Photos */}
                            <td className="px-4 py-3">
                              <span className="text-sm text-zinc-400 tabular-nums">
                                {(event.image_count ?? 0).toLocaleString()}
                              </span>
                            </td>

                            {/* Faces */}
                            <td className="px-4 py-3">
                              <span className="text-sm text-zinc-400 tabular-nums">
                                {(event.total_faces ?? 0).toLocaleString()}
                              </span>
                            </td>

                            {/* Created */}
                            <td className="px-4 py-3">
                              <span className="text-xs text-zinc-600 whitespace-nowrap">
                                {formatDate(event.created_at)}
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">

                                {/* View event */}
                                <motion.button
                                  whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                                  onClick={() => router.push(`/events/${event.id}`)}
                                  title="View event"
                                  className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
                                >
                                  <Eye size={12} />
                                </motion.button>

                                {/* View Public Page — event-wise link */}
                                <Link href={galleryUrl} target="_blank">
                                  <motion.div
                                    whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                                    title={`View Public Page: ${event.name}`}
                                    className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/25 hover:bg-blue-500/20 flex items-center justify-center text-blue-400 transition-colors cursor-pointer"
                                  >
                                    <Images size={12} />
                                  </motion.div>
                                </Link>

                                {/* Share — copy public Public Page URL */}
                                <motion.button
                                  whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                                  onClick={() => handleShare(event)}
                                  title="Copy Public Page link"
                                  className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                                    copiedToken === event.public_token
                                      ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                                      : "bg-zinc-800 border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 text-zinc-400 hover:text-zinc-200"
                                  }`}
                                >
                                  {copiedToken === event.public_token
                                    ? <CheckCircle2 size={12} />
                                    : <Share2 size={12} />}
                                </motion.button>

                                {/* Settings */}
                                <motion.button
                                  whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                                  onClick={() => router.push(`/events/${event.id}/settings`)}
                                  title="Event settings"
                                  className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
                                >
                                  <Settings size={12} />
                                </motion.button>

                                {/* Delete (with confirm) */}
                                {deleteConfirm === event.id ? (
                                  <div className="flex items-center gap-1">
                                    <motion.button
                                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                                      onClick={() => handleDelete(event.id)}
                                      disabled={deleting}
                                      title="Confirm delete"
                                      className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/25 hover:bg-red-500/20 flex items-center justify-center text-red-400 transition-colors"
                                    >
                                      {deleting
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <CheckCircle2 size={12} />}
                                    </motion.button>
                                    <motion.button
                                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                                      onClick={() => setDeleteConfirm(null)}
                                      title="Cancel"
                                      className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 transition-colors"
                                    >
                                      <X size={12} />
                                    </motion.button>
                                  </div>
                                ) : (
                                  <motion.button
                                    whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}
                                    onClick={() => setDeleteConfirm(event.id)}
                                    title="Delete event"
                                    className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-red-500/10 hover:border-red-500/25 flex items-center justify-center text-zinc-600 hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 size={12} />
                                  </motion.button>
                                )}

                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── PHOTOS PER EVENT bar chart ──────────────────────────────────────── */}
      {!eventsLoading && events.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-zinc-600 uppercase tracking-widest mb-3">Photos per Event</p>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3.5">
            {events.slice(0, 8).map((event, idx) => {
              const count    = event.image_count ?? 0;
              const maxCount = Math.max(...events.map(e => e.image_count ?? 0), 1);
              const pct      = (count / maxCount) * 100;
              const colors   = [
                "bg-blue-500","bg-violet-500","bg-emerald-500","bg-pink-500",
                "bg-amber-500","bg-cyan-500","bg-rose-500","bg-indigo-500",
              ];
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.04 }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-zinc-400 truncate max-w-[220px]">{event.name}</span>
                    <span className="text-xs font-semibold text-zinc-300 tabular-nums ml-4">
                      {count.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, delay: idx * 0.04, ease: "easeOut" }}
                      className={`h-full rounded-full ${colors[idx % colors.length]}`}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}