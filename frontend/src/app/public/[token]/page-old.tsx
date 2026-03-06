"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Camera, Download, X, Info, Scan,
  ChevronLeft, ChevronRight, ImageIcon, RefreshCw,
  ImagePlus, CheckCircle2, Users, Sparkles,
  ArrowRight, Loader2, ZoomIn, Star,
  AlertCircle, CloudUpload, Trash2, Eye,
  SlidersHorizontal, PackageOpen, Grid2X2, LayoutGrid,
  MapPin, Sunset, Music, Utensils, Tag,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface PageData {
  result_id: string; page: number; page_size: number;
  total: number; total_pages: number; has_more: boolean; items: any[];
}
interface SearchResult { result_id: string; you: PageData; }
interface TabState {
  items: any[]; page: number; total: number;
  has_more: boolean; loading: boolean; error: string | null;
}
interface ContribFile { file: File; preview: string; id: string; }
type Mode       = "search" | "contribute";
type UploadStep = "drop" | "preview" | "submitting" | "success";
type GridLayout = "comfortable" | "compact" | "large";

const emptyTab = (): TabState => ({
  items: [], page: 1, total: 0, has_more: false, loading: false, error: null,
});

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const uid    = () => Math.random().toString(36).slice(2);
const nameOf = (item: any): string =>
  typeof item === "string" ? item : (item?.image_name ?? "");
const sceneOf = (item: any): string =>
  typeof item === "object" && item !== null ? (item?.scene_label ?? "") : "";
const objectsOf = (item: any): string[] =>
  typeof item === "object" && item !== null && Array.isArray(item?.objects)
    ? (item.objects as string[])
    : [];

/* ─── Animation variants ─────────────────────────────────────────────────── */
const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.055, duration: 0.48, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};
const stagger = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
};
const scaleIn = {
  hidden:  { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

/* ─── Scene icon map ──────────────────────────────────────────────────────── */
const SCENE_ICONS: Record<string, React.ReactNode> = {
  ceremony:  <Sparkles  size={11} />,
  reception: <Star      size={11} />,
  dinner:    <Utensils  size={11} />,
  party:     <Music     size={11} />,
  outdoor:   <Sunset    size={11} />,
  venue:     <MapPin    size={11} />,
};
const sceneIcon = (label: string) =>
  SCENE_ICONS[label.toLowerCase()] ?? <MapPin size={11} />;

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function PublicSelfiePage() {
  const params = useParams();
  const token  = params?.token as string;
  const API    = process.env.NEXT_PUBLIC_API_URL;

  /* ── State ── */
  const [event,        setEvent]        = useState<any>(null);
  const [mode,         setMode]         = useState<Mode>("search");
  const [resultId,     setResultId]     = useState<string | null>(null);
  const [tab,          setTab]          = useState<TabState>(emptyTab());
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [cameraOpen,   setCameraOpen]   = useState(false);
  const [processing,   setProcessing]   = useState(false);
  const [showInfo,     setShowInfo]     = useState(false);
  const [dragOver,     setDragOver]     = useState(false);

  /* Scene + Object + Grid */
  const [activeScene,  setActiveScene]  = useState<string>("all");
  const [activeObject, setActiveObject] = useState<string>("all");
  const [gridLayout,   setGridLayout]   = useState<GridLayout>("comfortable");
  const [dlAllLoading, setDlAllLoading] = useState(false);

  /* Contribute */
  const [uploadStep,      setUploadStep]      = useState<UploadStep>("drop");
  const [contribFiles,    setContribFiles]    = useState<ContribFile[]>([]);
  const [contribName,     setContribName]     = useState("");
  const [contribMsg,      setContribMsg]      = useState("");
  const [contribError,    setContribError]    = useState<string | null>(null);
  const [uploadCount,     setUploadCount]     = useState(0);
  const [selectedPreview, setSelectedPreview] = useState<ContribFile | null>(null);

  /* Refs */
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const sentinelRef  = useRef<HTMLDivElement | null>(null);
  const observerRef  = useRef<IntersectionObserver | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const guestUpload = true;
  const isPro = !!(event?.plan_type && event.plan_type !== "free");

  /* ── Derived: scene counts from loaded items ── */
  const sceneCounts = tab.items.reduce((acc: Record<string, number>, item) => {
    const s = sceneOf(item);
    if (s) acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const sceneLabels = Object.keys(sceneCounts);
  const hasScenes   = sceneLabels.length > 0;

  /* ── Derived: object counts from loaded items ── */
  const objectCounts = tab.items.reduce((acc: Record<string, number>, item) => {
    const objs = objectsOf(item);
    objs.forEach(obj => {
      if (obj) acc[obj] = (acc[obj] ?? 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);
  // Only show objects that appear in 2+ photos or top 10, sorted by frequency
  const objectLabels = Object.entries(objectCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([label]) => label);
  const hasObjects = objectLabels.length > 0;

  /* ── Filtered items: scene AND object filters combined ── */
  const filteredItems = tab.items.filter(item => {
    const sceneMatch  = activeScene  === "all" || sceneOf(item)   === activeScene;
    const objectMatch = activeObject === "all" || objectsOf(item).includes(activeObject);
    return sceneMatch && objectMatch;
  });

  /* ── Load event ── */
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}`)
      .then(r => r.json()).then(setEvent).catch(() => {});
  }, [token]);

  /* ── Face search ── */
  const handleUpload = async (file: File) => {
    setProcessing(true);
    setResultId(null);
    setTab(emptyTab());
    setActiveScene("all");
    setActiveObject("all");
    try {
      const form = new FormData();
      form.append("file", file);
      const res  = await fetch(`${API}/public/events/${token}/search`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data: SearchResult = await res.json();
      setResultId(data.result_id);
      setTab({
        items: data.you.items, page: 1, total: data.you.total,
        has_more: data.you.has_more, loading: false, error: null,
      });
      setTimeout(() =>
        document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth" }), 300);
    } catch (err) { console.error(err); }
    finally { setProcessing(false); }
  };

  /* ── Infinite scroll ── */
  const loadNextPage = useCallback(async () => {
    if (!resultId || tab.loading || !tab.has_more) return;
    const nextPage = tab.page + 1;
    setTab(prev => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(
        `${API}/public/events/${token}/search/${resultId}?kind=you&page=${nextPage}`
      );
      if (res.status === 404) {
        setTab(prev => ({ ...prev, loading: false, has_more: false, error: "Session expired." }));
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data: PageData = await res.json();
      setTab(prev => ({
        items: [...prev.items, ...data.items], page: data.page,
        total: data.total, has_more: data.has_more, loading: false, error: null,
      }));
    } catch {
      setTab(prev => ({ ...prev, loading: false, error: "Failed to load more." }));
    }
  }, [tab, resultId, token, API]);

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      e => { if (e[0].isIntersecting) loadNextPage(); }, { rootMargin: "400px" }
    );
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [loadNextPage]);

  /* ── Download Single ── */
  const downloadSinglePhoto = async (imageName: string) => {
    try {
      const res = await fetch(`${API}/public/events/${token}/photo/${imageName}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = imageName;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { console.error("Download failed:", e); }
  };

  /* ── Download All ── */
  const handleDownloadAll = async () => {
    if (!resultId || dlAllLoading) return;
    setDlAllLoading(true);
    try {
      const res = await fetch(`${API}/public/events/${token}/download/${resultId}?kind=matched`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url, download: `my-event-photos.zip` });
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    finally { setDlAllLoading(false); }
  };

  /* ── Camera ── */
  const startCamera = async () => {
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch { setCameraOpen(false); }
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; setCameraOpen(false);
  };
  const capturePhoto = () => {
    const v = videoRef.current!;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob(blob => { if (blob) handleUpload(new File([blob], "selfie.jpg")); });
    stopCamera();
  };

  /* ── Contribute ── */
  const addContribFiles = (fl: FileList | null) => {
    if (!fl) return;
    const valid = Array.from(fl).filter(f => f.type.startsWith("image/"))
      .map(f => ({ file: f, preview: URL.createObjectURL(f), id: uid() }));
    setContribFiles(prev => [...prev, ...valid].slice(0, 30));
    setContribError(null);
    if (valid.length) setUploadStep("preview");
  };
  const removeContribFile = (id: string) => {
    setContribFiles(prev => {
      const u = prev.filter(f => f.id !== id);
      if (!u.length) setUploadStep("drop");
      return u;
    });
  };
  const submitContrib = async () => {
    if (!contribFiles.length) return;
    setUploadStep("submitting"); setContribError(null);
    try {
      const form = new FormData();
      contribFiles.forEach(f => form.append("files", f.file));
      if (contribName.trim()) form.append("contributor_name", contribName.trim());
      if (contribMsg.trim())  form.append("message", contribMsg.trim());
      const res = await fetch(`${API}/public/events/${token}/contribute`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUploadCount(data.uploaded ?? contribFiles.length);
      setContribFiles([]); setContribName(""); setContribMsg("");
      setUploadStep("success");
    } catch (err) {
      setContribError(err instanceof Error ? err.message : "Upload failed");
      setUploadStep("preview");
    }
  };
  const resetContrib = () => {
    setUploadStep("drop"); setContribFiles([]);
    setContribName(""); setContribMsg(""); setContribError(null);
  };

  /* ── Preview nav ── */
  const navPreview = (dir: number) => {
    const next = Math.max(0, Math.min(previewIndex + dir, filteredItems.length - 1));
    setPreviewIndex(next);
    setPreviewImage(nameOf(filteredItems[next]));
  };

  /* ── Grid cols ── */
  const gridCols = {
    comfortable: "repeat(auto-fill, minmax(220px, 1fr))",
    compact:     "repeat(auto-fill, minmax(148px, 1fr))",
    large:       "repeat(auto-fill, minmax(320px, 1fr))",
  }[gridLayout];

  /* ── Active filter summary for subtitle ── */
  const activeFilterLabel = (() => {
    const parts: string[] = [];
    if (activeScene  !== "all") parts.push(`Scene: ${activeScene}`);
    if (activeObject !== "all") parts.push(`Object: ${activeObject}`);
    if (parts.length) return `${parts.join(" · ")} · ${filteredItems.length} photo${filteredItems.length !== 1 ? "s" : ""}`;
    return `${tab.total} photo${tab.total !== 1 ? "s" : ""} found across the event`;
  })();

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════════ */
  return (
    <div style={{ minHeight: "100vh", background: "#09090f", color: "#fff", fontFamily: "'Outfit', sans-serif" }}>

      {/* ── Global CSS ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap');

        :root {
          --gold:        #e8c97e;
          --gold-l:      #f5e0a6;
          --gold-dim:    rgba(232,201,126,0.13);
          --gold-border: rgba(232,201,126,0.22);
          --surf:        rgba(255,255,255,0.04);
          --surf-h:      rgba(255,255,255,0.07);
          --border:      rgba(255,255,255,0.07);
          --muted:       rgba(255,255,255,0.35);
          --dim:         rgba(255,255,255,0.55);
          --jade:        #4ade80;
          --jade-dim:    rgba(74,222,128,0.12);
          --rose:        #f87171;
          --violet:      #a78bfa;
          --violet-dim:  rgba(167,139,250,0.12);
          --violet-border: rgba(167,139,250,0.22);
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--gold-border); border-radius: 4px; }

        .serif  { font-family: 'Playfair Display', Georgia, serif; }
        .glass  { background: var(--surf); border: 1px solid var(--border); backdrop-filter: blur(20px); }
        .g-gold { background: var(--gold-dim); border: 1px solid var(--gold-border); }
        .g-jade { background: var(--jade-dim); border: 1px solid rgba(74,222,128,0.22); }
        .g-violet { background: var(--violet-dim); border: 1px solid var(--violet-border); }

        .btn-gold {
          background: linear-gradient(135deg, #e8c97e, #c88c25);
          color: #0a0808; font-weight: 700; letter-spacing: 0.015em;
          border: none; cursor: pointer; transition: all 0.2s;
          box-shadow: 0 4px 20px rgba(232,201,126,0.22);
        }
        .btn-gold:hover  { filter: brightness(1.06); transform: translateY(-1px); box-shadow: 0 8px 28px rgba(232,201,126,0.38); }
        .btn-gold:active { transform: none; }
        .btn-gold:disabled {
          background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.2);
          box-shadow: none; transform: none; filter: none; cursor: not-allowed;
        }
        .btn-ghost {
          background: var(--surf); border: 1px solid var(--border);
          color: var(--dim); font-weight: 600; cursor: pointer; transition: all 0.18s;
        }
        .btn-ghost:hover { background: var(--surf-h); color: #fff; border-color: rgba(255,255,255,0.12); }

        /* Photo grid cards */
        .photo-card {
          cursor: pointer; overflow: hidden; border-radius: 12px; position: relative;
          background: #111; border: 1px solid var(--border);
          transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
        }
        .photo-card:hover { transform: scale(1.028); box-shadow: 0 16px 48px rgba(0,0,0,0.65); border-color: var(--gold-border); z-index: 2; }
        .photo-card:hover .photo-overlay { opacity: 1; }
        .photo-overlay { opacity: 0; transition: opacity 0.2s; }

        /* Drop zones */
        .drop-zone { transition: all 0.22s ease; }
        .drop-zone.over { border-color: var(--gold) !important; background: var(--gold-dim) !important; }

        /* Contrib thumbnails */
        .contrib-thumb:hover .thumb-ov { opacity: 1; }
        .thumb-ov { opacity: 0; transition: opacity 0.18s; }

        /* Scene filter pills */
        .scene-pill {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--border); background: var(--surf);
          color: var(--dim); white-space: nowrap; transition: all 0.18s;
          font-family: 'Outfit', sans-serif;
        }
        .scene-pill:hover { background: var(--surf-h); color: #fff; }
        .scene-pill.active { background: var(--gold-dim); border-color: var(--gold-border); color: var(--gold); }

        /* Object filter pills — violet accent to visually differentiate from scene */
        .object-pill {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 11px; border-radius: 99px; font-size: 11px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--border); background: var(--surf);
          color: var(--dim); white-space: nowrap; transition: all 0.18s;
          font-family: 'Outfit', sans-serif; text-transform: capitalize;
        }
        .object-pill:hover { background: var(--surf-h); color: #fff; }
        .object-pill.active { background: var(--violet-dim); border-color: var(--violet-border); color: var(--violet); }

        /* Grid layout toggle */
        .layout-btn {
          display: flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border-radius: 7px; border: 1px solid transparent;
          background: transparent; color: var(--muted); cursor: pointer; transition: all 0.15s;
        }
        .layout-btn.active { background: var(--gold-dim); border-color: var(--gold-border); color: var(--gold); }
        .layout-btn:hover:not(.active) { background: var(--surf-h); color: var(--dim); }

        /* Pulse animation for header logo */
        @keyframes pulseRing {
          0%   { box-shadow: 0 0 0 0 rgba(232,201,126,0.45); }
          70%  { box-shadow: 0 0 0 14px rgba(232,201,126,0); }
          100% { box-shadow: 0 0 0 0 rgba(232,201,126,0); }
        }
        .pulse-ring { animation: pulseRing 2.4s ease infinite; }

        /* Shimmer headline */
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        .shimmer-text {
          background: linear-gradient(90deg, var(--gold) 0%, var(--gold-l) 42%, var(--gold) 65%);
          background-size: 200% auto;
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          animation: shimmer 4s linear infinite;
        }

        /* Object badge on photo cards */
        .object-badge {
          display: inline-flex; align-items: center; gap: 3px;
          padding: 2px 7px; border-radius: 5px;
          background: rgba(167,139,250,0.22); border: 1px solid rgba(167,139,250,0.3);
          font-size: 9px; font-weight: 700; color: var(--violet);
          text-transform: capitalize; letter-spacing: 0.03em;
        }

        /* Filter bar horizontal scroll */
        .filter-scroll {
          overflow-x: auto; -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .filter-scroll::-webkit-scrollbar { display: none; }
      `}</style>

      {/* Ambient glows */}
      <div aria-hidden style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-15%", left: "25%", width: 700, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,201,126,0.055) 0%, transparent 68%)", filter: "blur(80px)" }} />
        <div style={{ position: "absolute", bottom: "5%", right: "5%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.04) 0%, transparent 70%)", filter: "blur(90px)" }} />
        <div style={{ position: "absolute", top: "40%", left: "-10%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(167,139,250,0.03) 0%, transparent 70%)", filter: "blur(80px)" }} />
      </div>

      {/* ══ HEADER ══ */}
      <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, background: "rgba(9,9,15,0.88)", backdropFilter: "blur(28px)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "0 20px", height: 62, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="pulse-ring" style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg, #e8c97e, #b86a12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles size={17} color="#0a0808" />
            </div>
            <div>
              <p className="serif" style={{ color: "#fff", fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>
                {event?.name || "Event Photos"}
              </p>
              <p style={{ color: "var(--muted)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 1 }}>
                AI · Face Recognition
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {guestUpload && mode === "search" && (
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setMode("contribute")} className="glass"
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--gold)" }}>
                <CloudUpload size={14} /> Share Photos
              </motion.button>
            )}
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowInfo(true)} className="glass"
              style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--dim)" }}>
              <Info size={16} />
            </motion.button>
          </div>
        </div>
      </header>

      {/* ══ MAIN ══ */}
      <main style={{ paddingTop: 78, paddingBottom: 90, minHeight: "100vh", position: "relative", zIndex: 1 }}>
        <AnimatePresence mode="wait">

          {/* ════════════ SEARCH MODE ════════════ */}
          {mode === "search" && (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }}>

              {/* ─── Hero (no results yet) ─── */}
              {!resultId && !processing && (
                <motion.section variants={stagger} initial="hidden" animate="visible"
                  style={{ maxWidth: 660, margin: "0 auto", padding: "64px 20px 40px", textAlign: "center" }}>

                  <motion.div variants={fadeUp} style={{ display: "inline-flex", marginBottom: 28, position: "relative" }}>
                    <div className="g-gold" style={{ width: 92, height: 92, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Scan size={44} color="var(--gold)" strokeWidth={1.4} />
                    </div>
                    {[["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]].map(([v, h], i) => (
                      <div key={i} style={{
                        position: "absolute", [v]: -4, [h]: -4, width: 14, height: 14,
                        borderTop: v === "top" ? "2px solid var(--gold)" : undefined,
                        borderBottom: v === "bottom" ? "2px solid var(--gold)" : undefined,
                        borderLeft: h === "left" ? "2px solid var(--gold)" : undefined,
                        borderRight: h === "right" ? "2px solid var(--gold)" : undefined,
                        borderRadius: v === "top" && h === "left" ? "4px 0 0 0" : v === "top" && h === "right" ? "0 4px 0 0" : v === "bottom" && h === "left" ? "0 0 0 4px" : "0 0 4px 0",
                      }} />
                    ))}
                  </motion.div>

                  <motion.h1 variants={fadeUp} className="serif shimmer-text"
                    style={{ fontSize: "clamp(36px,6vw,60px)", fontWeight: 600, lineHeight: 1.08, marginBottom: 16 }}>
                    Find Yourself<br />in Every Photo
                  </motion.h1>

                  <motion.p variants={fadeUp}
                    style={{ color: "var(--dim)", fontSize: 16, lineHeight: 1.7, maxWidth: 430, margin: "0 auto 40px" }}>
                    Upload a selfie — AI scans every event photo and finds your matches instantly.
                  </motion.p>

                  <motion.div variants={fadeUp}
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, maxWidth: 430, margin: "0 auto 16px" }}>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={startCamera} className="btn-gold"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "15px 20px", borderRadius: 14, fontSize: 15, cursor: "pointer" }}>
                      <Camera size={18} /> Take Selfie
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => fileInputRef.current?.click()} className="btn-ghost"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "15px 20px", borderRadius: 14, fontSize: 15, cursor: "pointer" }}>
                      <Upload size={18} /> Upload Photo
                    </motion.button>
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }}
                      onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ""; }} />
                  </motion.div>

                  <motion.div variants={fadeUp}>
                    <div className={`drop-zone ${dragOver ? "over" : ""}`}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                      style={{ border: "1.5px dashed var(--border)", borderRadius: 14, padding: "16px", color: "var(--muted)", fontSize: 13, maxWidth: 430, margin: "0 auto", textAlign: "center" }}>
                      or drag & drop your selfie here
                    </div>
                  </motion.div>

                  <motion.div variants={stagger}
                    style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 48, maxWidth: 480, margin: "48px auto 0" }}>
                    {[
                      { icon: Camera,   label: "Snap a selfie",   n: "01" },
                      { icon: Scan,     label: "AI scans photos", n: "02" },
                      { icon: Download, label: "Download yours",  n: "03" },
                    ].map(step => {
                      const Icon = step.icon;
                      return (
                        <motion.div key={step.n} variants={fadeUp} className="glass"
                          style={{ borderRadius: 14, padding: "18px 12px", textAlign: "center" }}>
                          <p style={{ color: "var(--gold)", fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", marginBottom: 10 }}>{step.n}</p>
                          <Icon size={20} color="var(--gold)" style={{ margin: "0 auto 10px", display: "block" }} />
                          <p style={{ color: "rgba(255,255,255,0.68)", fontSize: 12, fontWeight: 500, lineHeight: 1.45 }}>{step.label}</p>
                        </motion.div>
                      );
                    })}
                  </motion.div>

                  {guestUpload && (
                    <motion.div variants={fadeUp} style={{ marginTop: 32 }}>
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={() => setMode("contribute")}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, background: "var(--gold-dim)", border: "1px solid var(--gold-border)", color: "var(--gold)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}>
                        <ImagePlus size={15} /> Share your event photos <ArrowRight size={14} />
                      </motion.button>
                    </motion.div>
                  )}
                </motion.section>
              )}

              {/* ─── Processing ─── */}
              {processing && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ maxWidth: 460, margin: "72px auto 0", padding: "0 20px" }}>
                  <div className="glass" style={{ borderRadius: 24, padding: "52px 32px", textAlign: "center" }}>
                    <div style={{ position: "relative", width: 76, height: 76, margin: "0 auto 26px" }}>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                        style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "var(--gold)", borderRightColor: "var(--gold-border)" }} />
                      <div className="g-gold" style={{ position: "absolute", inset: 10, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Scan size={22} color="var(--gold)" />
                      </div>
                    </div>
                    <h3 className="serif" style={{ color: "#fff", fontSize: 24, marginBottom: 10 }}>Scanning Photos…</h3>
                    <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.65 }}>
                      AI is finding your face across every event photo. This takes just a moment.
                    </p>
                    <div style={{ marginTop: 28, height: 2, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                      <motion.div animate={{ x: ["-100%", "100%"] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                        style={{ height: "100%", width: "50%", background: "linear-gradient(90deg, transparent, var(--gold), transparent)", borderRadius: 99 }} />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ─── Results ─── */}
              {resultId && !processing && (
                <motion.section id="results-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 20px 0" }}>

                  {/* Results header row */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, color: "#fff" }}>Your Photos</h2>
                        {tab.total > 0 && (
                          <span style={{ padding: "2px 9px", borderRadius: 99, background: "var(--gold-dim)", border: "1px solid var(--gold-border)", fontSize: 12, fontWeight: 700, color: "var(--gold)" }}>
                            {tab.total}{tab.has_more ? "+" : ""}
                          </span>
                        )}
                      </div>
                      <p style={{ color: "var(--muted)", fontSize: 13 }}>{activeFilterLabel}</p>
                    </div>

                    {/* Action bar */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {/* Grid layout toggle */}
                      <div className="glass" style={{ display: "flex", gap: 2, padding: 3, borderRadius: 9 }}>
                        {([
                          { k: "large"       as GridLayout, icon: <Grid2X2 size={13} />,           title: "Large"       },
                          { k: "comfortable" as GridLayout, icon: <LayoutGrid size={13} />,        title: "Comfortable" },
                          { k: "compact"     as GridLayout, icon: <SlidersHorizontal size={13} />, title: "Compact"     },
                        ]).map(({ k, icon, title }) => (
                          <button key={k} title={title} onClick={() => setGridLayout(k)}
                            className={`layout-btn${gridLayout === k ? " active" : ""}`}>
                            {icon}
                          </button>
                        ))}
                      </div>

                      {/* Download All — Pro */}
                      {isPro && tab.total > 0 && (
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAll} disabled={dlAllLoading} className="btn-gold"
                          style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                          {dlAllLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}><Loader2 size={14} /></motion.div> Preparing…</>
                            : <><PackageOpen size={14} /> Download All ({tab.total})</>}
                        </motion.button>
                      )}

                      {/* Free plan download pill */}
                      {!isPro && tab.total > 1 && (
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAll} disabled={dlAllLoading} className="g-gold"
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, fontSize: 12, cursor: dlAllLoading ? "not-allowed" : "pointer", border: "none", background: "transparent" }}>
                          {dlAllLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}><Loader2 size={12} /></motion.div> Preparing…</>
                            : <><Star size={12} style={{ color: "var(--gold)", flexShrink: 0 }} />
                                <span style={{ color: "rgba(232,201,126,0.85)", fontWeight: 500 }}>
                                  Download all {tab.total} photos as ZIP
                                </span></>
                          }
                        </motion.button>
                      )}

                      {/* New search */}
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => { setResultId(null); setTab(emptyTab()); setActiveScene("all"); setActiveObject("all"); }}
                        className="btn-ghost"
                        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                        <RefreshCw size={13} /> New Search
                      </motion.button>
                    </div>
                  </div>

                  {/* ══ AI ENRICHMENT FILTER BAR ══
                      Shows when either scene labels or detected objects are present.
                      Scene filter row: gold accent
                      Object filter row: violet accent (visually distinct layer)
                  */}
                  {(hasScenes || hasObjects) && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        marginBottom: 20,
                        paddingBottom: 18,
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {/* ── Scene filter row ── */}
                      {hasScenes && (
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          {/* Label */}
                          <div style={{
                            display: "flex", alignItems: "center", gap: 5,
                            flexShrink: 0, minWidth: 60,
                          }}>
                            <MapPin size={10} color="var(--gold)" />
                            <span style={{ color: "var(--muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              Scene
                            </span>
                          </div>
                          {/* Pills — scrollable on mobile */}
                          <div className="filter-scroll" style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
                            <button
                              className={`scene-pill${activeScene === "all" ? " active" : ""}`}
                              onClick={() => setActiveScene("all")}
                            >
                              All · {tab.total}
                            </button>
                            {sceneLabels.map(label => (
                              <button
                                key={label}
                                className={`scene-pill${activeScene === label ? " active" : ""}`}
                                onClick={() => setActiveScene(activeScene === label ? "all" : label)}
                                style={{ textTransform: "capitalize" }}
                              >
                                {sceneIcon(label)}
                                {label} · {sceneCounts[label]}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Object / content filter row ── */}
                      {hasObjects && (
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          {/* Label */}
                          <div style={{
                            display: "flex", alignItems: "center", gap: 5,
                            flexShrink: 0, minWidth: 60,
                          }}>
                            <Tag size={10} color="var(--violet)" />
                            <span style={{ color: "var(--muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                              Objects
                            </span>
                          </div>
                          {/* Pills — scrollable on mobile */}
                          <div className="filter-scroll" style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
                            <button
                              className={`object-pill${activeObject === "all" ? " active" : ""}`}
                              onClick={() => setActiveObject("all")}
                            >
                              All
                            </button>
                            {objectLabels.map(label => (
                              <button
                                key={label}
                                className={`object-pill${activeObject === label ? " active" : ""}`}
                                onClick={() => setActiveObject(activeObject === label ? "all" : label)}
                              >
                                {label}
                                <span style={{ opacity: 0.55, fontSize: 10 }}>· {objectCounts[label]}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Active filter clear chip — shown when any non-default filter is active */}
                      {(activeScene !== "all" || activeObject !== "all") && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 2 }}>
                          <span style={{ color: "var(--muted)", fontSize: 11 }}>
                            Showing {filteredItems.length} of {tab.total} photos
                          </span>
                          <button
                            onClick={() => { setActiveScene("all"); setActiveObject("all"); }}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "2px 8px", borderRadius: 99,
                              background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)",
                              color: "var(--dim)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                            }}
                          >
                            <X size={9} /> Clear filters
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* ── Photo grid ── */}
                  {filteredItems.length > 0 ? (
                    <>
                      <motion.div variants={stagger} initial="hidden" animate="visible"
                        style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8 }}>
                        {filteredItems.map((item, idx) => {
                          const imgName = nameOf(item);
                          const scene   = sceneOf(item);
                          const objects = objectsOf(item);
                          // Show up to 2 object badges on hover overlay
                          const topObjects = objects.slice(0, 2);
                          return (
                            <motion.div key={`${imgName}-${idx}`} variants={fadeUp} custom={idx % 8}
                              className="photo-card" style={{ aspectRatio: "1" }}
                              onClick={() => { setPreviewIndex(idx); setPreviewImage(imgName); }}>
                              <img
                                src={`${API}/public/events/${token}/image/${imgName}`}
                                alt="" loading="lazy"
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />

                              {/* Scene badge — top left */}
                              {scene && (
                                <div style={{
                                  position: "absolute", top: 8, left: 8,
                                  padding: "3px 8px", borderRadius: 6,
                                  background: "rgba(0,0,0,0.62)", backdropFilter: "blur(8px)",
                                  fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.85)",
                                  textTransform: "capitalize", letterSpacing: "0.04em",
                                  border: "1px solid rgba(255,255,255,0.1)",
                                  display: "flex", alignItems: "center", gap: 4,
                                }}>
                                  {sceneIcon(scene)} {scene}
                                </div>
                              )}

                              {/* Object badges — top right (subtle, only shown when objects present) */}
                              {topObjects.length > 0 && (
                                <div style={{
                                  position: "absolute", top: 8, right: 8,
                                  display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end",
                                }}>
                                  {topObjects.map(obj => (
                                    <span key={obj} className="object-badge">{obj}</span>
                                  ))}
                                </div>
                              )}

                              {/* Hover overlay */}
                              <div className="photo-overlay" style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 55%)" }}>
                                <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <ZoomIn size={15} color="#fff" />
                                  </div>
                                  <button
                                    onClick={e => { e.stopPropagation(); downloadSinglePhoto(nameOf(item)); }}
                                    style={{
                                      width: 34, height: 34, borderRadius: 9,
                                      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)",
                                      border: "1px solid rgba(255,255,255,0.12)",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      cursor: "pointer", color: "#fff",
                                    }}>
                                    <Download size={14} />
                                  </button>
                                </div>
                                <span style={{ position: "absolute", top: 10, right: 10, fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
                                  {idx + 1}/{tab.total}{tab.has_more ? "+" : ""}
                                </span>
                              </div>
                            </motion.div>
                          );
                        })}
                      </motion.div>

                      <div ref={sentinelRef} style={{ height: 4 }} />

                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "36px 0" }}>
                        {tab.loading && (
                          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}>
                            <Loader2 size={22} color="var(--gold)" />
                          </motion.div>
                        )}
                        {!tab.loading && !tab.has_more && tab.total > 0 && (
                          <p style={{ color: "var(--muted)", fontSize: 12 }}>All {tab.total} photos loaded ✓</p>
                        )}
                        {tab.error && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--rose)" }}>
                            <AlertCircle size={14} /> {tab.error}
                            <button onClick={loadNextPage} style={{ color: "var(--gold)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                              <RefreshCw size={12} /> Retry
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Empty state */
                    (activeScene !== "all" || activeObject !== "all") ? (
                      <div style={{ textAlign: "center", padding: "64px 20px" }}>
                        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>
                          No photos match the current filters
                        </p>
                        <button onClick={() => { setActiveScene("all"); setActiveObject("all"); }}
                          style={{ color: "var(--gold)", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>
                          ← Clear filters
                        </button>
                      </div>
                    ) : (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 20px", gap: 16, textAlign: "center" }}>
                        <div className="glass" style={{ width: 72, height: 72, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <ImageIcon size={28} color="var(--muted)" />
                        </div>
                        <div>
                          <p style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600, fontSize: 16, marginBottom: 8 }}>No matches found</p>
                          <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.65, maxWidth: 270 }}>
                            Try a clear, front-facing selfie with good lighting for the best results.
                          </p>
                        </div>
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                          onClick={() => { setResultId(null); setTab(emptyTab()); }} className="btn-gold"
                          style={{ padding: "11px 22px", borderRadius: 11, fontSize: 14, cursor: "pointer" }}>
                          Try Again
                        </motion.button>
                      </motion.div>
                    )
                  )}
                </motion.section>
              )}
            </motion.div>
          )}

          {/* ════════════ CONTRIBUTE MODE ════════════ */}
          {mode === "contribute" && (
            <motion.div key="contribute" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }}>
              <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>

                <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  onClick={() => { setMode("search"); resetContrib(); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 32, color: "var(--dim)", background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, padding: 0 }}>
                  <ChevronLeft size={16} /> Back to search
                </motion.button>

                <AnimatePresence mode="wait">

                  {/* ─── Success ─── */}
                  {uploadStep === "success" && (
                    <motion.div key="success" variants={scaleIn} initial="hidden" animate="visible"
                      style={{ textAlign: "center", padding: "40px 20px" }}>
                      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                        className="g-jade" style={{ width: 96, height: 96, borderRadius: 32, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 28px" }}>
                        <CheckCircle2 size={46} color="var(--jade)" />
                      </motion.div>
                      <motion.h2 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
                        className="serif" style={{ fontSize: 36, color: "#fff", marginBottom: 10 }}>
                        Photos Submitted!
                      </motion.h2>
                      <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
                        style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.7, maxWidth: 400, margin: "0 auto 32px" }}>
                        <strong style={{ color: "var(--jade)" }}>{uploadCount} photo{uploadCount !== 1 ? "s" : ""}</strong> pending organizer review. Once approved, they'll appear in the gallery.
                      </motion.p>
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
                        style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                        <button onClick={() => { setMode("search"); resetContrib(); }} className="btn-gold"
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                          Find My Photos <ArrowRight size={15} />
                        </button>
                        <button onClick={resetContrib} className="btn-ghost"
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                          <ImagePlus size={15} /> Upload More
                        </button>
                      </motion.div>
                    </motion.div>
                  )}

                  {/* ─── Drop zone ─── */}
                  {uploadStep === "drop" && (
                    <motion.div key="drop" variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                      <motion.div variants={fadeUp} style={{ marginBottom: 24 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
                          <div className="g-gold" style={{ width: 52, height: 52, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <CloudUpload size={26} color="var(--gold)" />
                          </div>
                          <div>
                            <h2 className="serif" style={{ fontSize: 30, color: "#fff", lineHeight: 1.1 }}>Share Your Photos</h2>
                            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>Contribute to the event gallery</p>
                          </div>
                        </div>
                      </motion.div>

                      <motion.label variants={fadeUp} htmlFor="contrib-upload" className="drop-zone"
                        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("over"); }}
                        onDragLeave={e => e.currentTarget.classList.remove("over")}
                        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("over"); addContribFiles(e.dataTransfer.files); }}
                        style={{ display: "block", border: "2px dashed var(--border)", borderRadius: 20, padding: "60px 32px", textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.015)" }}>
                        <input id="contrib-upload" type="file" multiple accept="image/*" style={{ display: "none" }}
                          onChange={e => addContribFiles(e.target.files)} />
                        <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                          style={{ width: 68, height: 68, borderRadius: 20, background: "var(--gold-dim)", border: "1px solid var(--gold-border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
                          <Upload size={30} color="var(--gold)" />
                        </motion.div>
                        <p style={{ color: "#fff", fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Drag & drop your event photos</p>
                        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 18 }}>or click to browse your gallery</p>
                        <div style={{ display: "inline-flex", gap: 7, flexWrap: "wrap", justifyContent: "center" }}>
                          {["JPG", "PNG", "HEIC", "WebP", "Max 30"].map(f => (
                            <span key={f} style={{ padding: "3px 10px", borderRadius: 6, background: "var(--surf)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.04em" }}>{f}</span>
                          ))}
                        </div>
                      </motion.label>

                      <motion.div variants={fadeUp} style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {[
                          { icon: Star,  text: "Clear, well-lit photos get approved faster" },
                          { icon: Users, text: "Group shots and candids are always welcome" },
                        ].map((tip, i) => {
                          const Icon = tip.icon;
                          return (
                            <div key={i} className="glass" style={{ borderRadius: 12, padding: "13px 15px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                              <Icon size={14} color="var(--gold)" style={{ marginTop: 2, flexShrink: 0 }} />
                              <p style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.5 }}>{tip.text}</p>
                            </div>
                          );
                        })}
                      </motion.div>
                    </motion.div>
                  )}

                  {/* ─── Preview & submit ─── */}
                  {(uploadStep === "preview" || uploadStep === "submitting") && (
                    <motion.div key="preview" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                        <div>
                          <h2 className="serif" style={{ fontSize: 26, color: "#fff" }}>
                            {contribFiles.length} Photo{contribFiles.length !== 1 ? "s" : ""} Selected
                          </h2>
                          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 3 }}>Review before submitting</p>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <label htmlFor="add-more-c"
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: "var(--surf)", border: "1px solid var(--border)", color: "var(--dim)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                            <input id="add-more-c" type="file" multiple accept="image/*" style={{ display: "none" }}
                              onChange={e => addContribFiles(e.target.files)} />
                            <ImagePlus size={14} /> Add more
                          </label>
                          <button onClick={() => { setContribFiles([]); setUploadStep("drop"); }}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: "transparent", border: "1px solid rgba(248,113,113,0.28)", color: "var(--rose)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                            <Trash2 size={14} /> Clear
                          </button>
                        </div>
                      </div>

                      <motion.div variants={stagger} initial="hidden" animate="visible"
                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px,1fr))", gap: 8, marginBottom: 20 }}>
                        {contribFiles.map((cf, idx) => (
                          <motion.div key={cf.id} variants={fadeUp} custom={idx}
                            className="contrib-thumb"
                            style={{ aspectRatio: "1", borderRadius: 10, overflow: "hidden", position: "relative", background: "var(--surf)", border: "1px solid var(--border)" }}>
                            <img src={cf.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            <div className="thumb-ov" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                              <button onClick={() => setSelectedPreview(cf)}
                                style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.14)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Eye size={14} color="#fff" />
                              </button>
                              <button onClick={() => removeContribFile(cf.id)}
                                style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(248,113,113,0.2)", border: "1px solid rgba(248,113,113,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <X size={14} color="var(--rose)" />
                              </button>
                            </div>
                            <div style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.6)", borderRadius: 5, padding: "1px 5px", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>
                              {(cf.file.size / 1024 / 1024).toFixed(1)}MB
                            </div>
                          </motion.div>
                        ))}
                      </motion.div>

                      <div className="glass" style={{ borderRadius: 16, padding: 20, marginBottom: 16 }}>
                        <h3 style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: 700, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          About You <span style={{ color: "var(--muted)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                        </h3>
                        <div style={{ display: "grid", gap: 12 }}>
                          <div>
                            <label style={{ display: "block", color: "var(--muted)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Your name</label>
                            <input type="text" value={contribName} onChange={e => setContribName(e.target.value)}
                              placeholder="e.g. Sarah M."
                              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "#fff", fontSize: 14, outline: "none", transition: "border-color 0.2s", fontFamily: "inherit" }}
                              onFocus={e => e.target.style.borderColor = "var(--gold-border)"}
                              onBlur={e => e.target.style.borderColor = "var(--border)"} />
                          </div>
                          <div>
                            <label style={{ display: "block", color: "var(--muted)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Note to organizer</label>
                            <textarea value={contribMsg} onChange={e => setContribMsg(e.target.value)}
                              placeholder="e.g. Photos from the after-party!" rows={2}
                              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "#fff", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit", transition: "border-color 0.2s" }}
                              onFocus={e => e.target.style.borderColor = "var(--gold-border)"}
                              onBlur={e => e.target.style.borderColor = "var(--border)"} />
                          </div>
                        </div>
                      </div>

                      <AnimatePresence>
                        {contribError && (
                          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", marginBottom: 16 }}>
                            <AlertCircle size={15} color="var(--rose)" style={{ flexShrink: 0 }} />
                            <p style={{ color: "var(--rose)", fontSize: 13 }}>{contribError}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => { setContribFiles([]); setUploadStep("drop"); }} className="btn-ghost"
                          style={{ padding: "13px 20px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                          Back
                        </button>
                        <motion.button
                          whileHover={{ scale: uploadStep === "submitting" ? 1 : 1.01 }}
                          whileTap={{ scale: uploadStep === "submitting" ? 1 : 0.98 }}
                          onClick={submitContrib}
                          disabled={uploadStep === "submitting" || !contribFiles.length}
                          className="btn-gold"
                          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "13px 20px", borderRadius: 12, fontSize: 15, cursor: uploadStep === "submitting" ? "not-allowed" : "pointer" }}>
                          {uploadStep === "submitting" ? (
                            <>
                              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                                <Loader2 size={17} />
                              </motion.div>
                              Uploading {contribFiles.length} photo{contribFiles.length !== 1 ? "s" : ""}…
                            </>
                          ) : (
                            <><CloudUpload size={17} /> Submit {contribFiles.length} Photo{contribFiles.length !== 1 ? "s" : ""}</>
                          )}
                        </motion.button>
                      </div>
                      <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
                        Photos are reviewed by the organizer before being added to the gallery.
                      </p>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* ══ FOOTER ══ */}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "22px 20px", textAlign: "center", position: "relative", zIndex: 1 }}>
        <p style={{ color: "var(--muted)", fontSize: 11 }}>
          © {new Date().getFullYear()} {APP_CONFIG.name} · Powered by AI Face Recognition
          {isPro && <span style={{ marginLeft: 10, color: "rgba(232,201,126,0.45)", fontSize: 10 }}>✦ Pro Plan</span>}
        </p>
      </footer>

      {/* ══════════ MODALS ══════════ */}

      {/* Camera */}
      <AnimatePresence>
        {cameraOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.97)", backdropFilter: "blur(24px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
            <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              className="glass" style={{ borderRadius: 24, overflow: "hidden", width: "100%", maxWidth: 380 }}>
              <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulseRing 1.5s ease infinite" }} />
                  <span className="serif" style={{ color: "#fff", fontSize: 16 }}>Take Your Selfie</span>
                </div>
                <button onClick={stopCamera} style={{ width: 30, height: 30, borderRadius: 8, background: "var(--surf)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--muted)" }}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ background: "#000", position: "relative" }}>
                <video ref={videoRef} autoPlay playsInline muted
                  style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", inset: 20, border: "1.5px solid rgba(232,201,126,0.3)", borderRadius: 16, pointerEvents: "none" }} />
              </div>
              <div style={{ padding: 14, display: "flex", gap: 10 }}>
                <button onClick={stopCamera} className="btn-ghost"
                  style={{ flex: 1, padding: "12px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>Cancel</button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={capturePhoto} className="btn-gold"
                  style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                  <Camera size={16} /> Capture
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Photo lightbox */}
      <AnimatePresence>
        {previewImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.97)", backdropFilter: "blur(28px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
            onClick={() => setPreviewImage(null)}>
            <motion.div initial={{ scale: 0.91 }} animate={{ scale: 1 }} exit={{ scale: 0.91 }}
              style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
              <img src={`${API}/public/events/${token}/image/${previewImage}`} alt=""
                style={{ maxHeight: "85vh", maxWidth: "88vw", borderRadius: 16, display: "block", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }} />

              {/* Scene + objects meta bar in lightbox */}
              {(() => {
                const currentItem = filteredItems[previewIndex];
                const scene = sceneOf(currentItem);
                const objects = objectsOf(currentItem);
                if (!scene && !objects.length) return null;
                return (
                  <div style={{
                    position: "absolute", top: 12, left: 12,
                    display: "flex", flexWrap: "wrap", gap: 5, maxWidth: "calc(100% - 60px)",
                  }}>
                    {scene && (
                      <div style={{
                        padding: "4px 10px", borderRadius: 7, background: "rgba(0,0,0,0.65)",
                        backdropFilter: "blur(10px)", fontSize: 11, fontWeight: 600,
                        color: "rgba(255,255,255,0.85)", textTransform: "capitalize",
                        letterSpacing: "0.05em", border: "1px solid rgba(255,255,255,0.1)",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                        {sceneIcon(scene)} {scene}
                      </div>
                    )}
                    {objects.slice(0, 3).map(obj => (
                      <span key={obj} className="object-badge" style={{ fontSize: 10, padding: "3px 8px" }}>{obj}</span>
                    ))}
                  </div>
                );
              })()}

              {/* Nav arrows */}
              {filteredItems.length > 1 && (
                <>
                  <button onClick={() => navPreview(-1)} className="glass"
                    style={{ position: "absolute", left: -52, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
                    <ChevronLeft size={18} />
                  </button>
                  <button onClick={() => navPreview(1)} className="glass"
                    style={{ position: "absolute", right: -52, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
                    <ChevronRight size={18} />
                  </button>
                </>
              )}

              {/* Bottom bar */}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(to top, rgba(0,0,0,0.95), transparent)", borderRadius: "0 0 16px 16px", padding: "28px 16px 14px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
                  {previewIndex + 1} / {filteredItems.length}{tab.has_more ? "+" : ""}
                </span>
                <button
                  onClick={() => downloadSinglePhoto(previewImage)}
                  className="btn-gold"
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
                >
                  <Download size={14} /> Download
                </button>
              </div>

              <button onClick={() => setPreviewImage(null)} className="glass"
                style={{ position: "absolute", top: 10, right: 10, width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
                <X size={14} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contrib file preview */}
      <AnimatePresence>
        {selectedPreview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.96)", backdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
            onClick={() => setSelectedPreview(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()} style={{ position: "relative" }}>
              <img src={selectedPreview.preview} alt=""
                style={{ maxHeight: "82vh", maxWidth: "88vw", borderRadius: 14, display: "block", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }} />
              <div className="glass" style={{ position: "absolute", bottom: 12, left: 12, right: 12, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{selectedPreview.file.name}</span>
                <button onClick={() => { removeContribFile(selectedPreview.id); setSelectedPreview(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7, background: "rgba(248,113,113,0.14)", border: "1px solid rgba(248,113,113,0.28)", color: "var(--rose)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Trash2 size={12} /> Remove
                </button>
              </div>
              <button onClick={() => setSelectedPreview(null)} className="glass"
                style={{ position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
                <X size={13} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Info modal */}
      <AnimatePresence>
        {showInfo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.87)", backdropFilter: "blur(16px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
            onClick={() => setShowInfo(false)}>
            <motion.div initial={{ scale: 0.93, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.93, y: 16 }}
              className="glass" style={{ borderRadius: 24, padding: 32, width: "100%", maxWidth: 380 }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                <h3 className="serif" style={{ fontSize: 24, color: "#fff" }}>How It Works</h3>
                <button onClick={() => setShowInfo(false)}
                  style={{ width: 30, height: 30, borderRadius: 8, background: "var(--surf)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--muted)" }}>
                  <X size={13} />
                </button>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24, lineHeight: 1.65 }}>
                Our AI uses facial recognition to find every photo where you appear — across the entire event gallery.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                {[
                  { icon: Camera,           n: "01", title: "Upload your selfie",       desc: "A clear front-facing photo works best"                       },
                  { icon: Scan,             n: "02", title: "AI finds your face",       desc: "Every event photo is scanned instantly"                      },
                  { icon: MapPin,           n: "03", title: "Filter by scene",          desc: "Browse ceremony, dinner, party shots by AI scene labels"      },
                  { icon: Tag,              n: "04", title: "Filter by objects",        desc: "Find photos with specific items — cake, flowers, and more"    },
                  { icon: Download,         n: "05", title: "Browse & download",        desc: "Scroll your matches, download any photo"                     },
                  ...(guestUpload ? [{ icon: CloudUpload, n: "06", title: "Share your photos", desc: "Contribute shots for organizer review" }] : []),
                ].map(step => {
                  const Icon = step.icon;
                  return (
                    <div key={step.n} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div className="g-gold" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={16} color="var(--gold)" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ color: "#fff", fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{step.title}</p>
                        <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.55 }}>{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => setShowInfo(false)} className="btn-gold"
                style={{ width: "100%", marginTop: 28, padding: "13px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                Got it
              </button>
              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 14 }}>
                Your selfie is never stored on our servers
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}