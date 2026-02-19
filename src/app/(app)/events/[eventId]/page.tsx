"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import API from "@/services/api";
import {
  Loader2, Trash2, RotateCw, Globe, MessageCircle,
  Download, QrCode, X, ArrowLeft, ImagePlus,
  Clock, Image, Users, LayoutGrid, ChevronRight,
  Zap, CheckCircle2, AlertCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ title, value, icon: Icon, accent = false }: {
  title: string; value: number | string; icon: any; accent?: boolean;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-start justify-between group hover:border-zinc-700 transition-colors">
      <div>
        <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-widest mb-2">{title}</p>
        <p className="text-2xl font-bold text-zinc-100 tracking-tight">{value ?? 0}</p>
      </div>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
        accent ? "bg-blue-500/15 text-blue-400" : "bg-zinc-800 text-zinc-500"
      } group-hover:scale-110 transition-transform`}>
        <Icon size={16} />
      </div>
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-zinc-500">{label}</span>
        <span className="text-xs font-medium text-zinc-300">{value}%</span>
      </div>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-blue-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function EventDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const eventId = params?.eventId as string;

  const [event,              setEvent]              = useState<any>(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [uploadProgress,     setUploadProgress]     = useState(0);
  const [qrOpen,             setQrOpen]             = useState(false);
  const [error,              setError]              = useState("");
  const [isUploading,        setIsUploading]        = useState(false);
  const [isProcessing,       setIsProcessing]       = useState(false);
  const [dragOver,           setDragOver]           = useState(false);
  const [deleteConfirm,      setDeleteConfirm]      = useState(false);

  const qrRef = useRef<HTMLDivElement>(null);

  // ─── Fetch event ────────────────────────────────────────────────────────────
  const fetchEvent = async () => {
    try {
      const res = await API.get(`/events/${eventId}`);
      setEvent(res.data);
      if (res.data.processing_status === "processing") startPolling();
    } catch {
      setError("Failed to load event");
    }
  };

  // ─── Polling ────────────────────────────────────────────────────────────────
  const startPolling = () => {
    setIsProcessing(true);
    const interval = setInterval(async () => {
      try {
        const res  = await API.get(`/events/${eventId}`);
        const data = res.data;
        setProcessingProgress(data.processing_progress);
        if (data.processing_status === "completed") {
          clearInterval(interval);
          setIsProcessing(false);
          fetchEvent();
        }
        if (data.processing_status === "failed") {
          clearInterval(interval);
          setIsProcessing(false);
          alert("Processing failed");
        }
      } catch {
        clearInterval(interval);
        setIsProcessing(false);
      }
    }, 2000);
  };

  // ─── Upload ─────────────────────────────────────────────────────────────────
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append("files", f));
    setIsUploading(true);
    setUploadProgress(0);
    try {
      await API.post(`/upload/${eventId}`, formData, {
        onUploadProgress: (e: any) => {
          setUploadProgress(Math.round((e.loaded * 100) / (e.total || 1)));
        },
      });
      setIsUploading(false);
      setUploadProgress(100);
      startPolling();
    } catch {
      setIsUploading(false);
      alert("Upload failed");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // ─── Reprocess ──────────────────────────────────────────────────────────────
  const handleReprocess = async () => {
    try {
      setIsProcessing(true);
      setProcessingProgress(0);
      await API.post(`/events/${eventId}/process`);
      startPolling();
    } catch {
      setIsProcessing(false);
      alert("Failed to reprocess event");
    }
  };

  // ─── Toggle public ──────────────────────────────────────────────────────────
  const togglePublic = async () => {
    try {
      const res = await API.post(`/events/${eventId}/toggle-public`);
      setEvent((prev: any) => ({ ...prev, public_status: res.data.public_status }));
    } catch {
      alert("Failed to update public status");
    }
  };

  // ─── Share WhatsApp ─────────────────────────────────────────────────────────
  const shareWhatsApp = () => {
    const link = `${window.location.origin}/public/${event.public_token}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`Check your photos here: ${link}`)}`, "_blank");
  };

  // ─── Download QR ────────────────────────────────────────────────────────────
  const downloadQR = () => {
    const svg = qrRef.current?.querySelector("svg");
    if (!svg) return;
    const svgString = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${event.name}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────
  const deleteEvent = async () => {
    await API.delete(`/events/${eventId}`);
    router.push("/events");
  };

  useEffect(() => { if (eventId) fetchEvent(); }, [eventId]);

  // ─── Loading ─────────────────────────────────────────────────────────────────
  if (!event) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        {error ? (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle size={16} />
            {error}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <div className="w-4 h-4 border border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            Loading event…
          </div>
        )}
      </div>
    );
  }

  const expiryDays = Math.ceil(
    (new Date(event.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ) || 0;

  const publicUrl = typeof window !== "undefined"
    ? `${window.location.origin}/public/${event.public_token}`
    : `/public/${event.public_token}`;

  const isActive = event.public_status === "active";

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[500px] h-48 rounded-full bg-blue-600/8 blur-[100px] z-0" />

      {/* ── PROCESSING OVERLAY ── */}
      <AnimatePresence>
        {(isUploading || isProcessing) && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"
          >
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-80 text-center space-y-5">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
              <div>
                <p className="text-sm font-semibold text-zinc-100">
                  {isUploading ? "Uploading photos" : "Processing with AI"}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {isUploading ? "Sending images to server…" : "Detecting and clustering faces…"}
                </p>
              </div>
              <ProgressBar
                value={isUploading ? uploadProgress : processingProgress}
                label={isUploading ? "Upload progress" : "Processing progress"}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── MAIN CONTENT ── */}
      <div className="relative z-10 max-w-4xl mx-auto px-5 py-8 space-y-6">

        {/* ── BACK + HEADER ── */}
        <div>
          <Link
            href="/events"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-5 group"
          >
            <ArrowLeft size={12} className="group-hover:-translate-x-0.5 transition-transform" />
            Back to Events
          </Link>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-50">{event.name}</h1>
              {event.description && (
                <p className="text-sm text-zinc-500 mt-1.5 leading-relaxed">{event.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Processing status badge */}
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
                event.processing_status === "completed"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : event.processing_status === "processing"
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  : event.processing_status === "failed"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-zinc-800 text-zinc-500 border-zinc-700"
              }`}>
                {event.processing_status === "completed" && <CheckCircle2 size={10} />}
                {event.processing_status === "processing" && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                {event.processing_status === "failed"    && <AlertCircle size={10} />}
                {event.processing_status === "pending"   && <Clock size={10} />}
                {event.processing_status ?? "pending"}
              </span>

              {/* Expiry badge */}
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
                expiryDays > 7
                  ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                  : expiryDays > 0
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}>
                <Clock size={10} />
                {expiryDays > 0 ? `Expires in ${expiryDays}d` : "Expired"}
              </span>
            </div>
          </div>
        </div>

        {/* ── STATS ── */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard title="Photos"   value={event.image_count}      icon={Image}      accent />
          <StatCard title="Faces"    value={event.total_faces ?? 0}  icon={Users}           />
          <StatCard title="Clusters" value={event.total_clusters ?? 0} icon={LayoutGrid}  />
        </div>

        {/* ── UPLOAD ── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <ImagePlus size={14} className="text-zinc-500" />
            <h2 className="text-sm font-semibold">Upload Photos</h2>
          </div>

          <div className="p-5 space-y-4">
            <label
              className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl cursor-pointer border border-dashed transition-colors ${
                dragOver
                  ? "border-blue-500/50 bg-blue-500/5"
                  : "border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800/40"
              }`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${
                dragOver
                  ? "bg-blue-500/20 border-blue-500/30 text-blue-400"
                  : "bg-zinc-800 border-zinc-700 text-zinc-500"
              }`}>
                <ImagePlus size={16} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-300">Drop photos here</p>
                <p className="text-xs text-zinc-600 mt-0.5">or click to browse · JPG, PNG, WEBP</p>
              </div>
              <input
                type="file"
                multiple
                hidden
                id="uploadInput"
                accept="image/*"
                onChange={e => handleUpload(e.target.files)}
              />
            </label>

            {uploadProgress > 0 && uploadProgress < 100 && (
              <ProgressBar value={uploadProgress} label="Uploading…" />
            )}
          </div>
        </div>

        {/* ── PUBLIC ACCESS ── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-zinc-500" />
              <h2 className="text-sm font-semibold">Public Access</h2>
            </div>
            {/* Toggle pill */}
            <button
              onClick={togglePublic}
              className={`relative inline-flex items-center h-5 w-9 rounded-full border transition-colors flex-shrink-0 ${
                isActive ? "bg-blue-600 border-blue-500" : "bg-zinc-800 border-zinc-700"
              }`}
            >
              <span className={`absolute w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
                isActive ? "translate-x-4" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Status row */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  {isActive ? "Public link active" : "Public link disabled"}
                </p>
                <p className="text-xs text-zinc-600 mt-0.5">
                  {isActive ? "Anyone with the link can find their photos" : "Enable to share with guests"}
                </p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
                isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-600"
              }`}>
                {isActive ? "LIVE" : "OFF"}
              </span>
            </div>

            {/* Public URL */}
            {isActive && event.public_token && (
              <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5">
                <p className="text-xs text-zinc-500 truncate flex-1 font-mono">{publicUrl}</p>
                <button
                  onClick={() => navigator.clipboard.writeText(publicUrl)}
                  className="text-[10px] font-medium text-blue-400 hover:text-blue-300 flex-shrink-0 transition-colors"
                >
                  Copy
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={shareWhatsApp}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                <MessageCircle size={12} />
                Share via WhatsApp
              </button>

              <button
                onClick={() => setQrOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 transition-colors"
              >
                <QrCode size={12} />
                QR Code
              </button>
            </div>
          </div>
        </div>

        {/* ── ACTIONS ── */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <Zap size={14} className="text-zinc-500" />
            <h2 className="text-sm font-semibold">Actions</h2>
          </div>

          <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Extend */}
            <button
              onClick={() => API.post(`/events/${eventId}/extend`)}
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 transition-colors group"
            >
              <div className="text-left">
                <p className="text-xs font-semibold text-zinc-200">Extend Event</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">Add more time</p>
              </div>
              <Clock size={14} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </button>

            {/* Reprocess */}
            <button
              onClick={handleReprocess}
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 transition-colors group"
            >
              <div className="text-left">
                <p className="text-xs font-semibold text-zinc-200">Reprocess</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">Re-run AI analysis</p>
              </div>
              <RotateCw size={14} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
            </button>

            {/* Delete */}
            <button
              onClick={() => setDeleteConfirm(true)}
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-zinc-800 hover:bg-red-950/60 border border-zinc-700 hover:border-red-900/60 transition-colors group"
            >
              <div className="text-left">
                <p className="text-xs font-semibold text-zinc-200 group-hover:text-red-400 transition-colors">Delete Event</p>
                <p className="text-[11px] text-zinc-600 mt-0.5">Permanently remove</p>
              </div>
              <Trash2 size={14} className="text-zinc-600 group-hover:text-red-500 transition-colors" />
            </button>
          </div>
        </div>

      </div>

      {/* ── QR MODAL ── */}
      <AnimatePresence>
        {qrOpen && event?.public_token && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setQrOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <span className="text-sm font-semibold">QR Code</span>
                <button
                  onClick={() => setQrOpen(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>

              {/* QR display */}
              <div className="p-5">
                <div
                  ref={qrRef}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col items-center text-center gap-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{event.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Scan to find your photos</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl">
                    <QRCodeSVG value={publicUrl} size={160} level="H" />
                  </div>
                  <p className="text-[10px] text-zinc-600 break-all font-mono leading-relaxed">{publicUrl}</p>
                </div>
              </div>

              {/* Modal actions */}
              <div className="px-5 pb-5 flex gap-2">
                <button
                  onClick={downloadQR}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                >
                  <Download size={12} />
                  Download SVG
                </button>
                <button
                  onClick={() => setQrOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── DELETE CONFIRM MODAL ── */}
      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100 mb-1">Delete this event?</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-5">
                This will permanently delete <span className="text-zinc-300 font-medium">{event.name}</span> and all associated photos and face data. This action cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={deleteEvent}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                >
                  Delete permanently
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
