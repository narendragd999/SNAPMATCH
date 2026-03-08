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
  ChevronDown, Loader2, AlertTriangle,
  CloudUpload, CheckCircle2, XCircle, ThumbsUp, ThumbsDown,
  RefreshCw, ImagePlus, Pause, RotateCcw, Zap,
  FileImage, QrCode, Droplet, Lock, LockOpen, KeyRound,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";
import PeopleGallery from "@/components/PeopleGallery";
import { QRCodeDisplay } from "@/components/snapmatch/QRCodeDisplay";
import { WatermarkSettings } from "@/components/snapmatch/WatermarkSettings";
import { WatermarkConfig, DEFAULT_WATERMARK_CONFIG } from "@/lib/snapmatch/watermark";
import EventQuotaBar from "@/components/EventQuotaBar";

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
  cover_image_url: string | null;      // ← full URL from storage_service
  public_status: "active" | "disabled";
  plan_type: string;
  watermark_enabled?: boolean;          // 🎨 Watermark enabled flag
  watermark_config?: WatermarkConfig;   // 🎨 Watermark configuration
  pin_enabled?: boolean;                // 🔒 PIN protection
  // 💰 Billing / quota (pay-per-event)
  photo_quota?: number;                 // Max owner photos purchaseed
  guest_quota?: number;                 // Guest upload slots purchased
  guest_uploads_used?: number;          // Approved guest photos so far
  payment_status?: "pending" | "paid" | "free" | "failed";
  is_free_tier?: boolean;
  validity_days?: number;
}

interface ClusterItem {
  cluster_id: number;
  image_count: number;
  preview_image: string;
  images: string[];
  scene_label?: string;
}

interface ClustersMeta {
  event_id?: number;
  total_clusters: number;
  total_images: number;
  has_more: boolean;
}

interface SearchMatch {
  image_name: string;
  cluster_id: number;
  similarity: number;
  scene_label?: string;
  objects?: string[];
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

interface SceneItem {
  scene_label: string;
  count: number;
}

type ViewMode = "overview" | "clusters" | "search" | "guest_uploads";

// ─── Bulk Upload Types ────────────────────────────────────────────────────────

const BATCH_SIZE    = 40;   // UI display grouping only
const MAX_RETRIES   = 3;
const CONCURRENCY   = 5;    // upload 5 files in parallel to MinIO
const ACCEPTED_EXT  = /\.(jpe?g|png|webp)$/i;

type BulkFileStatus = "pending" | "uploading" | "done" | "failed";

interface BulkFile {
  id: string;
  file: File;
  status: BulkFileStatus;
  error?: string;
}

interface BulkBatch {
  index: number;
  fileIds: string[];
  status: "pending" | "uploading" | "done" | "failed";
  error?: string;
}

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

const fmtBytes = (b: number) => {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};
const fmtSpeed = (bps: number) => {
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
};
const fmtETA = (s: number) => {
  if (!isFinite(s) || s < 0) return "—";
  if (s < 60) return `${Math.ceil(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;
};
const uid = () => Math.random().toString(36).slice(2, 10);

// ─── Bulk Upload Modal (inline) ───────────────────────────────────────────────

interface BulkUploadModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  apiUrl: string;
  authToken: string;
  planLimit: number;
  currentCount: number;
  onComplete: (count: number) => void;
}

function BulkUploadModal({
  open, onClose, eventId, apiUrl, authToken, planLimit, currentCount, onComplete,
}: BulkUploadModalProps) {
  const [phase, setPhase]               = useState<"select" | "uploading" | "done">("select");
  const [files, setFiles]               = useState<BulkFile[]>([]);
  const [batches, setBatches]           = useState<BulkBatch[]>([]);
  const [dragOver, setDragOver]         = useState(false);
  const [paused, setPaused]             = useState(false);
  const [showList, setShowList]         = useState(false);
  const [doneCount, setDoneCount]       = useState(0);
  const [failedCount, setFailedCount]   = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [speed, setSpeed]               = useState(0);
  const [eta, setEta]                   = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);

  const pausedRef       = useRef(false);
  const abortRef        = useRef<AbortController | null>(null);
  const startTimeRef    = useRef(0);
  const totalBytesRef   = useRef(0);
  const fileInputRef    = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setPhase("select"); setFiles([]); setBatches([]);
    setDragOver(false); setPaused(false); setShowList(false);
    setDoneCount(0); setFailedCount(0); setUploadedBytes(0);
    setSpeed(0); setEta(0); setCurrentBatch(0);
    totalBytesRef.current = 0;
  }, [open]);

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(f =>
      f.type.startsWith("image/") || ACCEPTED_EXT.test(f.name)
    );
    if (!valid.length) return;
    setFiles(prev => {
      const existing = new Set(prev.map(f => `${f.file.name}_${f.file.size}`));
      const deduped  = valid.filter(f => !existing.has(`${f.name}_${f.size}`));
      const slots    = planLimit - currentCount - prev.length;
      const accepted = deduped.slice(0, Math.max(0, slots));
      totalBytesRef.current += accepted.reduce((s, f) => s + f.size, 0);
      const newEntries: BulkFile[] = accepted.map(f => ({
        id: uid(), file: f, status: "pending",
      }));
      return [...prev, ...newEntries];
    });
  }, [planLimit, currentCount]);

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const startUpload = useCallback(async () => {
    if (!files.length) return;
    setPhase("uploading"); setPaused(false); pausedRef.current = false;
    startTimeRef.current = Date.now();

    // Group files into display batches (UI grouping only)
    const batchCount = Math.ceil(files.length / BATCH_SIZE);
    const batchList: BulkBatch[] = Array.from({ length: batchCount }, (_, i) => ({
      index: i,
      fileIds: files.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE).map(f => f.id),
      status: "pending",
    }));
    setBatches(batchList);

    let done = 0, failed = 0, bytesDone = 0;
    let speedSamples: number[] = [];

    const updFile  = (id: string, patch: Partial<BulkFile>) =>
      setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
    const updBatch = (i: number, patch: Partial<BulkBatch>) =>
      setBatches(prev => prev.map(b => b.index === i ? { ...b, ...patch } : b));

    // ── Step 1: Get presigned PUT URLs for all files ───────────────────────
    let presignedMap = new Map<string, { stored_filename: string; upload_url: string }>();
    let usePresign = true;

    try {
      const presignRes = await fetch(`${apiUrl}/upload/${eventId}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ filenames: files.map(f => f.file.name) }),
      });
      if (!presignRes.ok) throw new Error(`Presign HTTP ${presignRes.status}`);
      const presignData = await presignRes.json();
      for (const pf of presignData.files) {
        if (!pf.error) presignedMap.set(pf.original_filename, pf);
      }
    } catch {
      usePresign = false; // fall back to legacy multipart
    }

    // ── Step 2: Upload files ───────────────────────────────────────────────
    const confirmedUploads: Array<{ original_filename: string; stored_filename: string; file_size_bytes: number }> = [];

    for (let bi = 0; bi < batchList.length; bi++) {
      setCurrentBatch(bi);
      updBatch(bi, { status: "uploading" });

      const batch      = batchList[bi];
      const batchFiles = files.filter(f => batch.fileIds.includes(f.id));

      if (usePresign) {
        // ── Direct PUT to MinIO — PARALLEL (CONCURRENCY files at once) ────
        const uploadOne = async (bulkFile: BulkFile) => {
          while (pausedRef.current) await new Promise(r => setTimeout(r, 250));

          const presigned = presignedMap.get(bulkFile.file.name);
          if (!presigned) {
            updFile(bulkFile.id, { status: "failed", error: "No presigned URL" });
            failed++; setFailedCount(failed);
            return;
          }

          updFile(bulkFile.id, { status: "uploading" });
          let success = false, attempt = 0, lastErr = "";

          while (attempt <= MAX_RETRIES && !success) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
            try {
              const ctrl = new AbortController();
              // Store array of controllers so cancel-all still works
              abortRef.current = ctrl;
              const putRes = await fetch(presigned.upload_url, {
                method: "PUT",
                headers: { "Content-Type": bulkFile.file.type || "image/jpeg" },
                body: bulkFile.file,
                signal: ctrl.signal,
              });
              if (!putRes.ok) throw new Error(`PUT failed: HTTP ${putRes.status}`);

              bytesDone += bulkFile.file.size;
              setUploadedBytes(bytesDone);
              const elapsed = (Date.now() - startTimeRef.current) / 1000;
              if (elapsed > 0.1) {
                const inst = bytesDone / elapsed;
                speedSamples = [...speedSamples.slice(-4), inst];
                const avg = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
                setSpeed(avg);
                setEta(avg > 0 ? (totalBytesRef.current - bytesDone) / avg : 0);
              }
              confirmedUploads.push({
                original_filename: bulkFile.file.name,
                stored_filename:   presigned.stored_filename,
                file_size_bytes:   bulkFile.file.size,
              });
              done++; setDoneCount(done);
              updFile(bulkFile.id, { status: "done" });
              success = true;
            } catch (e: unknown) {
              attempt++;
              lastErr = e instanceof Error ? e.message : "Unknown error";
              if (e instanceof Error && e.name === "AbortError") break;
            }
          }
          if (!success) {
            failed++; setFailedCount(failed);
            updFile(bulkFile.id, { status: "failed", error: lastErr });
          }
        };

        // Run CONCURRENCY workers pulling from a shared queue
        const queue = [...batchFiles];
        const workers = Array.from({ length: Math.min(CONCURRENCY, batchFiles.length) }, async () => {
          while (queue.length > 0) {
            const file = queue.shift()!;
            await uploadOne(file);
          }
        });
        await Promise.all(workers);

      } else {
        // ── Legacy multipart fallback ──────────────────────────────────────
        batchFiles.forEach(f => updFile(f.id, { status: "uploading" }));
        let success = false, attempt = 0, lastErr = "";
        while (attempt <= MAX_RETRIES && !success) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt));
          try {
            const ctrl = new AbortController();
            abortRef.current = ctrl;
            const form = new FormData();
            batchFiles.forEach(f => form.append("files", f.file));
            const res = await fetch(`${apiUrl}/upload/${eventId}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${authToken}` },
              body: form,
              signal: ctrl.signal,
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ detail: "Upload failed" }));
              throw new Error(err.detail ?? `HTTP ${res.status}`);
            }
            bytesDone += batchFiles.reduce((s, f) => s + f.file.size, 0);
            setUploadedBytes(bytesDone);
            done += batchFiles.length; setDoneCount(done);
            updBatch(bi, { status: "done" });
            batchFiles.forEach(f => updFile(f.id, { status: "done" }));
            success = true;
          } catch (e: unknown) {
            attempt++;
            lastErr = e instanceof Error ? e.message : "Unknown error";
            if (e instanceof Error && e.name === "AbortError") break;
          }
        }
        if (!success) {
          failed += batchFiles.length; setFailedCount(failed);
          updBatch(bi, { status: "failed", error: lastErr });
          batchFiles.forEach(f => updFile(f.id, { status: "failed", error: lastErr }));
          continue;
        }
      }

      updBatch(bi, { status: "done" });
    }

    // ── Step 3: Confirm uploads with backend (presign flow only) ──────────
    if (usePresign && confirmedUploads.length > 0) {
      try {
        await fetch(`${apiUrl}/upload/${eventId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ uploads: confirmedUploads }),
        });
      } catch (e) {
        console.error("Confirm step failed:", e);
      }
    }

    setPhase("done");
    onComplete(done);
  }, [files, apiUrl, eventId, authToken, onComplete]);

  const retryFailed = useCallback(async () => {
    const failed = batches.filter(b => b.status === "failed");
    if (!failed.length) return;
    pausedRef.current = false; setPaused(false);

    const updFile  = (id: string, patch: Partial<BulkFile>) =>
      setFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
    const updBatch = (i: number, patch: Partial<BulkBatch>) =>
      setBatches(prev => prev.map(b => b.index === i ? { ...b, ...patch } : b));

    let newDone = doneCount, newFailed = failedCount;

    for (const batch of failed) {
      const batchFiles = files.filter(f => batch.fileIds.includes(f.id));
      updBatch(batch.index, { status: "uploading", error: undefined });
      batchFiles.forEach(f => updFile(f.id, { status: "uploading", error: undefined }));
      try {
        const form = new FormData();
        batchFiles.forEach(f => form.append("files", f.file));
        const res = await fetch(`${apiUrl}/upload/${eventId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: "Upload failed" }));
          throw new Error(err.detail ?? `HTTP ${res.status}`);
        }
        newDone += batchFiles.length; newFailed -= batchFiles.length;
        updBatch(batch.index, { status: "done" });
        batchFiles.forEach(f => updFile(f.id, { status: "done" }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        updBatch(batch.index, { status: "failed", error: msg });
        batchFiles.forEach(f => updFile(f.id, { status: "failed", error: msg }));
      }
    }
    setDoneCount(newDone); setFailedCount(newFailed);
    if (newFailed === 0) { setPhase("done"); onComplete(newDone); }
  }, [batches, files, apiUrl, eventId, authToken, doneCount, failedCount, onComplete]);

  const togglePause = () => {
    if (paused) { pausedRef.current = false; setPaused(false); }
    else        { pausedRef.current = true;  setPaused(true);  }
  };

  const handleClose = () => {
    if (phase === "uploading") {
      if (!confirm("Cancel the upload in progress?")) return;
      abortRef.current?.abort();
      pausedRef.current = false;
    }
    onClose();
  };

  const totalFiles   = files.length;
  const totalBatches = batches.length || Math.ceil(totalFiles / BATCH_SIZE);
  const progressPct  = totalFiles > 0 ? Math.round((doneCount / totalFiles) * 100) : 0;
  const totalSizeMB  = (totalBytesRef.current / 1024 / 1024).toFixed(1);
  const uploadedMB   = (uploadedBytes / 1024 / 1024).toFixed(1);
  const slotsLeft    = planLimit - currentCount;

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.88)" }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(160deg, #111114 0%, #0d0d10 100%)",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.08)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.25)" }}>
                <CloudUpload size={15} className="text-indigo-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white tracking-tight">Bulk Upload</h2>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {slotsLeft.toLocaleString()} slots remaining · {planLimit.toLocaleString()} total limit
                </p>
              </div>
            </div>
            <button onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
              style={{ background: "rgba(255,255,255,0.04)" }}>
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">

            {/* ── SELECT phase ── */}
            {phase === "select" && (
              <div className="p-6 flex flex-col gap-5">
                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="relative rounded-xl cursor-pointer flex flex-col items-center justify-center gap-3 py-12 px-8 text-center select-none transition-all duration-200"
                  style={{
                    border: `1.5px dashed ${dragOver ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.09)"}`,
                    background: dragOver ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)",
                  }}
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors"
                    style={{
                      background: dragOver ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                    }}>
                    <ImagePlus size={20} className={dragOver ? "text-indigo-400" : "text-zinc-500"} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {dragOver ? "Drop to add images" : "Drop images here"}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      or <span className="text-indigo-400 font-medium">click to browse</span>
                      {" "}· JPG, PNG, WebP · up to {slotsLeft.toLocaleString()} files
                    </p>
                  </div>
                  {totalFiles > 0 && (
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                      style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}>
                      <FileImage size={10} />
                      {totalFiles.toLocaleString()} files · {Math.ceil(totalFiles / BATCH_SIZE)} batches
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ""; }} />
                </div>

                {/* Stats */}
                {totalFiles > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Files",   value: totalFiles.toLocaleString(),              icon: FileImage },
                      { label: "Batches", value: Math.ceil(totalFiles / BATCH_SIZE).toString(), icon: Zap     },
                      { label: "Size",    value: `${totalSizeMB} MB`,                       icon: Upload   },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label} className="rounded-xl p-3"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
                          <Icon size={11} />
                          <span className="text-[10px] uppercase tracking-wide font-medium">{label}</span>
                        </div>
                        <span className="text-base font-semibold text-zinc-200">{value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Info banner */}
                {totalFiles > 0 && (
                  <div className="rounded-xl p-3.5 flex gap-3 items-start text-[12px]"
                    style={{ background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.14)" }}>
                    <Zap size={13} className="text-indigo-400 mt-0.5 shrink-0" />
                    <div className="text-zinc-400 leading-relaxed">
                      Files upload in <strong className="text-zinc-300">{Math.ceil(totalFiles / BATCH_SIZE)} batches of {BATCH_SIZE}</strong>.
                      Failed batches can be retried individually. You can pause at any time.
                    </div>
                  </div>
                )}

                {/* File list preview */}
                {totalFiles > 0 && (
                  <>
                    <button onClick={() => setShowList(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-[12px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <span>Preview file list ({totalFiles})</span>
                      {showList ? <ChevronDown size={13} className="rotate-180" /> : <ChevronDown size={13} />}
                    </button>
                    {showList && (
                      <div className="rounded-xl overflow-hidden max-h-52 overflow-y-auto"
                        style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                        {files.map(f => (
                          <div key={f.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] group"
                            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <FileImage size={11} className="text-zinc-600 shrink-0" />
                            <span className="text-[11px] text-zinc-400 truncate flex-1">{f.file.name}</span>
                            <span className="text-[10px] text-zinc-600">{fmtBytes(f.file.size)}</span>
                            <button onClick={() => removeFile(f.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── UPLOADING phase ── */}
            {phase === "uploading" && (
              <div className="p-6 flex flex-col gap-5">
                {/* Main bar */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-zinc-200">
                      {paused ? "⏸ Paused" : "Uploading…"}
                    </span>
                    <span className="text-sm font-bold text-zinc-200">{progressPct}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <motion.div className="h-full rounded-full"
                      style={{
                        background: paused
                          ? "linear-gradient(90deg,#f59e0b,#d97706)"
                          : "linear-gradient(90deg,#6366f1,#818cf8)",
                        boxShadow: paused ? "0 0 12px rgba(245,158,11,0.4)" : "0 0 12px rgba(99,102,241,0.5)",
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPct}%` }}
                      transition={{ ease: "easeOut", duration: 0.4 }} />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[11px] text-zinc-500">
                    <span>{doneCount.toLocaleString()} / {totalFiles.toLocaleString()} files</span>
                    <span>{uploadedMB} / {totalSizeMB} MB</span>
                  </div>
                </div>

                {/* Speed / ETA / Batch */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Speed", value: paused ? "—" : fmtSpeed(speed),          color: "#818cf8", icon: Zap    },
                    { label: "ETA",   value: paused ? "—" : fmtETA(eta),              color: "#34d399", icon: Clock  },
                    { label: "Batch", value: `${currentBatch + 1} / ${totalBatches}`, color: "#f59e0b", icon: Upload },
                  ].map(({ label, value, color, icon: Icon }) => (
                    <div key={label} className="rounded-xl p-3"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="flex items-center gap-1.5 mb-1 text-zinc-500">
                        <Icon size={11} color={color} />
                        <span className="text-[10px] uppercase tracking-wide font-medium">{label}</span>
                      </div>
                      <span className="text-sm font-semibold text-zinc-200">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Batch list */}
                <div>
                  <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide mb-2">Batch Progress</p>
                  <div className="rounded-xl overflow-hidden max-h-52 overflow-y-auto"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    {batches.map(b => (
                      <div key={b.index} className="flex items-center gap-3 px-4 py-2.5"
                        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                          {b.status === "done"      && <CheckCircle2 size={14} className="text-emerald-400" />}
                          {b.status === "failed"    && <XCircle      size={14} className="text-red-400"     />}
                          {b.status === "uploading" && <Loader2      size={14} className="text-indigo-400 animate-spin" />}
                          {b.status === "pending"   && <div className="w-2 h-2 rounded-full bg-zinc-700" />}
                        </div>
                        <span className="text-[12px] text-zinc-400 flex-1">
                          Batch {b.index + 1}
                          <span className="text-zinc-600 ml-2">({b.fileIds.length} files)</span>
                        </span>
                        {b.status === "failed"  && b.error  && (
                          <span className="text-[10px] text-red-400 truncate max-w-[130px]" title={b.error}>{b.error}</span>
                        )}
                        {b.status === "done" && (
                          <span className="text-[10px] text-emerald-500 font-medium">Done</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {failedCount > 0 && (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-[12px]"
                    style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <AlertTriangle size={13} className="text-red-400 shrink-0" />
                    <span className="text-red-300">{failedCount} files failed — you can retry after upload completes.</span>
                  </div>
                )}
              </div>
            )}

            {/* ── DONE phase ── */}
            {phase === "done" && (
              <div className="p-6 flex flex-col items-center gap-5 py-10">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{
                    background: failedCount > 0 ? "rgba(245,158,11,0.12)" : "rgba(52,211,153,0.12)",
                    border: `1px solid ${failedCount > 0 ? "rgba(245,158,11,0.25)" : "rgba(52,211,153,0.25)"}`,
                  }}>
                  {failedCount > 0
                    ? <AlertTriangle size={28} className="text-amber-400" />
                    : <CheckCircle2  size={28} className="text-emerald-400" />}
                </div>
                <div className="text-center">
                  <h3 className="text-base font-semibold text-zinc-100">
                    {failedCount > 0 ? "Upload Partially Complete" : "All Done!"}
                  </h3>
                  <p className="text-sm text-zinc-400 mt-1.5">
                    <span className="text-emerald-400 font-semibold">{doneCount.toLocaleString()}</span> files uploaded
                    {failedCount > 0 && (
                      <> · <span className="text-red-400 font-semibold">{failedCount.toLocaleString()}</span> failed</>
                    )}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3 w-full">
                  {[
                    { l: "Uploaded", v: doneCount.toLocaleString(),   c: "#34d399" },
                    { l: "Failed",   v: failedCount.toLocaleString(), c: failedCount > 0 ? "#f87171" : "#6b7280" },
                    { l: "Total",    v: totalFiles.toLocaleString(),   c: "#818cf8" },
                  ].map(({ l, v, c }) => (
                    <div key={l} className="rounded-xl p-3 text-center"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">{l}</div>
                      <div className="text-lg font-bold" style={{ color: c }}>{v}</div>
                    </div>
                  ))}
                </div>
                {failedCount > 0 && (
                  <button onClick={retryFailed}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc" }}>
                    <RotateCcw size={13} /> Retry {failedCount} Failed Files
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 flex items-center justify-between border-t border-white/5 gap-3">
            <div>
              {phase === "select" && (
                <span className="text-xs text-zinc-600">
                  {totalFiles > 0 ? `${totalFiles.toLocaleString()} files · ${totalSizeMB} MB` : "No files selected"}
                </span>
              )}
              {phase === "uploading" && (
                <button onClick={togglePause}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: paused ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.05)",
                    border: paused ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(255,255,255,0.08)",
                    color: paused ? "#fbbf24" : "#a1a1aa",
                  }}>
                  {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {phase === "done" && (
                <button onClick={onClose}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-zinc-200 transition-all"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  Close
                </button>
              )}
              {phase === "select" && (
                <>
                  <button onClick={handleClose}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-500 hover:text-zinc-300 transition-colors">
                    Cancel
                  </button>
                  <button onClick={startUpload} disabled={totalFiles === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: totalFiles > 0 ? "linear-gradient(135deg,#6366f1,#4f46e5)" : "rgba(99,102,241,0.15)",
                      border: "1px solid rgba(99,102,241,0.3)",
                      color: "#fff",
                      boxShadow: totalFiles > 0 ? "0 0 20px rgba(99,102,241,0.25)" : "none",
                    }}>
                    <CloudUpload size={14} />
                    Upload {totalFiles > 0 ? `${totalFiles.toLocaleString()} Files` : "Files"}
                  </button>
                </>
              )}
              {phase === "uploading" && (
                <button onClick={handleClose}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-500 hover:text-red-400 transition-colors">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

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

  const [clusters,           setClusters]           = useState<ClusterItem[]>([]);
  const [clustersMeta,       setClustersMeta]       = useState<ClustersMeta | null>(null);
  const [clustersLoading,    setClustersLoading]    = useState(false);
  const [clustersLoadingMore,setClustersLoadingMore]= useState(false);
  const [clustersPage,       setClustersPage]       = useState(1);
  const [expanded,           setExpanded]           = useState<number | null>(null);
  const clusterSentinelRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;

  const [scenes,          setScenes]          = useState<SceneItem[]>([]);
  const [sceneFilter,     setSceneFilter]     = useState<string | null>(null);
  const [objectFilter,    setObjectFilter]    = useState<string | null>(null);

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

  // ── Bulk upload state (replaces old uploading/uploadDragOver/uploadSuccess) ──
  const [bulkUploadOpen,  setBulkUploadOpen]  = useState(false);
  const [uploadSuccess,   setUploadSuccess]   = useState(false);
  const [uploadDragOver,  setUploadDragOver]  = useState(false);

  // ── QR Code & Watermark state ──
  const [showQR, setShowQR] = useState(false);
  const [showWatermark, setShowWatermark] = useState(false);
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(DEFAULT_WATERMARK_CONFIG);
  const [watermarkSaving, setWatermarkSaving] = useState(false);

  // ── PIN state ──
  const [pinEnabled,    setPinEnabled]    = useState(false);
  const [currentPin,    setCurrentPin]    = useState<string | null>(null);
  const [showPinModal,  setShowPinModal]  = useState(false);
  const [pinInput,      setPinInput]      = useState('');
  const [pinSaving,     setPinSaving]     = useState(false);
  const [pinRemoving,   setPinRemoving]   = useState(false);

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
          if (data.processing_status !== "processing") clearInterval(interval);
        }
      } catch (e) { console.error("Failed to reload event progress", e); }
    }, 5000);
    return () => clearInterval(interval);
  }, [event?.processing_status, eventId]);

  // ─── Reset filters when switching tabs ──────────────────────────────────
  useEffect(() => {
    if (view !== "clusters") setSceneFilter(null);
    if (view !== "search")   setObjectFilter(null);
  }, [view]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ─── Bulk upload completion callback ─────────────────────────────────────
  const handleBulkUploadComplete = useCallback(async (count: number) => {
    if (count > 0) {
      showToast(`✓ ${count} photo${count !== 1 ? "s" : ""} uploaded`);
      setUploadSuccess(true);
      await loadEvent();
    }
  }, []); // loadEvent defined below — forward ref pattern via useRef

  const handleBulkUploadCompleteRef = useRef(handleBulkUploadComplete);
  useEffect(() => { handleBulkUploadCompleteRef.current = handleBulkUploadComplete; }, [handleBulkUploadComplete]);

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
    } catch { showToast("Download failed"); }
  };

  // ─── Load event ──────────────────────────────────────────────────────
  const loadEvent = useCallback(async () => {
    try {
      const res = await fetch(`${API}/events/${eventId}`, { headers: authH() });
      if (!res.ok) throw new Error();
      const data: EventDetail = await res.json();
      setEvent(data);
      
      // 🎨 Load watermark config from event data
      if (data.watermark_enabled && data.watermark_config) {
        setWatermarkConfig({
          ...DEFAULT_WATERMARK_CONFIG,
          ...data.watermark_config,
          enabled: true,
        });
      }
      // 🔒 Sync PIN status
      // PIN is hashed server-side and cannot be retrieved.
      // Default PIN is "0000" (from .env). Owner can change it via the PIN modal.
      // We preserve the PIN the owner set this session; fall back to "0000" if unknown.
      setPinEnabled(!!data.pin_enabled);
      if (!data.pin_enabled) {
        setCurrentPin(null);
      } else {
        // Fetch the real current PIN from the server
        try {
          const pinRes = await fetch(`${API}/events/${eventId}/pin-value`, { headers: authH() });
          if (pinRes.ok) {
            const pinData = await pinRes.json();
            setCurrentPin(pinData.pin ?? null);
          }
        } catch {
          setCurrentPin(null); // silently fail — UI shows "••••" fallback
        }
      }
    } catch {
      showToast("Failed to load event");
    } finally {
      setEventLoading(false);
    }
  }, [eventId]);

  useEffect(() => { loadEvent(); }, [loadEvent]);

  // ─── Load clusters (paginated) + scenes ────────────────────────────────
  const loadClusters = useCallback(async (page = 1) => {
    if (page === 1) setClustersLoading(true);
    else            setClustersLoadingMore(true);
    try {
      const fetches: Promise<Response>[] = [
        fetch(`${API}/events/${eventId}/clusters?page=${page}&page_size=${PAGE_SIZE}`, { headers: authH() }),
      ];
      if (page === 1) fetches.push(fetch(`${API}/events/${eventId}/scenes`, { headers: authH() }));
      const [clusterRes, scenesRes] = await Promise.all(fetches);
      if (!clusterRes.ok) throw new Error();
      const data = await clusterRes.json();
      setClusters(prev => page === 1 ? data.clusters : [...prev, ...data.clusters]);
      setClustersMeta({ total_clusters: data.total_clusters, total_images: data.total_images, has_more: data.has_more });
      setClustersPage(page);
      if (scenesRes?.ok) {
        const sd = await scenesRes.json();
        setScenes(sd.scenes ?? []);
      }
    } catch { showToast("Failed to load clusters"); }
    finally {
      setClustersLoading(false);
      setClustersLoadingMore(false);
    }
  }, [eventId]);

  useEffect(() => { if (view === "clusters" && clusters.length === 0) loadClusters(1); }, [view]);

  // ─── IntersectionObserver infinite scroll ────────────────────────────────
  const hasMoreRef        = useRef(false);
  const loadingMoreRef    = useRef(false);
  const clustersPageRef   = useRef(1);
  const loadClustersRef   = useRef(loadClusters);

  useEffect(() => { hasMoreRef.current      = clustersMeta?.has_more ?? false; }, [clustersMeta?.has_more]);
  useEffect(() => { loadingMoreRef.current  = clustersLoadingMore;              }, [clustersLoadingMore]);
  useEffect(() => { clustersPageRef.current = clustersPage;                    }, [clustersPage]);
  useEffect(() => { loadClustersRef.current = loadClusters;                    }, [loadClusters]);

  useEffect(() => {
    const sentinel = clusterSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMoreRef.current && !loadingMoreRef.current)
          loadClustersRef.current(clustersPageRef.current + 1);
      },
      { rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    } catch { showToast("Failed to toggle visibility"); }
    finally { setToggling(false); }
  };

  // ─── Copy public link ────────────────────────────────────────────────────
  const copyLink = () => {
    if (!event) return;
    // Copy owner link (with PIN) for frictionless access
    navigator.clipboard.writeText(ownerPageUrl);
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
      setClusters([]); setClustersMeta(null); setClustersPage(1);
      setScenes([]); setUploadSuccess(false);
      await loadEvent();
    } catch { showToast("Failed to start processing"); }
    finally { setReprocessing(false); }
  };

  // ─── Delete event ────────────────────────────────────────────────────────
  const deleteEvent = async () => {
    if (!event) return;
    if (!confirm(`Delete "${event.name}"?\n\nAll images and face data will be permanently removed.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API}/events/${event.id}`, { method: "DELETE", headers: authH() });
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
      setGuestUploads(await res.json());
    } catch { showToast("Failed to load guest uploads"); }
    finally { setGuestUploadsLoading(false); }
  }, [eventId]);

  useEffect(() => { if (view === "guest_uploads") loadGuestUploads(); }, [view]);

  const approveUpload = async (id: number) => {
    setApprovingId(id);
    try {
      const res = await fetch(`${API}/events/${eventId}/guest-uploads/${id}/approve`, {
        method: "POST", headers: authH(),
      });
      if (!res.ok) throw new Error();
      showToast("✓ Photo approved & queued for processing");
      await loadGuestUploads();
      await loadEvent();
    } catch { showToast("Failed to approve photo"); }
    finally { setApprovingId(null); }
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
    } catch { showToast("Failed to reject photo"); }
    finally { setRejectingId(null); }
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
      await loadEvent();
    } catch { showToast("Bulk approve failed"); }
    finally { setBulkActioning(false); }
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
    } catch { showToast("Bulk reject failed"); }
    finally { setBulkActioning(false); }
  };

  // ─── Owner face search ───────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setSearching(true); setSearchResult(null); setSearchError(null); setObjectFilter(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/events/${eventId}/search`, {
        method: "POST", headers: authH(), body: form,
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
    } catch { showToast("Camera access denied"); setCameraOpen(false); }
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
  const jwtToken     = () => localStorage.getItem("token") ?? "";
  const thumbUrl     = (n: string)   => `${API}/events/${eventId}/thumbnail/${n}?token=${jwtToken()}`;
  const imgUrl       = (n: string)   => `${API}/events/${eventId}/image/${n}?token=${jwtToken()}`;
  const dlUrl        = (n: string)   => `${API}/events/${eventId}/download/${n}`;
  const clusterDlUrl = (cid: number) =>
  `${API}/events/${eventId}/clusters/${cid}/download?token=${jwtToken()}`;

  const publicPageUrl = typeof window !== "undefined"
    ? `${window.location.origin}/public/${event?.public_token ?? ""}`
    : `/public/${event?.public_token ?? ""}`;

  // Owner link — embeds PIN for one-tap frictionless access
  // AFTER — plain URL, no PIN exposed
  const ownerPageUrl = publicPageUrl;

  const coverImageUrl = event?.cover_image_url ?? null;

  const isFree      = event?.plan_type === "free";
  const isPro       = !isFree; // Pro or Enterprise
  const canDownload = !isFree;

  // ─── Photo quota: use event.photo_quota (pay-per-event) with plan fallback ──
  const planLimit = event?.photo_quota
    ?? (event?.plan_type === "enterprise" ? 100000
      : event?.plan_type === "pro"        ? 10000
      : 1000);

  // ═══════════════════════════════════════════════════════════════
  // 🎨 WATERMARK SAVE TO BACKEND API
  // ═══════════════════════════════════════════════════════════════
  const handleSaveWatermark = useCallback(async (config: WatermarkConfig) => {
    setWatermarkConfig(config);
    setWatermarkSaving(true);
    
    // Save to backend API using FormData (backend expects Form parameters)
    try {
      const formData = new FormData();
      formData.append('enabled', String(config.enabled));
      formData.append('type', config.type);
      
      // Text watermark options
      if (config.text) formData.append('text', config.text);
      if (config.textSize) formData.append('textSize', String(config.textSize));
      if (config.textOpacity) formData.append('textOpacity', String(config.textOpacity));
      if (config.textPosition) formData.append('textPosition', config.textPosition);
      if (config.textColor) formData.append('textColor', config.textColor);
      if (config.textFont) formData.append('textFont', config.textFont);
      
      // Logo watermark options
      if (config.logoUrl) formData.append('logoUrl', config.logoUrl);
      if (config.logoSize) formData.append('logoSize', String(config.logoSize));
      if (config.logoOpacity) formData.append('logoOpacity', String(config.logoOpacity));
      if (config.logoPosition) formData.append('logoPosition', config.logoPosition);
      
      // Advanced options
      formData.append('padding', String(config.padding ?? 20));
      formData.append('rotation', String(config.rotation ?? 0));
      formData.append('tile', String(config.tile ?? false));
      
      const res = await fetch(`${API}/events/${eventId}/watermark`, {
        method: 'PUT',
        headers: authH(),  // Don't set Content-Type, let browser set it with boundary
        body: formData,
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save watermark settings');
      }
      
      // Also save to localStorage as backup/cache
      localStorage.setItem(`watermark_${eventId}`, JSON.stringify(config));
      showToast('Watermark settings saved!');
    } catch (error) {
      console.error('Failed to save watermark:', error);
      showToast(error instanceof Error ? error.message : 'Failed to save watermark settings');
    } finally {
      setWatermarkSaving(false);
    }
  }, [eventId, API]);

  // ─── PIN handlers ────────────────────────────────────────────────────────
  const savePin = async () => {
    if (!/^\d{4}$/.test(pinInput)) { showToast("PIN must be exactly 4 digits"); return; }
    setPinSaving(true);
    try {
      const res = await fetch(`${API}/events/${eventId}/pin`, {
        method: "PUT",
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (!res.ok) throw new Error();
      setPinEnabled(true);
      setCurrentPin(pinInput);
      setShowPinModal(false);
      setPinInput("");
      showToast("🔒 PIN updated");
    } catch { showToast("Failed to set PIN"); }
    finally { setPinSaving(false); }
  };

  const removePin = async () => {
    if (!confirm("Remove PIN protection? Anyone with the link can access the event.")) return;
    setPinRemoving(true);
    try {
      const res = await fetch(`${API}/events/${eventId}/pin`, {
        method: "DELETE", headers: authH(),
      });
      if (!res.ok) throw new Error();
      setPinEnabled(false);
      setCurrentPin(null);
      showToast("🔓 PIN protection removed");
    } catch { showToast("Failed to remove PIN"); }
    finally { setPinRemoving(false); }
  };

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

  const isCompleted      = event.processing_status === "completed";
  //const hasPendingImages = uploadSuccess && event.image_count > 0 && event.processing_status !== "processing";
  const hasPendingImages = ((event as any).has_new_photos || uploadSuccess) 
                        && event.processing_status !== "processing";


  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 antialiased">

      {/* Ambient glow */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[700px] h-56 rounded-full bg-indigo-700/8 blur-[120px] z-0" />

      {/* ── TOAST ── */}
      <AnimatePresence>
        {toast && (
          <motion.div key="toast"
            initial={{ opacity: 0, y: -10, x: "-50%" }}
            animate={{ opacity: 1, y: 0,   x: "-50%" }}
            exit={{ opacity: 0,   y: -10,  x: "-50%" }}
            className="fixed top-4 left-1/2 z-[999] bg-zinc-800 border border-zinc-700 text-xs font-medium px-4 py-2.5 rounded-xl shadow-xl whitespace-nowrap">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SEARCH OVERLAY ── */}
      <AnimatePresence>
        {searching && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[998]">
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
              <img src={coverImageUrl} className="w-full h-full object-cover opacity-10 blur-sm scale-110" aria-hidden />
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
                  {hasPendingImages && event.processing_status !== "processing" && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      onClick={startProcessing} disabled={reprocessing}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-colors disabled:opacity-60 border border-orange-500/50">
                      {reprocessing ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                      Process Images
                    </motion.button>
                  )}

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
                      <a href={ownerPageUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors">
                        <ExternalLink size={12} />Open public page
                      </a>
                      {/* QR Code Button */}
                      <button onClick={() => setShowQR(true)}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-colors">
                        <QrCode size={12} />QR Code
                      </button>
                      {/* Watermark Button (Pro) */}
                      {isPro && (
                        <button onClick={() => setShowWatermark(true)}
                          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                            watermarkConfig.enabled
                              ? "bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20"
                              : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                          }`}>
                          <Droplet size={12} />Watermark
                        </button>
                      )}
                      {/* PIN Button */}
                      <button
                        onClick={() => setShowPinModal(true)}
                        disabled={pinRemoving}
                        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                          pinEnabled
                            ? "bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20"
                            : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                        }`}>
                        {pinRemoving ? <Loader2 size={12} className="animate-spin" /> :
                          pinEnabled ? <Lock size={12} /> : <LockOpen size={12} />}
                        {pinEnabled ? `PIN: ${currentPin ?? "••••"}` : "Set PIN"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Progress bar */}
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
              { id: "overview",      label: "Overview",      icon: <BarChart2   size={13} /> },
              { id: "clusters",      label: "Clusters",      icon: <Grid3X3     size={13} />, guard: !isCompleted },
              { id: "search",        label: "Face Search",   icon: <Search      size={13} />, guard: !isCompleted },
              { id: "guest_uploads", label: "Guest Uploads", icon: <CloudUpload size={13} />,
                badge: guestUploads?.total_pending ?? (event as any)?.pending_guest_uploads ?? 0 },
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
                    { l: "Progress", v: `${Math.min(Math.max(event.processing_progress, 0), 100)}%`, icon: <BarChart2 size={16} />, c: "emerald" },
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

                {/* 💰 Quota bar — shows photo + guest quota usage for pay-per-event */}
                {event.photo_quota != null && (
                  <div className="mb-6">
                    <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
                      Event Quota
                    </h3>
                    <EventQuotaBar
                      eventId={parseInt(eventId)}
                      showGuestToggle={true}
                      onToggleGuest={(enabled) => {
                        setEvent(e => e ? { ...e, guest_upload_enabled: enabled } : e);
                      }}
                    />
                  </div>
                )}

                {/* ── UPLOAD CARD (bulk upload) ── */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mb-4">
                  <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">Upload Photos</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Add images · {(event.image_count ?? 0).toLocaleString()} uploaded so far · up to {planLimit.toLocaleString()} quota
                      </p>
                      <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                        <AlertTriangle size={11} />
                        Processing required after upload to enable face search
                      </p>
                    </div>
                    <button onClick={startProcessing}
                      disabled={reprocessing || event.processing_status === "processing"}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-60 flex-shrink-0">
                      {reprocessing || event.processing_status === "processing"
                        ? <Loader2 size={12} className="animate-spin" />
                        : <Play size={12} />}
                      {event.processing_status === "processing" ? "Processing..." : "Process Images"}
                    </button>
                  </div>

                  {/* Bulk upload drop zone */}
                  <div
                    className={`flex flex-col items-center justify-center gap-3 p-8 cursor-pointer transition-colors ${
                      uploadDragOver ? "bg-indigo-500/5 border-indigo-500/20" : "hover:bg-zinc-800/40"
                    }`}
                    onDragOver={e  => { e.preventDefault(); setUploadDragOver(true); }}
                    onDragLeave={() => setUploadDragOver(false)}
                    onDrop={e => {
                      e.preventDefault(); setUploadDragOver(false);
                      // If files dropped here, open bulk modal pre-loaded
                      if (e.dataTransfer.files?.length) {
                        setBulkUploadOpen(true);
                      }
                    }}
                    onClick={() => setBulkUploadOpen(true)}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${
                      uploadDragOver
                        ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-400"
                        : "bg-zinc-800 border-zinc-700 text-zinc-400"
                    }`}>
                      <CloudUpload size={16} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-200">
                        {uploadDragOver ? "Drop to open bulk uploader" : "Click or drop photos to upload"}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Bulk upload · up to 5,000 images · chunked with real-time progress
                      </p>
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      {[
                        { icon: <Zap size={10} />,       label: "Chunked batches" },
                        { icon: <Pause size={10} />,     label: "Pause & resume"  },
                        { icon: <RotateCcw size={10} />, label: "Retry failed"    },
                      ].map(({ icon, label }) => (
                        <span key={label} className="flex items-center gap-1 text-[10px] text-zinc-600">
                          {icon}{label}
                        </span>
                      ))}
                    </div>
                  </div>

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
                      { id: "clusters" as ViewMode, label: "Browse Clusters", sub: "Photos grouped by face identity", icon: <Grid3X3 size={15} />, accent: "indigo" },
                      { id: "search"   as ViewMode, label: "Face Search",      sub: "Upload a selfie to find matches",  icon: <Search  size={15} />, accent: "blue"   },
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
                <PeopleGallery
                  clusters={clusters}
                  clustersMeta={clustersMeta}
                  clustersLoading={clustersLoading}
                  clustersLoadingMore={clustersLoadingMore}
                  scenes={scenes}
                  isFree={isFree}
                  thumbUrl={thumbUrl}
                  clusterDlUrl={clusterDlUrl}
                  authH={authH}
                  showToast={showToast}
                  onLoadMore={() => loadClusters(clustersPage + 1)}
                  sentinelRef={clusterSentinelRef}
                />
              </motion.div>
            )}

            {/* ──────────── FACE SEARCH ──────────── */}
            {view === "search" && (
              <motion.div key="search"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="max-w-2xl mx-auto">

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-5">
                  <div className="px-5 py-4 border-b border-zinc-800">
                    <p className="text-sm font-semibold">Owner Face Search</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Upload or capture a face — shows similarity score and cluster ID per match
                    </p>
                  </div>

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

                {searchError && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 bg-red-500/8 border border-red-500/20 rounded-xl p-4 mb-5">
                    <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                    <p className="text-xs text-red-300">{searchError}</p>
                  </motion.div>
                )}

                <AnimatePresence>
                  {searchResult && searchResult.total_matches > 0 && (
                    <motion.div id="search-results"
                      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28 }}
                      className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

                      <div className="px-5 py-4 border-b border-zinc-800">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-sm font-semibold">
                              {searchResult.total_matches} Match{searchResult.total_matches !== 1 ? "es" : ""} Found
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              Sorted by similarity · green = strict · amber = normal match
                            </p>
                          </div>
                        </div>

                        {(() => {
                          const allObjects = [...new Set(
                            searchResult.matches.flatMap(m => m.objects ?? [])
                          )].slice(0, 8);
                          if (!allObjects.length) return null;
                          return (
                            <div className="flex flex-wrap gap-2 mt-3">
                              <button onClick={() => setObjectFilter(null)}
                                className={`text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
                                  objectFilter === null
                                    ? "bg-violet-500/20 border-violet-500/30 text-violet-300"
                                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                                }`}>All objects</button>
                              {allObjects.map(obj => (
                                <button key={obj} onClick={() => setObjectFilter(objectFilter === obj ? null : obj)}
                                  className={`text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors capitalize ${
                                    objectFilter === obj
                                      ? "bg-violet-500/20 border-violet-500/30 text-violet-300"
                                      : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700"
                                  }`}>
                                  {obj}
                                </button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="p-4">
                        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
                          {searchResult.matches
                            .filter(m => !objectFilter || (m.objects ?? []).includes(objectFilter))
                            .map((match, i) => (
                              <motion.div key={`${match.image_name}-${i}`}
                                initial={{ opacity: 0, scale: 0.92 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: Math.min(i * 0.02, 0.45) }}
                                className="group relative rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 cursor-pointer transition-all hover:scale-[1.03] bg-zinc-800 aspect-[4/5]"
                                onClick={() => openPreview(match.image_name, searchResult.matches.map(m => m.image_name), i)}>
                                <img src={thumbUrl(match.image_name)} className="w-full h-full object-cover block" loading="lazy" />
                                <div className="absolute top-1.5 left-1.5 bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5 pointer-events-none">
                                  <span className={`text-[9px] font-bold ${
                                    match.similarity >= 0.62 ? "text-emerald-400" :
                                    match.similarity >= 0.55 ? "text-amber-400"   : "text-zinc-400"
                                  }`}>{(match.similarity * 100).toFixed(0)}%</span>
                                </div>
                                <div className="absolute top-1.5 right-1.5 bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5 pointer-events-none">
                                  <span className="text-[9px] text-zinc-400 font-mono">#{match.cluster_id}</span>
                                </div>
                                {match.scene_label && (
                                  <div className="absolute bottom-1.5 left-1.5 bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5 pointer-events-none">
                                    <span className="text-[9px] text-zinc-300 capitalize">{match.scene_label}</span>
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                  <button onClick={e => { e.stopPropagation(); openPreview(match.image_name, searchResult.matches.map(m => m.image_name), i); }}
                                    className="w-7 h-7 rounded-lg bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                                    <ZoomIn size={11} />
                                  </button>
                                  {canDownload && (
                                    <button onClick={e => { e.stopPropagation(); handleDownload(dlUrl(match.image_name), match.image_name); }}
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
                  <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <CloudUpload size={28} className="text-zinc-700" />
                    <p className="text-sm text-zinc-500">No guest uploads yet</p>
                  </div>
                ) : (
                  <>
                    {/* Header + bulk actions */}
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h2 className="text-sm font-semibold">Guest Uploads</h2>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {guestUploads.total_pending} pending approval
                        </p>
                      </div>
                      {guestFilter === "pending" && guestUploads.pending.length > 0 && (
                        <div className="flex items-center gap-2">
                          <button onClick={bulkApprove} disabled={bulkActioning}
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-60">
                            {bulkActioning ? <Loader2 size={11} className="animate-spin" /> : <ThumbsUp size={11} />}
                            Approve all ({guestUploads.pending.length})
                          </button>
                          <button onClick={bulkReject} disabled={bulkActioning}
                            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-colors disabled:opacity-60">
                            {bulkActioning ? <Loader2 size={11} className="animate-spin" /> : <ThumbsDown size={11} />}
                            Reject all
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Filter tabs */}
                    <div className="flex gap-1 mb-5 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
                      {(["pending", "approved", "rejected"] as const).map(f => (
                        <button key={f} onClick={() => setGuestFilter(f)}
                          className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors capitalize ${
                            guestFilter === f
                              ? "bg-zinc-700 text-zinc-100"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}>
                          {f}
                          <span className="ml-1.5 text-zinc-600">
                            ({guestUploads[f].length})
                          </span>
                        </button>
                      ))}
                    </div>

                    {(() => {
                      const items = guestUploads[guestFilter];
                      if (!items.length) return (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                          <p className="text-sm text-zinc-500">No {guestFilter} uploads</p>
                        </div>
                      );
                      return (
                        <motion.div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {items.map(upload => (
                            <motion.div key={upload.id}
                              layout
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">

                              {/* Thumbnail */}
                              <div className="aspect-square bg-zinc-800 cursor-pointer relative overflow-hidden"
                                onClick={() => upload.thumbnail_url && setGuestPreviewUrl(upload.thumbnail_url)}>
                                {upload.thumbnail_url ? (
                                  <img src={upload.thumbnail_url} className="w-full h-full object-cover block"
                                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <ImageIcon size={24} className="text-zinc-700" />
                                  </div>
                                )}
                                <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                                  upload.status === "approved" ? "bg-emerald-400" :
                                  upload.status === "rejected" ? "bg-red-400" : "bg-amber-400"
                                }`} />
                              </div>

                              {/* Info */}
                              <div className="p-2.5 flex flex-col gap-0.5 flex-1">
                                <p className="text-[11px] font-medium text-zinc-300 truncate">
                                  {upload.original_filename || upload.filename}
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

      {/* ── BULK UPLOAD MODAL ── */}
      <BulkUploadModal
        open={bulkUploadOpen}
        onClose={() => setBulkUploadOpen(false)}
        eventId={eventId}
        apiUrl={API}
        authToken={localStorage.getItem("token") ?? ""}
        planLimit={planLimit}
        currentCount={event?.image_count ?? 0}
        onComplete={async (count) => {
          if (count > 0) {
            showToast(`✓ ${count} photo${count !== 1 ? "s" : ""} uploaded`);
            setUploadSuccess(true);
            await loadEvent();
          }
          setBulkUploadOpen(false);
        }}
      />

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
                {canDownload && (
                  <button onClick={() => handleDownload(dlUrl(previewImg), previewImg)}
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

      {/* ── QR CODE MODAL ── */}
      <QRCodeDisplay
        isOpen={showQR}
        onClose={() => setShowQR(false)}
        token={event?.public_token ?? ""}
        eventName={event?.name}
        pin={currentPin}
      />

      {/* ── PIN MODAL ── */}
      <AnimatePresence>
        {showPinModal && (
          <motion.div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => { setShowPinModal(false); setPinInput(""); }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm">

              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <KeyRound size={15} className="text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">
                      {pinEnabled ? "Change PIN" : "Set PIN Protection"}
                    </h3>
                    <p className="text-[11px] text-zinc-500">
                      {pinEnabled ? `Current PIN: ${currentPin ?? "••••"}` : "4-digit PIN for public page"}
                    </p>
                  </div>
                </div>
                <button onClick={() => { setShowPinModal(false); setPinInput(""); }}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                  <X size={13} />
                </button>
              </div>

              <div className="mb-5">
                <label className="block text-xs font-medium text-zinc-400 mb-2">New 4-digit PIN</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={e => e.key === "Enter" && savePin()}
                  placeholder="0000"
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 text-center text-2xl font-bold tracking-[0.5em] placeholder-zinc-700 focus:outline-none focus:border-blue-500/50 transition-colors"
                />
                <p className="text-[11px] text-zinc-600 mt-2 text-center">
                  Guests must enter this PIN on the public page
                </p>
              </div>

              <div className="flex gap-2">
                {pinEnabled && (
                  <button onClick={removePin} disabled={pinRemoving}
                    className="px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5">
                    {pinRemoving ? <Loader2 size={13} className="animate-spin" /> : <LockOpen size={13} />}
                    Remove
                  </button>
                )}
                <button onClick={() => { setShowPinModal(false); setPinInput(""); }}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                  Cancel
                </button>
                <button onClick={savePin} disabled={pinInput.length !== 4 || pinSaving}
                  className="flex-[2] py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                  {pinSaving
                    ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                    : <><Lock size={14} /> {pinEnabled ? "Update PIN" : "Enable PIN"}</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── WATERMARK SETTINGS MODAL ── */}
      <WatermarkSettings
        isOpen={showWatermark}
        onClose={() => setShowWatermark(false)}
        onSave={handleSaveWatermark}
        previewImageUrl={event?.cover_image_url ?? undefined}
      />

    </div>
  );
}