"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Camera, Download, X, Scan, ChevronLeft, ChevronRight,
  ImageIcon, Users, Grid3X3, Search, Play, Trash2,
  ToggleLeft, ToggleRight, Copy, Check, AlertCircle, Clock,
  BarChart2, Layers, ArrowLeft, ExternalLink, ZoomIn,
  ChevronDown, Loader2, Lock, AlertTriangle,
  CloudUpload, CheckCircle2, XCircle, ThumbsUp, ThumbsDown,
  RefreshCw, ImagePlus, Eye,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventDetail {
  id: number;
  name: string;
  slug: string;
  public_token: string;
  processing_status: "pending" | "processing" | "completed" | "failed";
  processing_progress: number;
  expires_at: string | null;
  image_count: number;
  total_faces: number;
  total_clusters: number;
  description: string | null;
  cover_image: string | null;
  public_status: "active" | "disabled";
  plan_type: string;
}

interface ClusterItem {
  cluster_id: number;
  image_count: number;
  preview_image: string;
  images: string[];
  scene_label?: string;   // ← ADD
}

interface ClustersData {
  event_id: number;
  total_clusters: number;
  total_images: number;
  clusters: ClusterItem[];
}

interface SearchMatch {
  image_name: string;
  cluster_id: number;
  similarity: number;
  scene_label?: string;   // ← ADD
  objects?: string[];     // ← ADD
}

interface SearchResult {
  total_matches: number;
  matches: SearchMatch[];
}

interface GuestUpload {
  id: number;
  filename: string;
  original_filename: string;
  contributor_name: string | null;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  uploaded_at: string;
  thumbnail_url?: string;
}

interface GuestUploadsData {
  pending: GuestUpload[];
  approved: GuestUpload[];
  rejected: GuestUpload[];
  total_pending: number;
}

type ViewMode = "overview" | "clusters" | "search" | "guest_uploads";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

const statusStyle: Record<string, string> = {
  completed:  "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  processing: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  pending:    "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
  failed:     "text-red-400 bg-red-400/10 border-red-400/20",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function OwnerEventDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const eventId = params?.eventId as string;
  const API     = process.env.NEXT_PUBLIC_API_URL!;

  const authH = () => ({ Authorization: `Bearer ${localStorage.getItem("token") ?? ""}` });

  // ─── State ──────────────────────────────────────────────────────────────
  const [event,           setEvent]          = useState<EventDetail | null>(null);
  const [eventLoading,    setEventLoading]    = useState(true);
  const [view,            setView]            = useState<ViewMode>("overview");

  const [clusters,        setClusters]        = useState<ClustersData | null>(null);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [expanded,        setExpanded]        = useState<number | null>(null);

  const [searching,       setSearching]       = useState(false);
  const [searchResult,    setSearchResult]    = useState<SearchResult | null>(null);
  const [searchError,     setSearchError]     = useState<string | null>(null);
  const [dragOver,        setDragOver]        = useState(false);

  const [cameraOpen,      setCameraOpen]      = useState(false);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [previewImg,  setPreviewImg]  = useState<string | null>(null);
  const [previewIdx,  setPreviewIdx]  = useState(0);
  const [previewPool, setPreviewPool] = useState<string[]>([]);

  const [copied,      setCopied]      = useState(false);
  const [toast,       setToast]       = useState<string | null>(null);
  const [deleting,    setDeleting]    = useState(false);
  const [toggling,    setToggling]    = useState(false);
  const [reprocessing,setReprocessing]= useState(false);

  const [uploading,      setUploading]      = useState(false);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [uploadSuccess,  setUploadSuccess]  = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // ─── Guest Uploads state ─────────────────────────────────────────────────
  const [guestUploads,        setGuestUploads]        = useState<GuestUploadsData | null>(null);
  const [guestUploadsLoading, setGuestUploadsLoading] = useState(false);
  const [guestFilter,         setGuestFilter]         = useState<"pending" | "approved" | "rejected">("pending");
  const [approvingId,         setApprovingId]         = useState<number | null>(null);
  const [rejectingId,         setRejectingId]         = useState<number | null>(null);
  const [bulkActioning,       setBulkActioning]       = useState(false);
  const [guestPreviewUrl,     setGuestPreviewUrl]     = useState<string | null>(null);

  // ─── Auto-reload event for progress ────────────────────────────────────
  useEffect(() => {
    if (event?.processing_status !== "processing") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/events/${eventId}`, { headers: authH() });
        if (res.ok) {
          const data = await res.json();
          setEvent(data);
          // Stop polling immediately when done
          if (data.processing_status !== "processing") {
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error("Failed to reload event progress", e);
      }
    }, 5000); // ← Changed from 2000 to 5000ms

    return () => clearInterval(interval);
  }, [event?.processing_status, eventId]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Image upload ─────────────────────────────────────────────────────────
  const handleImageUpload = async (files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f =>
      f.type.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(f.name)
    );
    if (!fileArr.length) { showToast("No valid image files selected"); return; }

    const plan     = event?.plan_type ?? "free";
    const maxImg   = plan === "enterprise" ? 100000 : plan === "pro" ? 10000 : 1000;
    const current  = event?.image_count ?? 0;

    if (current + fileArr.length > maxImg) {
      showToast(`Plan limit: max ${maxImg.toLocaleString()} images`);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      fileArr.forEach(f => form.append("files", f));

      const res = await fetch(`${API}/upload/${eventId}`, {
        method: "POST",
        headers: authH(),
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        showToast(err.detail ?? "Upload failed");
        return;
      }

      const data = await res.json();
      showToast(`✓ ${data.uploaded} photo${data.uploaded !== 1 ? "s" : ""} uploaded`);
      setUploadSuccess(true);
      await loadEvent();
    } catch {
      showToast("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (url: string, filename: string) => {
    try {
      const res = await fetch(url, { headers: authH() });
      if (!res.ok) { showToast("Download failed"); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      showToast("Download failed");
    }
  };

  // ─── Load event ──────────────────────────────────────────────────────
  const loadEvent = useCallback(async () => {
    try {
      const res = await fetch(`${API}/events/${eventId}`, { headers: authH() });
      if (!res.ok) throw new Error();
      setEvent(await res.json());
    } catch {
      showToast("Failed to load event");
    } finally {
      setEventLoading(false);
    }
  }, [eventId]);

  useEffect(() => { loadEvent(); }, [loadEvent]);

  // ─── Load clusters (lazy) ────────────────────────────────────────────────
  const loadClusters = useCallback(async () => {
    if (clusters) return;
    setClustersLoading(true);
    try {
      const res = await fetch(`${API}/events/${eventId}/clusters`, { headers: authH() });
      if (!res.ok) throw new Error();
      setClusters(await res.json());
    } catch {
      showToast("Failed to load clusters");
    } finally {
      setClustersLoading(false);
    }
  }, [eventId, clusters]);

  useEffect(() => { if (view === "clusters") loadClusters(); }, [view]);

  // ─── Toggle public ───────────────────────────────────────────────────────
  const togglePublic = async () => {
    if (!event || toggling) return;
    setToggling(true);
    try {
      const res = await fetch(`${API}/events/${event.id}/toggle-public`, {
        method: "POST", headers: authH(),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEvent(p => p ? { ...p, public_status: data.public_status } : p);
      showToast(data.public_status === "active" ? "Event is now public" : "Event is now private");
    } catch {
      showToast("Failed to toggle visibility");
    } finally {
      setToggling(false);
    }
  };

  // ─── Copy public link ────────────────────────────────────────────────────
  const copyLink = () => {
    if (!event) return;
    // FIXED: Use correct public page URL pattern
    navigator.clipboard.writeText(`${window.location.origin}/public/${event.public_token}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast("Link copied!");
  };

  // ─── Start / re-process ──────────────────────────────────────────────────
  const startProcessing = async () => {
    if (!event || reprocessing) return;
    setReprocessing(true);
    try {
      const res = await fetch(`${API}/events/${event.id}/process`, {
        method: "POST", headers: authH(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed" }));
        showToast(err.detail ?? "Failed to start"); return;
      }
      showToast("Processing started!");
      setClusters(null);
      setUploadSuccess(false); // Clear upload success flag
      await loadEvent();
    } catch {
      showToast("Failed to start processing");
    } finally {
      setReprocessing(false);
    }
  };

  // ─── Delete event ────────────────────────────────────────────────────────
  const deleteEvent = async () => {
    if (!event) return;
    if (!confirm(`Delete "${event.name}"?\n\nAll images and face data will be permanently removed.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API}/events/${event.id}`, {
        method: "DELETE", headers: authH(),
      });
      if (!res.ok) throw new Error();
      router.push("/dashboard");
    } catch {
      showToast("Failed to delete event");
      setDeleting(false);
    }
  };

  // ─── Guest Uploads ───────────────────────────────────────────────────────
  const loadGuestUploads = useCallback(async () => {
    setGuestUploadsLoading(true);
    try {
      const res = await fetch(`${API}/events/${eventId}/guest-uploads`, { headers: authH() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setGuestUploads(data);
    } catch {
      showToast("Failed to load guest uploads");
    } finally {
      setGuestUploadsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (view === "guest_uploads") loadGuestUploads();
  }, [view]);

  const approveUpload = async (id: number) => {
    setApprovingId(id);
    try {
      const res = await fetch(`${API}/events/${eventId}/guest-uploads/${id}/approve`, {
        method: "POST", headers: authH(),
      });
      if (!res.ok) throw new Error();
      showToast("✓ Photo approved & queued for processing");
      await loadGuestUploads();
    } catch {
      showToast("Failed to approve photo");
    } finally {
      setApprovingId(null);
    }
  };

  const rejectUpload = async (id: number) => {
    setRejectingId(id);
    try {
      const res = await fetch(`${API}/events/${eventId}/guest-uploads/${id}/reject`, {
        method: "POST", headers: authH(),
      });
      if (!res.ok) throw new Error();
      showToast("Photo rejected");
      await loadGuestUploads();
    } catch {
      showToast("Failed to reject photo");
    } finally {
      setRejectingId(null);
    }
  };

  const bulkApprove = async () => {
    if (!guestUploads?.pending.length) return;
    setBulkActioning(true);
    try {
      const res = await fetch(`${API}/events/${eventId}/guest-uploads/bulk-approve`, {
        method: "POST", headers: authH(),
      });
      if (!res.ok) throw new Error();
      showToast(`✓ All ${guestUploads.pending.length} photos approved & queued`);
      await loadGuestUploads();
    } catch {
      showToast("Bulk approve failed");
    } finally {
      setBulkActioning(false);
    }
  };

  const bulkReject = async () => {
    if (!guestUploads?.pending.length) return;
    if (!confirm(`Reject all ${guestUploads.pending.length} pending photos?`)) return;
    setBulkActioning(true);
    try {
      const res = await fetch(`${API}/events/${eventId}/guest-uploads/bulk-reject`, {
        method: "POST", headers: authH(),
      });
      if (!res.ok) throw new Error();
      showToast("All pending photos rejected");
      await loadGuestUploads();
    } catch {
      showToast("Bulk reject failed");
    } finally {
      setBulkActioning(false);
    }
  };

  // ─── Owner face search ───────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setSearching(true);
    setSearchResult(null);
    setSearchError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/events/${eventId}/search`, {
        method: "POST",
        headers: authH(),
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Search failed" }));
        throw new Error(err.detail ?? "Search failed");
      }
      const data: SearchResult = await res.json();
      setSearchResult(data);
      if (data.total_matches === 0)
        setSearchError("No matching photos found. Try a clearer photo with better lighting.");
      else
        setTimeout(() =>
          document.getElementById("search-results")?.scrollIntoView({ behavior: "smooth" }), 300);
    } catch (e: any) {
      setSearchError(e.message ?? "Search failed");
    } finally {
      setSearching(false);
    }
  };

  // ─── Camera ─────────────────────────────────────────────────────────────
  const startCamera = async () => {
    setCameraOpen(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = s;
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch {
      showToast("Camera access denied");
      setCameraOpen(false);
    }
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };
  const capturePhoto = () => {
    const v = videoRef.current!;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob(b => { if (b) handleUpload(new File([b], "capture.jpg", { type: "image/jpeg" })); });
    stopCamera();
  };

  // ─── Preview lightbox ────────────────────────────────────────────────────
  const openPreview = (img: string, pool: string[], idx: number) => {
    setPreviewImg(img); setPreviewPool(pool); setPreviewIdx(idx);
  };
  const navPreview = (dir: number) => {
    const next = (previewIdx + dir + previewPool.length) % previewPool.length;
    setPreviewIdx(next);
    setPreviewImg(previewPool[next]);
  };

  // ─── URL builders ────────────────────────────────────────────────────────
  const tok          = event?.public_token ?? "";
  const imgUrl       = (n: string)   => `${API}/public/events/${tok}/image/${n}`;
  const thumbUrl     = (n: string)   => `${API}/public/events/${tok}/thumbnail/${n}`;
  const dlUrl        = (n: string)   => `${API}/events/${eventId}/download/${n}`;
  const clusterDlUrl = (cid: number) => `${API}/events/${eventId}/clusters/${cid}/download`;
  
  // FIXED: Correct public page URL pattern
  const publicPageUrl = typeof window !== "undefined"
    ? `${window.location.origin}/public/${event?.public_token ?? ""}`
    : `/public/${event?.public_token ?? ""}`;

  const coverImageUrl = event?.cover_image 
    ? `${API}/storage/covers/${event.cover_image}`
    : null;

  // ─── Plan check helper ───────────────────────────────────────────────────
  const isFree = event?.plan_type === "free";
  const canDownload = !isFree; // Only Pro+ can download

  // ─── Render guards ───────────────────────────────────────────────────────
  if (eventLoading) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="flex items-center gap-3 text-zinc-500">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">Loading event…</span>
      </div>
    </div>
  );

  if (!event) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="text-center">
        <AlertCircle size={32} className="text-zinc-600 mx-auto mb-3" />
        <p className="text-zinc-400 text-sm">Event not found.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-xs text-blue-400 hover:underline">← Back to dashboard</Link>
      </div>
    </div>
  );

  const isCompleted = event.processing_status === "completed";
  const hasPendingImages = uploadSuccess && event.image_count > 0 && event.processing_status !== "processing";

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 antialiased">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[700px] h-56 rounded-full bg-indigo-700/8 blur-[120px] z-0" />

      {/* ── TOAST ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: -10, x: "-50%" }}
            animate={{ opacity: 1, y: 0,   x: "-50%" }}
            exit={{ opacity: 0,   y: -10,  x: "-50%" }}
            className="fixed top-4 left-1/2 z-[999] bg-zinc-800 border border-zinc-700 text-xs font-medium px-4 py-2.5 rounded-xl shadow-xl whitespace-nowrap"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SEARCH OVERLAY ── */}
      <AnimatePresence>
        {searching && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[998]"
          >
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center gap-4 w-72 text-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
              <div>
                <p className="text-sm font-semibold">Scanning faces</p>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  Searching {(event.image_count ?? 0).toLocaleString()} photos for matches
                </p>
              </div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"
                    style={{ animationDelay: `${i * 0.3}s` }} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── NAVBAR ── */}
      <header className="fixed top-0 inset-x-0 z-40 h-12 border-b border-zinc-800/60 bg-[#0a0a0a]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto h-full px-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
              <ArrowLeft size={15} />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
                <Scan size={10} className="text-white" />
              </div>
              <span className="text-sm font-semibold truncate max-w-[200px]">{event.name}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border ${statusStyle[event.processing_status] ?? statusStyle.pending}`}>
              {event.processing_status === "processing" && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
              {event.processing_status}
            </span>
            <button onClick={deleteEvent} disabled={deleting}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-400/10 transition-colors">
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        </div>
      </header>

      <div className="pt-12">

        {/* ── EVENT HERO ── */}
        <section className="relative z-10 border-b border-zinc-800/60 bg-zinc-900/30">
          {coverImageUrl && (
            <div className="absolute inset-0 overflow-hidden">
              <img src={coverImageUrl}
                className="w-full h-full object-cover opacity-10 blur-sm scale-110" aria-hidden />
              <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/60 to-[#0a0a0a]" />
            </div>
          )}

          <div className="relative max-w-6xl mx-auto px-5 py-8">
            <div className="flex flex-col sm:flex-row gap-5 sm:items-start">

              {/* Cover */}
              {coverImageUrl ? (
                <img src={coverImageUrl}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover border border-zinc-800 flex-shrink-0" />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0">
                  <ImageIcon size={28} className="text-zinc-600" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{event.name}</h1>
                {event.description && (
                  <p className="text-sm text-zinc-500 mt-1 leading-relaxed line-clamp-2">{event.description}</p>
                )}

                {/* Stats */}
                <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4">
                  {[
                    { icon: <ImageIcon size={12} />, text: `${(event.image_count ?? 0).toLocaleString()} photos` },
                    { icon: <Users     size={12} />, text: `${(event.total_faces ?? 0).toLocaleString()} faces` },
                    { icon: <Layers    size={12} />, text: `${(event.total_clusters ?? 0).toLocaleString()} clusters` },
                    { icon: <Clock     size={12} />, text: event.expires_at ? `Expires ${fmtDate(event.expires_at)}` : "No expiry" },
                  ].map(s => (
                    <span key={s.text} className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <span className="text-zinc-700">{s.icon}</span>{s.text}
                    </span>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 mt-4">
                  {/* FIXED: Show process button only when needed */}
                  {hasPendingImages && event.processing_status !== "processing" && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={startProcessing}
                      disabled={reprocessing}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-colors disabled:opacity-60 border border-orange-500/50">
                      {reprocessing ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                      Process Images
                    </motion.button>
                  )}

                  {/* Regular process/reprocess button */}
                  {!hasPendingImages && event.processing_status !== "processing" && (
                    <button onClick={startProcessing} disabled={reprocessing}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-60">
                      {reprocessing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      {event.processing_status === "pending" ? "Start Processing" : "Re-process"}
                    </button>
                  )}

                  <button onClick={togglePublic} disabled={toggling}
                    className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                      event.public_status === "active"
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                    }`}>
                    {toggling ? <Loader2 size={12} className="animate-spin" /> :
                      event.public_status === "active" ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                    {event.public_status === "active" ? "Public" : "Private"}
                  </button>

                  {event.public_status === "active" && (
                    <>
                      <button onClick={copyLink}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">
                        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        {copied ? "Copied!" : "Copy link"}
                      </button>
                      <a href={publicPageUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">
                        <ExternalLink size={12} />Open public page
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Progress bar - FIXED: Proper 0-100% animation */}
            {event.processing_status === "processing" && (
              <div className="mt-5 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={11} className="animate-spin" />Processing images…
                  </span>
                  <span>{Math.min(Math.max(event.processing_progress, 0), 100)}%</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-blue-600 to-violet-600 rounded-full"
                    initial={{ width: "0%" }}
                    animate={{ width: `${Math.min(Math.max(event.processing_progress, 0), 100)}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── TAB NAV ── */}
        <div className="sticky top-12 z-30 bg-[#0a0a0a]/95 backdrop-blur-xl border-b border-zinc-800/60">
          <div className="max-w-6xl mx-auto px-5 flex">
            {([
              { id: "overview",       label: "Overview",       icon: <BarChart2   size={13} /> },
              { id: "clusters",       label: "Clusters",       icon: <Grid3X3     size={13} />, guard: !isCompleted },
              { id: "search",         label: "Face Search",    icon: <Search      size={13} />, guard: !isCompleted },
              { id: "guest_uploads",  label: "Guest Uploads",  icon: <CloudUpload size={13} />,
                badge: guestUploads?.total_pending ?? event?.pending_guest_uploads ?? 0 },
            ] as { id: ViewMode; label: string; icon: React.ReactNode; guard?: boolean; badge?: number }[]).map(t => (
              <button key={t.id}
                onClick={() => !t.guard && setView(t.id)}
                disabled={t.guard}
                className={`flex items-center gap-2 px-4 py-3.5 text-xs font-medium border-b-2 transition-colors ${
                  view === t.id ? "border-blue-500 text-zinc-100" :
                  t.guard       ? "border-transparent text-zinc-700 cursor-not-allowed" :
                                  "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}>
                {t.icon}
                {t.label}
                {t.guard && (
                  <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-700 font-normal">
                    Process first
                  </span>
                )}
                {!t.guard && (t.badge ?? 0) > 0 && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold text-black">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div className="relative z-10 max-w-6xl mx-auto px-5 py-8">
          <AnimatePresence mode="wait">

            {/* ──────────── OVERVIEW ──────────── */}
            {view === "overview" && (
              <motion.div key="overview"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

                {/* Stat cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  {[
                    { l: "Photos",   v: (event.image_count   ?? 0).toLocaleString(), icon: <ImageIcon size={16} />, c: "blue"    },
                    { l: "Faces",    v: (event.total_faces    ?? 0).toLocaleString(), icon: <Users     size={16} />, c: "violet"  },
                    { l: "Clusters", v: (event.total_clusters ?? 0).toLocaleString(), icon: <Layers    size={16} />, c: "indigo"  },
                    { l: "Progress", v: `${Math.min(Math.max(event.processing_progress, 0), 100)}%`,              icon: <BarChart2 size={16} />, c: "emerald" },
                  ].map(s => (
                    <div key={s.l} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${
                        s.c === "blue"   ? "bg-blue-500/10 text-blue-400"     :
                        s.c === "violet" ? "bg-violet-500/10 text-violet-400" :
                        s.c === "indigo" ? "bg-indigo-500/10 text-indigo-400" :
                                           "bg-emerald-500/10 text-emerald-400"
                      }`}>{s.icon}</div>
                      <p className="text-2xl font-bold tracking-tight">{s.v}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{s.l}</p>
                    </div>
                  ))}
                </div>

                {/* ── UPLOAD CARD ── */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4">
                  <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">Upload Photos</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Add more images · {(event.image_count ?? 0).toLocaleString()} uploaded so far
                      </p>
                      <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        Processing is required after upload to enable face search
                      </p>
                    </div>
                    {uploading ? (
                      <div className="flex items-center gap-2 text-xs text-zinc-400 flex-shrink-0">
                        <Loader2 size={13} className="animate-spin" />
                        Uploading…
                      </div>
                    ) : (
                      <button
                        onClick={startProcessing}
                        disabled={reprocessing || event.processing_status === "processing"}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-60 flex-shrink-0"
                      >
                        {reprocessing
                          ? <Loader2 size={12} className="animate-spin" />
                          : event.processing_status === "processing"
                          ? <Loader2 size={12} className="animate-spin" />
                          : <Play size={12} />}
                        {event.processing_status === "processing" ? "Processing..." : "Process Images"}
                      </button>
                    )}
                  </div>

                  <label
                    className={`flex flex-col items-center justify-center gap-3 p-8 cursor-pointer transition-colors ${
                      uploadDragOver ? "bg-blue-500/5 border-blue-500/20" : "hover:bg-zinc-800/40"
                    } ${uploading ? "pointer-events-none opacity-50" : ""}`}
                    onDragOver={e  => { e.preventDefault(); setUploadDragOver(true); }}
                    onDragLeave={() => setUploadDragOver(false)}
                    onDrop={e => {
                      e.preventDefault(); setUploadDragOver(false);
                      if (e.dataTransfer.files?.length) handleImageUpload(e.dataTransfer.files);
                    }}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${
                      uploadDragOver
                        ? "bg-blue-500/20 border-blue-500/30 text-blue-400"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}>
                      <Upload size={16} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-200">
                        Drop photos here or click to browse
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        JPG, PNG, WEBP · multiple files supported
                      </p>
                    </div>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      hidden
                      multiple
                      accept="image/*"
                      onChange={e => {
                        if (e.target.files?.length) handleImageUpload(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>

                  {/* FIXED: Show prompt to process when images uploaded */}
                  {uploadSuccess && event.processing_status !== "processing" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-zinc-800 bg-orange-500/5 px-5 py-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={14} className="text-orange-400 flex-shrink-0" />
                        <p className="text-xs text-orange-300">
                          New images uploaded! Click <strong>Process Images</strong> above to analyze them.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Quick actions */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-4">
                  <h3 className="text-sm font-semibold mb-4">Quick Actions</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {[
                      { id: "clusters" as ViewMode, label: "Browse Clusters",   sub: "Photos grouped by face identity",    icon: <Grid3X3 size={15} />, accent: "indigo" },
                      { id: "search"   as ViewMode, label: "Face Search",        sub: "Upload a selfie to find matches",     icon: <Search  size={15} />, accent: "blue"   },
                    ].map(a => (
                      <button key={a.id} onClick={() => setView(a.id)} disabled={!isCompleted}
                        className="flex items-center gap-3 p-4 rounded-xl bg-zinc-800/50 border border-zinc-700/60 hover:bg-zinc-800 hover:border-zinc-600 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          a.accent === "indigo"
                            ? "bg-indigo-500/10 border border-indigo-500/20 text-indigo-400"
                            : "bg-blue-500/10 border border-blue-500/20 text-blue-400"
                        }`}>{a.icon}</div>
                        <div>
                          <p className="text-sm font-medium">{a.label}</p>
                          <p className="text-xs text-zinc-500 mt-0.5">{a.sub}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Public link */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold">Public Selfie Page</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">Share so attendees can find their own photos</p>
                    </div>
                    <button onClick={togglePublic} disabled={toggling}
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                        event.public_status === "active"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                          : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                      }`}>
                      {toggling ? <Loader2 size={12} className="animate-spin" /> :
                        event.public_status === "active" ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {event.public_status === "active" ? "Enabled" : "Disabled"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5">
                    <span className="text-xs text-zinc-500 font-mono truncate flex-1">{publicPageUrl}</span>
                    <button onClick={copyLink}
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors flex-shrink-0">
                      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <a href={publicPageUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors flex-shrink-0">
                      <ExternalLink size={11} />Open
                    </a>
                  </div>
                  {event.public_status === "disabled" && (
                    <p className="text-[11px] text-zinc-600 mt-2">
                      Enable to let attendees find their photos via selfie search.
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* ──────────── CLUSTERS ──────────── */}
            {view === "clusters" && (
              <motion.div key="clusters"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

                {clustersLoading ? (
                  <div className="flex items-center justify-center py-24 gap-3 text-zinc-500">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm">Loading clusters…</span>
                  </div>

                ) : !clusters || clusters.total_clusters === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                      <Layers size={20} className="text-zinc-600" />
                    </div>
                    <p className="text-sm text-zinc-400">No clusters found</p>
                    <p className="text-xs text-zinc-600">Process the event to generate face clusters</p>
                  </div>

                ) : (
                  <>
                    <div className="mb-5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{clusters.total_clusters} Face Clusters</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {clusters.total_images.toLocaleString()} photos grouped by identity · sorted largest first
                        </p>
                      </div>
                      {/* Free plan download notice */}
                      {isFree && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-500/80 bg-amber-500/8 border border-amber-500/20 px-3 py-1.5 rounded-lg">
                          <Lock size={11} />
                          Upgrade to Pro to download
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      {clusters.clusters.map(cluster => (
                        <div key={cluster.cluster_id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">

                          {/* Header row */}
                          <button
                            onClick={() => setExpanded(expanded === cluster.cluster_id ? null : cluster.cluster_id)}
                            className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-zinc-800/40 transition-colors text-left">
                            <img src={thumbUrl(cluster.preview_image)}
                              className="w-11 h-11 rounded-lg object-cover border border-zinc-700 flex-shrink-0"
                              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-zinc-600">#{cluster.cluster_id}</span>
                                <span className="text-sm font-medium">Cluster {cluster.cluster_id}</span>
                              </div>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                {cluster.image_count} photo{cluster.image_count !== 1 ? "s" : ""}
                              </p>
                            </div>

                            {/* Strip */}
                            <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                              {cluster.images.slice(0, 6).map((img, i) => (
                                <img key={i} src={thumbUrl(img)}
                                  className="w-7 h-7 rounded-md object-cover border border-zinc-700"
                                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              ))}
                              {cluster.image_count > 6 && (
                                <div className="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                                  <span className="text-[9px] text-zinc-500">+{cluster.image_count - 6}</span>
                                </div>
                              )}
                            </div>

                            {/* Cluster ZIP download — FIXED: disabled for free plan */}
                            {isFree ? (
                              <div
                                title="Upgrade to Pro to download"
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-700 cursor-not-allowed flex-shrink-0">
                                <Lock size={13} />
                              </div>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); handleDownload(clusterDlUrl(cluster.cluster_id), `cluster_${cluster.cluster_id}.zip`); }}
                                title="Download cluster ZIP"
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors flex-shrink-0">
                                <Download size={13} />
                              </button>
                            )}

                            <ChevronDown size={13}
                              className={`text-zinc-600 flex-shrink-0 transition-transform duration-200 ${
                                expanded === cluster.cluster_id ? "rotate-180" : ""
                              }`} />
                          </button>

                          {/* Expanded grid */}
                          <AnimatePresence>
                            {expanded === cluster.cluster_id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden">
                                <div className="border-t border-zinc-800 p-4">
                                  <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                                    {cluster.images.map((img, i) => (
                                      <motion.div key={img}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: Math.min(i * 0.012, 0.35) }}
                                        className="group relative rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 cursor-pointer transition-all hover:scale-[1.04] bg-zinc-800 aspect-[4/5]"
                                        onClick={() => openPreview(img, cluster.images, i)}>
                                        <img src={thumbUrl(img)}
                                          className="w-full h-full object-cover block" loading="lazy" />
                                        <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                          <button onClick={e => { e.stopPropagation(); openPreview(img, cluster.images, i); }}
                                            className="w-7 h-7 rounded-md bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                                            <ZoomIn size={11} />
                                          </button>
                                          {/* Individual image download — FIXED: hidden for free plan */}
                                          {canDownload && (
                                            <button
                                              onClick={e => { e.stopPropagation(); handleDownload(dlUrl(img), img); }}
                                              className="w-7 h-7 rounded-md bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                                              <Download size={11} />
                                            </button>
                                          )}
                                        </div>
                                      </motion.div>
                                    ))}
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ──────────── FACE SEARCH ──────────── */}
            {view === "search" && (
              <motion.div key="search"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="max-w-2xl mx-auto">

                {/* Upload card */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-5">
                  <div className="px-5 py-4 border-b border-zinc-800">
                    <p className="text-sm font-semibold">Owner Face Search</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Upload or capture a face — shows similarity score and cluster ID per match
                    </p>
                  </div>

                  {/* Drop zone */}
                  <label
                    className={`flex flex-col items-center justify-center gap-3 p-10 cursor-pointer border-b border-zinc-800 transition-colors ${
                      dragOver ? "bg-blue-500/5" : "hover:bg-zinc-800/40"
                    }`}
                    onDragOver={e  => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => {
                      e.preventDefault(); setDragOver(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f?.type.startsWith("image/")) handleUpload(f);
                    }}>
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-colors ${
                      dragOver ? "bg-blue-500/20 border-blue-500/30 text-blue-400"
                               : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}>
                      <Upload size={18} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-200">
                        {searchResult ? "Upload a different photo" : "Drop your photo here"}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">or click to browse · JPG, PNG, WEBP</p>
                    </div>
                    <input type="file" hidden accept="image/*"
                      onChange={e => {
                        if (e.target.files?.[0]) handleUpload(e.target.files[0]);
                        e.target.value = "";
                      }} />
                  </label>

                  <div className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 h-px bg-zinc-800" />
                    <span className="text-[11px] text-zinc-600">or use camera</span>
                    <div className="flex-1 h-px bg-zinc-800" />
                  </div>
                  <div className="px-5 pb-5">
                    <button onClick={startCamera}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-sm font-medium text-zinc-200 transition-colors">
                      <Camera size={14} />Open Camera
                    </button>
                  </div>
                </div>

                {/* Error */}
                {searchError && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 bg-red-500/8 border border-red-500/20 rounded-xl p-4 mb-5">
                    <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                    <p className="text-xs text-red-300">{searchError}</p>
                  </motion.div>
                )}

                {/* Results */}
                <AnimatePresence>
                  {searchResult && searchResult.total_matches > 0 && (
                    <motion.div id="search-results"
                      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28 }}
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

                      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                        <div>
                          <p className="text-sm font-semibold">
                            {searchResult.total_matches} Match{searchResult.total_matches !== 1 ? "es" : ""} Found
                          </p>
                          <p className="text-xs text-zinc-500 mt-0.5">
                            Sorted by similarity · green = strict · amber = normal match
                          </p>
                        </div>
                      </div>

                      <div className="p-4">
                        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
                          {searchResult.matches.map((match, i) => (
                            <motion.div key={`${match.image_name}-${i}`}
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: Math.min(i * 0.02, 0.45) }}
                              className="group relative rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 cursor-pointer transition-all hover:scale-[1.03] bg-zinc-800 aspect-[4/5]"
                              onClick={() => openPreview(match.image_name, searchResult.matches.map(m => m.image_name), i)}>
                              <img src={thumbUrl(match.image_name)}
                                className="w-full h-full object-cover block" loading="lazy" />

                              {/* Similarity badge */}
                              <div className="absolute top-1.5 left-1.5 bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5 pointer-events-none">
                                <span className={`text-[9px] font-bold ${
                                  match.similarity >= 0.62 ? "text-emerald-400" :
                                  match.similarity >= 0.55 ? "text-amber-400"   : "text-zinc-400"
                                }`}>
                                  {(match.similarity * 100).toFixed(0)}%
                                </span>
                              </div>

                              {/* Cluster badge */}
                              <div className="absolute top-1.5 right-1.5 bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5 pointer-events-none">
                                <span className="text-[9px] text-zinc-400 font-mono">#{match.cluster_id}</span>
                              </div>

                              {/* Hover overlay */}
                              <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                <button onClick={e => { e.stopPropagation(); openPreview(match.image_name, searchResult.matches.map(m => m.image_name), i); }}
                                  className="w-7 h-7 rounded-lg bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                                  <ZoomIn size={11} />
                                </button>
                                {/* Download — FIXED: hidden for free plan */}
                                {canDownload && (
                                  <button
                                    onClick={e => { e.stopPropagation(); handleDownload(dlUrl(match.image_name), match.image_name); }}
                                    className="w-7 h-7 rounded-lg bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                                    <Download size={11} />
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ──────────── GUEST UPLOADS ──────────── */}
            {view === "guest_uploads" && (
              <motion.div key="guest_uploads"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>

                {guestUploadsLoading ? (
                  <div className="flex items-center justify-center py-24 gap-3 text-zinc-500">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm">Loading guest uploads…</span>
                  </div>

                ) : !guestUploads ? (
                  <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
                    <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                      <CloudUpload size={20} className="text-zinc-600" />
                    </div>
                    <p className="text-sm text-zinc-400">No guest uploads yet</p>
                    <p className="text-xs text-zinc-600 max-w-xs">When guests upload photos from the public page, they'll appear here for your review.</p>
                    <button onClick={loadGuestUploads}
                      className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 mt-1">
                      <RefreshCw size={12} /> Refresh
                    </button>
                  </div>

                ) : (
                  <>
                    {/* Header & bulk actions */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                      <div>
                        <h2 className="text-sm font-semibold">Guest Photo Submissions</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          Approved photos are auto-queued for face processing and appear in the public gallery
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={loadGuestUploads}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 border border-zinc-800 transition-colors">
                          <RefreshCw size={13} />
                        </button>
                        {guestFilter === "pending" && guestUploads.pending.length > 0 && (
                          <>
                            <button onClick={bulkApprove} disabled={bulkActioning}
                              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-60">
                              {bulkActioning ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                              Approve All ({guestUploads.pending.length})
                            </button>
                            <button onClick={bulkReject} disabled={bulkActioning}
                              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white transition-colors disabled:opacity-60">
                              {bulkActioning ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />}
                              Reject All
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Filter tabs */}
                    <div className="flex gap-1 mb-5 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
                      {([
                        { key: "pending",  label: "Pending",  count: guestUploads.pending.length,  color: "text-amber-400"   },
                        { key: "approved", label: "Approved", count: guestUploads.approved.length, color: "text-emerald-400" },
                        { key: "rejected", label: "Rejected", count: guestUploads.rejected.length, color: "text-red-400"     },
                      ] as { key: typeof guestFilter; label: string; count: number; color: string }[]).map(f => (
                        <button key={f.key} onClick={() => setGuestFilter(f.key)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            guestFilter === f.key ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                          }`}>
                          {f.label}
                          {f.count > 0 && (
                            <span className={`text-[10px] font-bold ${guestFilter === f.key ? f.color : "text-zinc-600"}`}>
                              {f.count}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Photo grid */}
                    {(() => {
                      const items = guestUploads[guestFilter];
                      if (items.length === 0) return (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                          <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                            <ImageIcon size={20} className="text-zinc-600" />
                          </div>
                          <p className="text-sm text-zinc-500">No {guestFilter} photos</p>
                        </div>
                      );
                      return (
                        <motion.div
                          key={guestFilter}
                          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
                          initial="hidden" animate="visible"
                          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {items.map((upload) => (
                            <motion.div key={upload.id}
                              variants={{ hidden: { opacity: 0, scale: 0.92 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.2 } } }}
                              className="group relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">

                              {/* Thumbnail */}
                              <div className="relative aspect-square bg-zinc-800 overflow-hidden">
                                {upload.thumbnail_url ? (
                                  <img
                                    src={`${API}${upload.thumbnail_url}`}
                                    alt={upload.original_filename}
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <ImagePlus size={24} className="text-zinc-600" />
                                  </div>
                                )}

                                {/* Status badge */}
                                <div className={`absolute top-2 left-2 flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md backdrop-blur-sm border ${
                                  upload.status === "pending"
                                    ? "bg-amber-500/20 border-amber-500/30 text-amber-400"
                                    : upload.status === "approved"
                                    ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                                    : "bg-red-500/20 border-red-500/30 text-red-400"
                                }`}>
                                  {upload.status === "pending"  && <Clock        size={8} />}
                                  {upload.status === "approved" && <CheckCircle2 size={8} />}
                                  {upload.status === "rejected" && <XCircle      size={8} />}
                                  {upload.status}
                                </div>

                                {/* Preview button */}
                                {upload.thumbnail_url && (
                                  <button
                                    onClick={() => setGuestPreviewUrl(`${API}${upload.thumbnail_url}`)}
                                    className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center">
                                      <Eye size={14} className="text-white" />
                                    </div>
                                  </button>
                                )}
                              </div>

                              {/* Info */}
                              <div className="p-2.5 flex-1 flex flex-col gap-1">
                                <p className="text-[11px] font-medium text-zinc-300 truncate" title={upload.original_filename}>
                                  {upload.original_filename}
                                </p>
                                {upload.contributor_name && (
                                  <p className="text-[10px] text-zinc-500 truncate">by {upload.contributor_name}</p>
                                )}
                                {upload.message && (
                                  <p className="text-[10px] text-zinc-600 italic line-clamp-1" title={upload.message}>
                                    "{upload.message}"
                                  </p>
                                )}
                                <p className="text-[10px] text-zinc-700 mt-auto pt-1">
                                  {new Date(upload.uploaded_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </p>
                              </div>

                              {/* Approve / Reject buttons for pending */}
                              {upload.status === "pending" && (
                                <div className="flex border-t border-zinc-800">
                                  <button onClick={() => approveUpload(upload.id)}
                                    disabled={approvingId === upload.id || rejectingId === upload.id}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50 border-r border-zinc-800">
                                    {approvingId === upload.id ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
                                    Approve
                                  </button>
                                  <button onClick={() => rejectUpload(upload.id)}
                                    disabled={approvingId === upload.id || rejectingId === upload.id}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                                    {rejectingId === upload.id ? <Loader2 size={11} className="animate-spin" /> : <ThumbsDown size={11} />}
                                    Reject
                                  </button>
                                </div>
                              )}

                              {/* Re-review button for already actioned */}
                              {upload.status === "rejected" && (
                                <div className="flex border-t border-zinc-800">
                                  <button onClick={() => approveUpload(upload.id)} disabled={approvingId === upload.id}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/8 transition-colors disabled:opacity-50">
                                    {approvingId === upload.id ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
                                    Approve instead
                                  </button>
                                </div>
                              )}
                              {upload.status === "approved" && (
                                <div className="flex border-t border-zinc-800">
                                  <button onClick={() => rejectUpload(upload.id)} disabled={rejectingId === upload.id}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-zinc-500 hover:text-red-400 hover:bg-red-500/8 transition-colors disabled:opacity-50">
                                    {rejectingId === upload.id ? <Loader2 size={11} className="animate-spin" /> : <ThumbsDown size={11} />}
                                    Reject instead
                                  </button>
                                </div>
                              )}
                            </motion.div>
                          ))}
                        </motion.div>
                      );
                    })()}
                  </>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>

      {/* ── CAMERA MODAL ── */}
      <AnimatePresence>
        {cameraOpen && (
          <motion.div className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden w-full max-w-sm">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
                <span className="text-sm font-semibold">Take a Photo</span>
                <button onClick={stopCamera}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                  <X size={14} />
                </button>
              </div>
              <div className="bg-zinc-950">
                <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-72 object-cover block" />
              </div>
              <div className="p-4">
                <button onClick={capturePhoto}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
                  <Camera size={14} />Capture Photo
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── LIGHTBOX ── */}
      <AnimatePresence>
        {previewImg && (
          <motion.div className="fixed inset-0 bg-black/92 backdrop-blur-md flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPreviewImg(null)}>
            <motion.div initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.93, opacity: 0 }} className="relative"
              onClick={e => e.stopPropagation()}>
              <img src={imgUrl(previewImg)} className="max-h-[82vh] max-w-[90vw] rounded-xl block" alt="" />

              {previewPool.length > 1 && (
                <>
                  <button onClick={() => navPreview(-1)}
                    className="absolute -left-12 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-colors">
                    <ChevronLeft size={16} />
                  </button>
                  <button onClick={() => navPreview(1)}
                    className="absolute -right-12 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-colors">
                    <ChevronRight size={16} />
                  </button>
                </>
              )}

              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent rounded-b-xl px-4 py-4 flex items-end justify-between">
                <span className="text-xs text-white/40">{previewIdx + 1} / {previewPool.length}</span>
                {/* Lightbox download — FIXED: hidden for free plan */}
                {canDownload && (
                  <button
                    onClick={() => handleDownload(dlUrl(previewImg), previewImg)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                    <Download size={12} />Download
                  </button>
                )}
              </div>

              <button onClick={() => setPreviewImg(null)}
                className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-lg bg-black/60 border border-white/10 text-white hover:bg-black/80 transition-colors">
                <X size={13} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── GUEST UPLOAD PREVIEW LIGHTBOX ── */}
      <AnimatePresence>
        {guestPreviewUrl && (
          <motion.div className="fixed inset-0 bg-black/92 backdrop-blur-md flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setGuestPreviewUrl(null)}>
            <motion.div initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.93, opacity: 0 }} className="relative"
              onClick={e => e.stopPropagation()}>
              <img src={guestPreviewUrl} className="max-h-[82vh] max-w-[90vw] rounded-xl block" alt="Guest upload preview" />
              <button onClick={() => setGuestPreviewUrl(null)}
                className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-lg bg-black/60 border border-white/10 text-white hover:bg-black/80 transition-colors">
                <X size={13} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}