"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Camera, Download, X, Info, Scan,
  ChevronLeft, ChevronRight, ImageIcon, RefreshCw,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PageData {
  result_id:   string;
  page:        number;
  page_size:   number;
  total:       number;
  total_pages: number;
  has_more:    boolean;
  items:       any[];
}

interface SearchResult {
  result_id: string;
  you:       PageData;
  friends:   PageData;
}

interface TabState {
  items:    any[];
  page:     number;
  total:    number;
  has_more: boolean;
  loading:  boolean;
  error:    string | null;
}

const emptyTab = (): TabState => ({
  items: [], page: 1, total: 0,
  has_more: false, loading: false, error: null,
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function PublicSelfiePage() {
  const params = useParams();
  const token  = params?.token as string;
  const API    = process.env.NEXT_PUBLIC_API_URL;

  const [event,        setEvent]        = useState<any>(null);
  const [resultId,     setResultId]     = useState<string | null>(null);
  const [activeTab,    setActiveTab]    = useState<"you" | "friends">("you");
  const [tabs,         setTabs]         = useState<Record<"you" | "friends", TabState>>({
    you: emptyTab(), friends: emptyTab(),
  });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [cameraOpen,   setCameraOpen]   = useState(false);
  const [processing,   setProcessing]   = useState(false);
  const [showInfo,     setShowInfo]     = useState(false);
  const [dragOver,     setDragOver]     = useState(false);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const clickSound  = useRef<HTMLAudioElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ─── Load event ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}`)
      .then(r => r.json())
      .then(setEvent);
  }, [token]);

  // ─── Audio ──────────────────────────────────────────────────────────────────
  const playClick = () => {
    if (clickSound.current) { clickSound.current.currentTime = 0; clickSound.current.play(); }
  };

  // ─── Image name helper (matched_photos items vs friends_photos strings) ──────
  const nameOf = (item: any): string =>
    typeof item === "string" ? item : item?.image_name ?? "";

  // ─── Upload → POST /search ───────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    playClick();
    setProcessing(true);
    setResultId(null);
    setTabs({ you: emptyTab(), friends: emptyTab() });

    try {
      const form = new FormData();
      form.append("file", file);

      const res  = await fetch(`${API}/public/events/${token}/search`, {
        method: "POST", body: form,
      });

      if (!res.ok) throw new Error(await res.text());

      const data: SearchResult = await res.json();

      setResultId(data.result_id);
      setTabs({
        you: {
          items:    data.you.items,
          page:     1,
          total:    data.you.total,
          has_more: data.you.has_more,
          loading:  false,
          error:    null,
        },
        friends: {
          items:    data.friends.items,
          page:     1,
          total:    data.friends.total,
          has_more: data.friends.has_more,
          loading:  false,
          error:    null,
        },
      });

      setTimeout(() =>
        document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth" }),
        300,
      );
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  // ─── Load next page → GET /search/{result_id} ───────────────────────────────
  const loadNextPage = useCallback(async () => {
    const tab = tabs[activeTab];
    if (!resultId || tab.loading || !tab.has_more) return;

    const nextPage = tab.page + 1;

    setTabs(prev => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], loading: true, error: null },
    }));

    try {
      const res = await fetch(
        `${API}/public/events/${token}/search/${resultId}?kind=${activeTab}&page=${nextPage}`,
      );

      if (res.status === 404) {
        setTabs(prev => ({
          ...prev,
          [activeTab]: {
            ...prev[activeTab],
            loading:  false,
            has_more: false,
            error:    "Session expired. Please upload your photo again.",
          },
        }));
        return;
      }

      if (!res.ok) throw new Error(await res.text());

      const data: PageData = await res.json();

      setTabs(prev => ({
        ...prev,
        [activeTab]: {
          items:    [...prev[activeTab].items, ...data.items],
          page:     data.page,
          total:    data.total,
          has_more: data.has_more,
          loading:  false,
          error:    null,
        },
      }));
    } catch (err) {
      console.error(err);
      setTabs(prev => ({
        ...prev,
        [activeTab]: {
          ...prev[activeTab],
          loading: false,
          error:   "Failed to load more photos.",
        },
      }));
    }
  }, [tabs, activeTab, resultId, token, API]);

  // ─── IntersectionObserver on sentinel div ────────────────────────────────────
  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadNextPage(); },
      { rootMargin: "300px" },
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [loadNextPage]);

  // ─── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) handleUpload(file);
  };

  // ─── Camera ─────────────────────────────────────────────────────────────────
  const startCamera = async () => {
    playClick();
    setCameraOpen(true);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  };

  const capturePhoto = () => {
    const v      = videoRef.current!;
    const canvas = document.createElement("canvas");
    canvas.width  = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob(blob => { if (blob) handleUpload(new File([blob], "selfie.jpg")); });
    stopCamera();
  };

  // ─── Download All — passes result_id so backend zips from cache ──────────────
  const downloadAll = () => {
    if (!resultId) return;
    playClick();
    window.location.href =
      `${API}/public/events/${token}/download-zip?result_id=${resultId}&kind=${activeTab}`;
  };

  // ─── Preview ────────────────────────────────────────────────────────────────
  const currentItems = tabs[activeTab].items;
  const openPreview  = (img: string, i: number) => { setPreviewImage(img); setPreviewIndex(i); };
  const navPreview   = (dir: number) => {
    const next = (previewIndex + dir + currentItems.length) % currentItems.length;
    setPreviewIndex(next);
    setPreviewImage(nameOf(currentItems[next]));
  };

  // ─── Derived ─────────────────────────────────────────────────────────────────
  const tab        = tabs[activeTab];
  const hasResults = resultId !== null;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-100 antialiased overflow-x-hidden">
      <audio ref={clickSound} src="/click.mp3" preload="auto" />

      {/* Ambient top glow */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-64 rounded-full bg-blue-600/10 blur-[100px] z-0" />

      {/* ── PROCESSING OVERLAY ── */}
      <AnimatePresence>
        {processing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[999]"
          >
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center gap-4 w-72 text-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
              <div>
                <p className="text-sm font-semibold text-zinc-100">Analyzing your photo</p>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">AI is scanning event photos for matches</p>
              </div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── NAVBAR ── */}
      <header className="fixed top-0 inset-x-0 z-40 h-12 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto h-full px-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <Scan size={12} className="text-white" />
            </div>
            <span className="text-sm font-semibold tracking-tight">{APP_CONFIG.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInfo(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <Info size={14} />
            </button>
            <Link
              href="/"
              className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO + UPLOAD ── */}
      <section className="relative z-10 pt-24 pb-12 px-5 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-md"
        >
          {event && (
            <div className="text-center mb-8">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Live Event
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-50">{event.event_name}</h1>
              {event.date && <p className="text-xs text-zinc-500 mt-1.5">{event.date}</p>}
            </div>
          )}

          {/* Upload card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            {/* Drop zone */}
            <label
              className={`flex flex-col items-center justify-center gap-3 p-10 cursor-pointer border-b border-zinc-800 transition-colors ${
                dragOver ? "bg-blue-500/5" : "hover:bg-zinc-800/40"
              }`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-colors ${
                dragOver
                  ? "bg-blue-500/20 border-blue-500/30 text-blue-400"
                  : "bg-zinc-800 border-zinc-700 text-zinc-400"
              }`}>
                <Upload size={18} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-200">
                  {hasResults ? "Upload a different photo" : "Drop your photo here"}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">or click to browse · JPG, PNG, WEBP</p>
              </div>
              <input
                type="file"
                hidden
                accept="image/*"
                onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
            </label>

            {/* Divider */}
            <div className="flex items-center gap-3 px-6 py-3.5">
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-[11px] text-zinc-600">or use camera</span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>

            {/* Camera button */}
            <div className="px-5 pb-5">
              <button
                onClick={startCamera}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-sm font-medium text-zinc-200 transition-colors"
              >
                <Camera size={14} />
                Open Camera
              </button>
            </div>
          </div>

          <p className="text-center text-[11px] text-zinc-600 mt-3">
            AI-powered face matching · Your photo is never stored
          </p>
        </motion.div>
      </section>

      {/* ── RESULTS ── */}
      <AnimatePresence>
        {hasResults && (
          <motion.section
            id="results-section"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative z-10 max-w-5xl mx-auto px-5 pb-24"
          >
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

              {/* Tab bar */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div className="flex gap-1">
                  {(["you", "friends"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setActiveTab(t)}
                      className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        activeTab === t
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {t === "you" ? "Your Photos" : "With Friends"}
                      <span className="bg-zinc-700/80 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-md leading-none">
                        {tabs[t].total}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Download All — uses result_id → backend zips from cache */}
                {tab.items.length > 0 && (
                  <button
                    onClick={downloadAll}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    <Download size={12} />
                    Download All ({tab.total})
                  </button>
                )}
              </div>

              {/* Gallery */}
              <div className="p-4">
                {tab.items.length > 0 ? (
                  <>
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                      className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-2"
                    >
                      {tab.items.map((item: any, i: number) => {
                        const img = nameOf(item);
                        return (
                          <motion.div
                            key={`${activeTab}-${i}`}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: Math.min(i * 0.02, 0.5), duration: 0.25 }}
                            className="group relative rounded-xl overflow-hidden border border-zinc-800 hover:border-zinc-600 cursor-pointer transition-all hover:scale-[1.03] bg-zinc-800"
                            onClick={() => openPreview(img, i)}
                          >
                            <img
                              src={`${API}/public/events/${token}/thumbnail/${img}`}
                              className="w-full aspect-[4/5] object-cover block"
                              loading="lazy"
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <a
                                href={`${API}/public/events/${token}/download/${img}`}
                                onClick={e => e.stopPropagation()}
                                className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
                              >
                                <Download size={13} />
                              </a>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>

                    {/* ── INFINITE SCROLL SENTINEL ── */}
                    <div ref={sentinelRef} className="mt-6 flex items-center justify-center min-h-[40px]">
                      {tab.loading && (
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          <div className="w-4 h-4 border border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                          Loading more…
                        </div>
                      )}
                      {!tab.loading && !tab.has_more && tab.total > 30 && (
                        <p className="text-xs text-zinc-600">
                          All {tab.total} photos loaded
                        </p>
                      )}
                      {tab.error && (
                        <div className="flex items-center gap-2 text-xs text-red-400">
                          {tab.error}
                          <button
                            onClick={loadNextPage}
                            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors ml-1"
                          >
                            <RefreshCw size={11} />
                            Retry
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  /* Empty state */
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-600">
                      <ImageIcon size={20} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-zinc-400">No photos found</p>
                      <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-[200px]">
                        Try a clearer selfie with better lighting
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── CAMERA MODAL ── */}
      <AnimatePresence>
        {cameraOpen && (
          <motion.div
            className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden w-full max-w-sm"
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
                <span className="text-sm font-semibold">Take a Selfie</span>
                <button
                  onClick={stopCamera}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="bg-zinc-950">
                <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-72 object-cover block" />
              </div>
              <div className="p-4">
                <button
                  onClick={capturePhoto}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  <Camera size={14} />
                  Capture Photo
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── IMAGE PREVIEW MODAL ── */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            className="fixed inset-0 bg-black/92 backdrop-blur-md flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(null)}
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.93, opacity: 0 }}
              className="relative"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={`${API}/public/events/${token}/image/${previewImage}`}
                className="max-h-[82vh] max-w-[90vw] rounded-xl block"
              />

              {/* Arrow navigation */}
              {currentItems.length > 1 && (
                <>
                  <button
                    onClick={() => navPreview(-1)}
                    className="absolute -left-12 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => navPreview(1)}
                    className="absolute -right-12 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}

              {/* Bottom bar */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent rounded-b-xl px-4 py-4 flex items-end justify-between">
                <span className="text-xs text-white/40">
                  {previewIndex + 1} / {currentItems.length}
                  {tab.has_more && "+"}
                </span>
                <a
                  href={`${API}/public/events/${token}/download/${previewImage}`}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  <Download size={12} />
                  Download
                </a>
              </div>

              {/* Close */}
              <button
                onClick={() => setPreviewImage(null)}
                className="absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-lg bg-black/60 border border-white/10 text-white hover:bg-black/80 transition-colors"
              >
                <X size={13} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── INFO MODAL ── */}
      <AnimatePresence>
        {showInfo && (
          <motion.div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowInfo(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 8 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold">How it works</h3>
                <button
                  onClick={() => setShowInfo(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
              <p className="text-xs text-zinc-500 mb-5">AI-powered face matching to find your event photos</p>

              <div className="border-t border-zinc-800 divide-y divide-zinc-800">
                {[
                  { n: "1", title: "Upload your selfie",    desc: "Take or upload a clear photo of your face" },
                  { n: "2", title: "AI scans the event",    desc: "Our model searches all event photos for matches" },
                  { n: "3", title: "Scroll & download",     desc: "Photos load as you scroll — download any or all" },
                ].map(step => (
                  <div key={step.n} className="flex items-start gap-3 py-3.5">
                    <div className="w-5 h-5 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-blue-400">{step.n}</span>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-zinc-200">{step.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowInfo(false)}
                className="w-full mt-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
              >
                Got it
              </button>

              <p className="text-center text-[11px] text-zinc-600 mt-3 leading-relaxed">
                Your selfie is processed in memory and never stored
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FOOTER ── */}
      <footer className="border-t border-zinc-800/60 py-5 text-center">
        <p className="text-xs text-zinc-600">
          © {new Date().getFullYear()} {APP_CONFIG.name} · AI Face Matching
        </p>
      </footer>
    </div>
  );
}
