"use client";

/**
 * app/(dashboard)/events/[id]/page.tsx
 *
 * Event detail page — AI-enriched with:
 *   • Scene filter pills (normalised, grouped, max 12, deduplicated)
 *   • Cluster pagination (24/page) — no cluster flooding
 *   • Working Reset Filters button
 *   • AI enrichment badge on clusters (scene + objects)
 *   • Tabs: Overview · Clusters · Face Search · Guest Uploads
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import API from "@/services/api";
import {
  BarChart2, Users, Layers, Calendar, Globe, Copy, ExternalLink,
  RefreshCw, Loader2, CheckCircle2, ChevronLeft, ChevronRight,
  Search, Upload, X, Sparkles, RotateCcw, Image as ImageIcon,
  Camera, AlertTriangle, Clock, Download, ZoomIn,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventDetail {
  id: number; name: string; slug: string;
  public_token: string; processing_status: string;
  processing_progress: number; expires_at: string;
  image_count: number; total_faces: number; total_clusters: number;
  description: string; cover_image: string | null;
  public_status: string; plan_type: string;
  photo_status: Record<string, number>;
  unprocessed_count: number; has_new_photos: boolean;
  pending_guest_uploads: number;
}

interface SceneChip {
  raw_label: string;
  display_name: string;
  emoji: string;
  count: number;
}

interface ClusterItem {
  cluster_id: number; image_count: number;
  preview_image: string; images: string[];
  scene_label: string | null;
  scene_display: string;
  scene_emoji: string;
  objects: string[];
}

interface ClustersResponse {
  total_clusters: number; total_images: number;
  clusters: ClusterItem[];
  page: number; page_size: number;
  total_pages: number; has_more: boolean;
}

interface SearchMatch {
  image_name: string;
  similarity: number;
  scene_label?: string | null;
  scene_display?: string | null;
  scene_emoji?: string | null;
  objects?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

function imageUrl(eventToken: string, imageName: string) {
  return `${API_BASE}/public/events/${eventToken}/image/${imageName}`;
}
function thumbnailUrl(eventToken: string, imageName: string) {
  return `${API_BASE}/public/events/${eventToken}/thumbnail/${imageName}`;
}

const STATUS_COLOR: Record<string, string> = {
  completed:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  processing: "bg-blue-500/15   text-blue-400   border-blue-500/20",
  failed:     "bg-red-500/15    text-red-400    border-red-500/20",
  pending:    "bg-zinc-700/40   text-zinc-400   border-zinc-700/40",
  queued:     "bg-amber-500/15  text-amber-400  border-amber-500/20",
};

// ─── Scene Filter Bar ─────────────────────────────────────────────────────────

function SceneFilterBar({
  scenes, activeScene, onSelect, onReset,
}: {
  scenes: SceneChip[];
  activeScene: string | null;
  onSelect: (raw: string | null) => void;
  onReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const INITIAL = 8;
  const visible  = expanded ? scenes : scenes.slice(0, INITIAL);
  const hasMore  = scenes.length > INITIAL;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* All / reset */}
      <button
        onClick={onReset}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
          !activeScene
            ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/20"
            : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600 hover:text-zinc-300"
        }`}
      >
        All
      </button>

      {visible.map(sc => (
        <button
          key={sc.raw_label}
          onClick={() => onSelect(activeScene === sc.raw_label ? null : sc.raw_label)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            activeScene === sc.raw_label
              ? "bg-blue-600 text-white border-blue-500 shadow-sm shadow-blue-500/20"
              : "bg-zinc-800/60 text-zinc-300 border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800"
          }`}
        >
          <span className="text-sm leading-none">{sc.emoji}</span>
          <span>{sc.display_name}</span>
          <span className={`text-[10px] font-normal ${activeScene === sc.raw_label ? "opacity-80" : "opacity-50"}`}>
            {sc.count}
          </span>
        </button>
      ))}

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-500 border border-zinc-700 hover:border-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {expanded ? "Show less ↑" : `+${scenes.length - INITIAL} more`}
        </button>
      )}
    </div>
  );
}

// ─── Cluster Card ─────────────────────────────────────────────────────────────

function ClusterCard({ cluster, publicToken, onClick }: {
  cluster: ClusterItem; publicToken: string; onClick: () => void;
}) {
  const hasScene = cluster.scene_display && cluster.scene_display !== "Unknown" && cluster.scene_display !== "";

  return (
    <div
      onClick={onClick}
      className="group bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:shadow-black/30 hover:-translate-y-0.5"
    >
      <div className="relative aspect-square bg-zinc-800 overflow-hidden">
        <img
          src={thumbnailUrl(publicToken, cluster.preview_image)}
          alt=""
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

        {/* Image count */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
          <ImageIcon size={9} />
          {cluster.image_count}
        </div>

        {/* AI enrichment hover indicator */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg p-1.5">
            <ZoomIn size={12} className="text-white" />
          </div>
        </div>
      </div>

      <div className="p-2.5 space-y-1.5">
        <p className="text-[11px] font-medium text-zinc-400">
          Person #{cluster.cluster_id + 1}
        </p>

        {/* Scene badge from AI */}
        {hasScene && (
          <div className="flex items-center gap-1 text-[10px] text-zinc-500">
            <Sparkles size={8} className="text-blue-500 flex-shrink-0" />
            <span className="leading-none">{cluster.scene_emoji}</span>
            <span className="truncate">{cluster.scene_display}</span>
          </div>
        )}

        {/* Object tags */}
        {cluster.objects.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {cluster.objects.slice(0, 3).map(obj => (
              <span
                key={obj}
                className="text-[9px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded border border-zinc-700/60"
              >
                {obj}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cluster Detail Modal ─────────────────────────────────────────────────────

function ClusterModal({ cluster, publicToken, onClose }: {
  cluster: ClusterItem; publicToken: string; onClose: () => void;
}) {
  const hasScene = cluster.scene_display && cluster.scene_display !== "Unknown" && cluster.scene_display !== "";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-zinc-800 sticky top-0 bg-zinc-900/95 backdrop-blur-sm">
          <div>
            <h3 className="text-base font-semibold text-zinc-100">
              Person #{cluster.cluster_id + 1}
            </h3>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {hasScene && (
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Sparkles size={10} className="text-blue-400" />
                  {cluster.scene_emoji} {cluster.scene_display}
                </span>
              )}
              {cluster.objects.length > 0 && (
                <span className="text-xs text-zinc-600">
                  {cluster.objects.slice(0, 5).join(" · ")}
                </span>
              )}
              <span className="text-xs text-zinc-600">
                {cluster.image_count} photo{cluster.image_count !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0 ml-4">
            <X size={16} />
          </button>
        </div>

        {/* Photo grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-4">
          {cluster.images.map(img => (
            <a
              key={img}
              href={imageUrl(publicToken, img)}
              target="_blank"
              rel="noopener noreferrer"
              className="group aspect-square rounded-lg overflow-hidden bg-zinc-800 hover:ring-2 hover:ring-blue-500/50 transition-all"
            >
              <img
                src={thumbnailUrl(publicToken, img)}
                alt=""
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "overview" | "clusters" | "facesearch" | "guestuploads";

export default function EventDetailPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();
  const eventId = Number(id);

  const [event,          setEvent]          = useState<EventDetail | null>(null);
  const [tab,            setTab]            = useState<Tab>("overview");
  const [loading,        setLoading]        = useState(true);
  const [processing,     setProcessing]     = useState(false);

  // Clusters
  const [scenes,          setScenes]          = useState<SceneChip[]>([]);
  const [clusters,        setClusters]        = useState<ClustersResponse | null>(null);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [activeScene,     setActiveScene]     = useState<string | null>(null);
  const [page,            setPage]            = useState(1);
  const [selectedCluster, setSelectedCluster] = useState<ClusterItem | null>(null);

  // Face search
  const [searchFile,    setSearchFile]    = useState<File | null>(null);
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searching,     setSearching]     = useState(false);

  // ── Load event ──────────────────────────────────────────────────────────────
  const loadEvent = useCallback(async () => {
    try {
      const res = await API.get(`/events/${eventId}`);
      setEvent(res.data);
    } catch {
      router.replace("/events");
    } finally {
      setLoading(false);
    }
  }, [eventId, router]);

  useEffect(() => { loadEvent(); }, [loadEvent]);

  // Auto-poll while processing
  useEffect(() => {
    if (event?.processing_status !== "processing") return;
    const t = setInterval(loadEvent, 3000);
    return () => clearInterval(t);
  }, [event?.processing_status, loadEvent]);

  // ── Load scenes (once when clusters tab opens) ────────────────────────────
  const loadScenes = useCallback(async () => {
    try {
      const res = await API.get(`/events/${eventId}/scenes`);
      setScenes(res.data.scenes ?? []);
    } catch {}
  }, [eventId]);

  // ── Load clusters (paginated + scene-filtered) ───────────────────────────
  const loadClusters = useCallback(async () => {
    setClustersLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: 24 };
      if (activeScene) params.scene = activeScene;
      const res = await API.get(`/events/${eventId}/clusters`, { params });
      setClusters(res.data);
    } catch {}
    finally { setClustersLoading(false); }
  }, [eventId, page, activeScene]);

  useEffect(() => {
    if (tab === "clusters") {
      loadScenes();
      loadClusters();
    }
  }, [tab, loadScenes, loadClusters]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [activeScene]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const handleProcess = async () => {
    if (!event) return;
    setProcessing(true);
    try {
      await API.post(`/events/${event.id}/process`);
      loadEvent();
    } catch {}
    finally { setProcessing(false); }
  };

  const handleTogglePublic = async () => {
    if (!event) return;
    try {
      await API.post(`/events/${event.id}/toggle-public`);
      loadEvent();
    } catch {}
  };

  const handleCopyLink = () => {
    if (!event) return;
    navigator.clipboard.writeText(`${window.location.origin}/public/${event.public_token}`);
  };

  const handleFaceSearch = async () => {
    if (!searchFile || !event) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const fd = new FormData();
      fd.append("file", searchFile);
      const res = await API.post(`/events/${event.id}/search`, fd);
      setSearchResults(res.data.matches ?? []);
    } catch {}
    finally { setSearching(false); }
  };

  const resetFilters = () => {
    setActiveScene(null);
    setPage(1);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (loading || !event) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-zinc-600" size={24} />
      </div>
    );
  }

  const publicUrl   = `${typeof window !== "undefined" ? window.location.origin : ""}/public/${event.public_token}`;
  const isCompleted = event.processing_status === "completed";
  const isProcessing = event.processing_status === "processing";

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: "overview",     label: "Overview",      icon: BarChart2 },
    { key: "clusters",     label: "Clusters",      icon: Layers    },
    { key: "facesearch",   label: "Face Search",   icon: Search    },
    { key: "guestuploads", label: "Guest Uploads", icon: Upload    },
  ];

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Event Header ── */}
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 rounded-xl bg-zinc-800 overflow-hidden flex-shrink-0 border border-zinc-700">
          {event.cover_image ? (
            <img src={`${API_BASE}/storage/covers/${event.cover_image}`} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Camera size={24} className="text-zinc-600" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-zinc-100 truncate">{event.name}</h1>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${STATUS_COLOR[event.processing_status] ?? STATUS_COLOR.pending}`}>
              {isProcessing ? `Processing ${event.processing_progress ?? 0}%` : event.processing_status}
            </span>
          </div>

          {event.description && (
            <p className="text-xs text-zinc-500 mt-1">{event.description}</p>
          )}

          <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-zinc-500">
            <span className="flex items-center gap-1"><ImageIcon size={11} />{event.image_count} photos</span>
            <span className="flex items-center gap-1"><Users size={11} />{event.total_faces ?? 0} faces</span>
            <span className="flex items-center gap-1"><Layers size={11} />{event.total_clusters ?? 0} people</span>
            <span className="flex items-center gap-1"><Calendar size={11} />
              Expires {event.expires_at ? new Date(event.expires_at).toLocaleDateString() : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Action Bar ── */}
      <div className="flex flex-wrap gap-2">
        {(event.has_new_photos || !isCompleted) && (
          <button
            onClick={handleProcess}
            disabled={processing || isProcessing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-60"
          >
            {processing || isProcessing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {isProcessing ? "Processing…" : "Process Photos"}
          </button>
        )}

        <button
          onClick={handleTogglePublic}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium border transition-colors ${
            event.public_status === "active"
              ? "bg-emerald-600/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-600/25"
              : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-600"
          }`}
        >
          <Globe size={13} />
          {event.public_status === "active" ? "Public" : "Private"}
        </button>

        <button
          onClick={handleCopyLink}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600 text-xs transition-colors"
        >
          <Copy size={13} />
          Copy Link
        </button>

        {event.public_status === "active" && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600 text-xs transition-colors"
          >
            <ExternalLink size={13} />
            Open Public Page
          </a>
        )}
      </div>

      {/* ── Pending guest alert ── */}
      {event.pending_guest_uploads > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
          <AlertTriangle size={13} className="flex-shrink-0" />
          {event.pending_guest_uploads} guest photo{event.pending_guest_uploads > 1 ? "s" : ""} awaiting your approval
          <Link href={`/events/${eventId}/approvals`} className="ml-auto underline underline-offset-2 hover:text-amber-200">
            Review
          </Link>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="border-b border-zinc-800">
        <div className="flex gap-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === key
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon size={13} />
              {label}
              {key === "clusters" && event.total_clusters > 0 && (
                <span className={`text-[10px] px-1.5 rounded-full ${tab === key ? "bg-blue-500/20 text-blue-300" : "bg-zinc-800 text-zinc-500"}`}>
                  {event.total_clusters}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════ OVERVIEW TAB ══════════════ */}
      {tab === "overview" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Photos",   value: event.image_count,    icon: ImageIcon },
            { label: "Faces",    value: event.total_faces ?? 0,    icon: Users     },
            { label: "People",   value: event.total_clusters ?? 0, icon: Layers    },
            { label: "Progress", value: `${event.processing_progress ?? 0}%`, icon: BarChart2 },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center">
                <Icon size={13} className="text-zinc-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-zinc-100">{value}</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">{label}</p>
              </div>
            </div>
          ))}

          {/* AI Enrichment Status */}
          {isCompleted && (
            <div className="col-span-2 md:col-span-4 bg-gradient-to-r from-blue-950/40 to-indigo-950/40 border border-blue-800/30 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={14} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200">AI Scene Analysis</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Photos are enriched with scene labels and object detection. Use the Clusters tab to explore by scene.
                  </p>
                </div>
                <button
                  onClick={() => setTab("clusters")}
                  className="ml-auto flex-shrink-0 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-medium transition-colors border border-blue-600/20"
                >
                  View Clusters
                </button>
              </div>
            </div>
          )}

          {/* Upload section */}
          <div className="col-span-2 md:col-span-4 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-zinc-200 mb-1">Upload Photos</h3>
            <p className="text-xs text-zinc-600">Add more photos · {event.image_count} uploaded so far</p>
            {event.has_new_photos && (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={11} />
                Processing required after upload to enable face search
              </p>
            )}
            <div className="mt-3">
              <Link
                href={`/events/${eventId}/upload`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
              >
                <Upload size={13} />
                Upload Photos
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ CLUSTERS TAB ══════════════ */}
      {tab === "clusters" && (
        <div className="space-y-4">

          {/* AI Scene Filter Bar */}
          {scenes.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-blue-400" />
                  <span className="text-xs font-semibold text-zinc-300">AI Scene Filter</span>
                  <span className="text-[10px] text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-700">
                    {scenes.length} scene{scenes.length !== 1 ? "s" : ""} detected
                  </span>
                </div>
                {activeScene && (
                  <button
                    onClick={resetFilters}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    <RotateCcw size={11} />
                    Reset
                  </button>
                )}
              </div>

              <SceneFilterBar
                scenes={scenes}
                activeScene={activeScene}
                onSelect={(raw) => { setActiveScene(raw); setPage(1); }}
                onReset={resetFilters}
              />
            </div>
          )}

          {/* Stats bar */}
          {clusters && (
            <div className="flex items-center justify-between text-xs text-zinc-600">
              <span>
                {activeScene
                  ? `${clusters.total_clusters} people in this scene`
                  : `${clusters.total_clusters} unique people · ${clusters.total_images} photos total`}
              </span>
              {clusters.total_pages > 1 && (
                <span>Page {clusters.page} of {clusters.total_pages}</span>
              )}
            </div>
          )}

          {/* Cluster grid */}
          {clustersLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-center">
                <Loader2 className="animate-spin text-zinc-600 mx-auto mb-2" size={20} />
                <p className="text-xs text-zinc-600">Loading clusters…</p>
              </div>
            </div>
          ) : clusters?.clusters.length === 0 ? (
            <div className="text-center py-16 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <Layers size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">
                {activeScene ? "No clusters match this scene" : "No clusters yet"}
              </p>
              <p className="text-xs">
                {activeScene
                  ? "Try a different scene or clear the filter"
                  : "Process your photos to generate face clusters"}
              </p>
              {activeScene && (
                <button
                  onClick={resetFilters}
                  className="mt-3 flex items-center gap-1.5 mx-auto text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <RotateCcw size={11} />
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {clusters?.clusters.map(cluster => (
                <ClusterCard
                  key={cluster.cluster_id}
                  cluster={cluster}
                  publicToken={event.public_token}
                  onClick={() => setSelectedCluster(cluster)}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {clusters && clusters.total_pages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs disabled:opacity-40 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                <ChevronLeft size={13} /> Prev
              </button>

              <span className="text-xs text-zinc-500 tabular-nums">
                {page} / {clusters.total_pages}
              </span>

              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!clusters.has_more}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs disabled:opacity-40 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                Next <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ FACE SEARCH TAB ══════════════ */}
      {tab === "facesearch" && (
        <div className="space-y-5 max-w-lg">
          {!isCompleted && (
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300">
              <Clock size={13} />
              Face search is available after processing completes
            </div>
          )}

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
                <Search size={14} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">Search by Face</h3>
                <p className="text-xs text-zinc-600">Upload a portrait to find all matching photos</p>
              </div>
            </div>

            <label className="block border-2 border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl p-6 text-center cursor-pointer transition-colors group">
              <Camera size={24} className="mx-auto mb-2 text-zinc-600 group-hover:text-zinc-500 transition-colors" />
              <p className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">
                {searchFile ? (
                  <span className="text-blue-400 font-medium">{searchFile.name}</span>
                ) : "Click to upload portrait photo"}
              </p>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => setSearchFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <button
              onClick={handleFaceSearch}
              disabled={!searchFile || !isCompleted || searching}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              {searching ? "Searching…" : "Search Photos"}
            </button>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-400">
                  {searchResults.length} match{searchResults.length !== 1 ? "es" : ""} found
                </p>
                <button
                  onClick={() => setSearchResults([])}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {searchResults.map(m => (
                  <div key={m.image_name} className="relative group">
                    <div className="aspect-square bg-zinc-800 rounded-lg overflow-hidden">
                      <img
                        src={thumbnailUrl(event.public_token, m.image_name)}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    </div>
                    {/* Similarity badge */}
                    {m.similarity && (
                      <div className="absolute top-1.5 right-1.5 text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded-full font-semibold">
                        {Math.round(m.similarity * 100)}%
                      </div>
                    )}
                    {/* Scene badge */}
                    {m.scene_display && (
                      <div className="absolute bottom-1.5 left-1.5 text-[9px] bg-black/70 text-white px-1.5 py-0.5 rounded flex items-center gap-0.5 backdrop-blur-sm">
                        {m.scene_emoji} {m.scene_display}
                      </div>
                    )}
                    {/* Download link */}
                    <a
                      href={imageUrl(event.public_token, m.image_name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 bg-black/40 flex items-center justify-center rounded-lg transition-opacity"
                    >
                      <ZoomIn size={16} className="text-white" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ GUEST UPLOADS TAB ══════════════ */}
      {tab === "guestuploads" && (
        <div className="space-y-4 max-w-lg">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-zinc-200 mb-1">Guest Uploads</h3>
            <p className="text-xs text-zinc-600 mb-4">
              Let guests contribute photos to this event gallery.
            </p>

            {event.pending_guest_uploads > 0 && (
              <Link
                href={`/events/${eventId}/approvals`}
                className="flex items-center justify-between px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300 hover:bg-amber-500/15 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle size={13} />
                  {event.pending_guest_uploads} photo{event.pending_guest_uploads > 1 ? "s" : ""} awaiting approval
                </span>
                <ChevronRight size={13} />
              </Link>
            )}

            {event.pending_guest_uploads === 0 && (
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <CheckCircle2 size={13} className="text-emerald-500" />
                No pending guest uploads
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cluster Detail Modal ── */}
      {selectedCluster && (
        <ClusterModal
          cluster={selectedCluster}
          publicToken={event.public_token}
          onClose={() => setSelectedCluster(null)}
        />
      )}
    </div>
  );
}
