"use client";

import { useEffect, useState, useRef } from "react";
import API from "@/services/api";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Folder, Globe, Lock, Trash2,
  CalendarDays, LayoutGrid, QrCode, MessageCircle,
  Download, X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Event {
  id:             number;
  name:           string;
  created_at?:    string;
  cover_image?:   string;
  public_status?: string;
  public_token?:  string;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function EventsPage() {
  const [events,       setEvents]       = useState<Event[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null);
  const [deletingId,   setDeletingId]   = useState<number | null>(null);
  const [togglingId,   setTogglingId]   = useState<number | null>(null);
  const [qrEvent,      setQrEvent]      = useState<Event | null>(null);
  const qrRef   = useRef<HTMLDivElement>(null);
  const router  = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_API_URL;

  // ─── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    API.get("/events/my")
      .then(res  => setEvents(res.data))
      .catch(err => console.error("Failed to fetch events", err))
      .finally(  () => setLoading(false));
  }, []);

  // ─── Toggle public ──────────────────────────────────────────────────────────
  const togglePublic = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setTogglingId(id);
    try {
      const res = await API.post(`/events/${id}/toggle-public`);
      setEvents(prev =>
        prev.map(ev => ev.id === id ? { ...ev, public_status: res.data.public_status } : ev)
      );
    } catch {
      alert("Failed to update public status");
    } finally {
      setTogglingId(null);
    }
  };

  // ─── Share WhatsApp ──────────────────────────────────────────────────────────
  const shareWhatsApp = (e: React.MouseEvent, event: Event) => {
    e.stopPropagation();
    if (!event.public_token) return;
    const link = `${window.location.origin}/public/${event.public_token}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`Check your photos here: ${link}`)}`, "_blank");
  };

  // ─── QR download ────────────────────────────────────────────────────────────
  const downloadQR = () => {
    const svg = qrRef.current?.querySelector("svg");
    if (!svg || !qrEvent) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `${qrEvent.name}-qr.svg`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Delete ─────────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await API.delete(`/events/${deleteTarget.id}`);
      setEvents(prev => prev.filter(e => e.id !== deleteTarget.id));
    } catch {
      alert("Failed to delete event");
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  };

  const isActive  = (e: Event) => e.public_status === "active";
  const publicUrl = (event: Event) =>
    typeof window !== "undefined" && event.public_token
      ? `${window.location.origin}/public/${event.public_token}` : "";

  // ─── Skeleton ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-5 w-28 bg-zinc-800 rounded-lg animate-pulse" />
          <div className="h-8 w-28 bg-zinc-800 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="h-36 bg-zinc-800 animate-pulse" />
              <div className="p-4 space-y-3">
                <div className="h-4 w-3/4 bg-zinc-800 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-zinc-800 rounded animate-pulse" />
                <div className="flex gap-1.5">
                  {[...Array(4)].map((_, j) => (
                    <div key={j} className="flex-1 h-8 bg-zinc-800 rounded-lg animate-pulse" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Empty ───────────────────────────────────────────────────────────────────
  if (events.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">Your Events</h2>
          <button
            onClick={() => router.push("/events/create")}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            <Plus size={13} />
            Create Event
          </button>
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-700">
            <LayoutGrid size={22} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-400">No events yet</p>
            <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-[220px]">
              Create your first event to start collecting and finding photos
            </p>
          </div>
          <button
            onClick={() => router.push("/events/create")}
            className="flex items-center gap-1.5 text-xs font-medium px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-colors mt-1"
          >
            <Plus size={13} />
            Create your first event
          </button>
        </div>
      </div>
    );
  }

  // ─── Main ────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-300">Your Events</h2>
            <p className="text-xs text-zinc-600 mt-0.5">{events.length} event{events.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            onClick={() => router.push("/events/create")}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            <Plus size={13} />
            Create Event
          </button>
        </div>

        {/* Grid */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {events.map(event => (
            <motion.div
              key={event.id}
              variants={{
                hidden:  { opacity: 0, y: 12 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
              }}
              className="group bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors flex flex-col"
            >
              {/* Cover */}
              <div
                className="relative cursor-pointer overflow-hidden flex-shrink-0"
                onClick={() => router.push(`/events/${event.id}`)}
              >
                {event.cover_image ? (
                  <img
                    src={`${API_URL}/storage/covers/${event.cover_image}`}
                    className="w-full h-36 object-cover group-hover:scale-[1.03] transition-transform duration-300"
                    alt={event.name}
                  />
                ) : (
                  <div className="w-full h-36 bg-zinc-800 flex items-center justify-center">
                    <Folder size={28} className="text-zinc-700" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                {/* Status badge */}
                <span className={`absolute top-2.5 right-2.5 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border backdrop-blur-sm ${
                  isActive(event)
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : "bg-zinc-900/80 text-zinc-500 border-zinc-700/60"
                }`}>
                  {isActive(event) ? <Globe size={9} /> : <Lock size={9} />}
                  {isActive(event) ? "Public" : "Private"}
                </span>
              </div>

              {/* Content */}
              <div className="p-4 flex flex-col flex-1 gap-3">
                <div className="cursor-pointer" onClick={() => router.push(`/events/${event.id}`)}>
                  <h3 className="text-sm font-semibold text-zinc-100 truncate leading-tight group-hover:text-white transition-colors">
                    {event.name}
                  </h3>
                  {event.created_at && (
                    <p className="text-[11px] text-zinc-600 flex items-center gap-1 mt-1.5">
                      <CalendarDays size={10} />
                      {new Date(event.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </p>
                  )}
                </div>

                {/* ── 4 ACTION BUTTONS ── */}
                <div className="grid grid-cols-4 gap-1.5 mt-auto">

                  {/* 1 — Publish / Disable (wider, text label) */}
                  <button
                    onClick={e => togglePublic(e, event.id)}
                    disabled={togglingId === event.id}
                    title={isActive(event) ? "Disable public access" : "Make event public"}
                    className={`col-span-1 flex items-center justify-center gap-1 text-[11px] font-medium py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                      isActive(event)
                        ? "bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-400"
                        : "bg-blue-600/12 hover:bg-blue-600/20 border-blue-500/25 text-blue-400"
                    }`}
                  >
                    {togglingId === event.id
                      ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      : isActive(event) ? <Lock size={12} /> : <Globe size={12} />
                    }
                  </button>

                  {/* 2 — WhatsApp share */}
                  <button
                    onClick={e => shareWhatsApp(e, event)}
                    disabled={!isActive(event) || !event.public_token}
                    title={isActive(event) ? "Share via WhatsApp" : "Make event public to share"}
                    className="col-span-1 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-emerald-950/50 border border-zinc-700 hover:border-emerald-900/50 text-zinc-500 hover:text-emerald-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed py-2"
                  >
                    <MessageCircle size={13} />
                  </button>

                  {/* 3 — QR code */}
                  <button
                    onClick={e => { e.stopPropagation(); setQrEvent(event); }}
                    disabled={!isActive(event) || !event.public_token}
                    title={isActive(event) ? "Show QR Code" : "Make event public to get QR"}
                    className="col-span-1 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-blue-950/50 border border-zinc-700 hover:border-blue-900/50 text-zinc-500 hover:text-blue-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed py-2"
                  >
                    <QrCode size={13} />
                  </button>

                  {/* 4 — Delete */}
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(event); }}
                    title="Delete event"
                    className="col-span-1 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-red-950/50 border border-zinc-700 hover:border-red-900/50 text-zinc-500 hover:text-red-400 transition-colors py-2"
                  >
                    <Trash2 size={13} />
                  </button>

                </div>

                {/* Tooltip hint — show only when private */}
                {!isActive(event) && (
                  <p className="text-[10px] text-zinc-700 text-center -mt-1">
                    Publish to enable Share &amp; QR
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* ── QR MODAL ── */}
      <AnimatePresence>
        {qrEvent && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setQrEvent(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden w-full max-w-xs"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
                <span className="text-xs font-semibold text-zinc-100">QR Code</span>
                <button
                  onClick={() => setQrEvent(null)}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="p-5">
                <div
                  ref={qrRef}
                  className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 flex flex-col items-center gap-3 text-center"
                >
                  <div>
                    <p className="text-xs font-semibold text-zinc-100 truncate max-w-[180px]">{qrEvent.name}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">Scan to find your photos</p>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg">
                    <QRCodeSVG value={publicUrl(qrEvent)} size={140} level="H" />
                  </div>
                  <p className="text-[10px] text-zinc-700 break-all font-mono leading-relaxed">
                    {publicUrl(qrEvent)}
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5 flex gap-2">
                <button
                  onClick={downloadQR}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
                >
                  <Download size={12} />
                  Download SVG
                </button>
                <button
                  onClick={() => setQrEvent(null)}
                  className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
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
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100 mb-1">Delete event?</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-5">
                <span className="text-zinc-300 font-medium">"{deleteTarget.name}"</span> and all
                its photos and face data will be permanently removed. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={confirmDelete}
                  disabled={deletingId === deleteTarget.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-xs font-medium transition-colors"
                >
                  {deletingId === deleteTarget.id
                    ? <div className="w-3.5 h-3.5 border border-white/30 border-t-white rounded-full animate-spin" />
                    : "Delete permanently"
                  }
                </button>
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}