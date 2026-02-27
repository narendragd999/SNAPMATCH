"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Camera, Download, X, Info, Scan,
  ChevronLeft, ChevronRight, ImageIcon, RefreshCw,
  ImagePlus, CheckCircle2, Users, Sparkles,
  ArrowRight, Heart, Loader2, ZoomIn, Star,
  AlertCircle, CloudUpload, Trash2, Eye,
  Filter, RotateCcw,
} from "lucide-react";
import { APP_CONFIG } from "@/config/app";

/* ─── Types ────────────────────────────────────────────────── */
interface PageData {
  result_id: string; page: number; page_size: number;
  total: number; total_pages: number; has_more: boolean; items: any[];
}
interface SearchResult { result_id: string; you: PageData; friends: PageData; }
interface TabState {
  items: any[]; page: number; total: number;
  has_more: boolean; loading: boolean; error: string | null;
}
interface ContribFile { file: File; preview: string; id: string; }
type Mode = "search" | "contribute";
type UploadStep = "drop" | "preview" | "submitting" | "success";

const emptyTab = (): TabState => ({
  items: [], page: 1, total: 0, has_more: false, loading: false, error: null,
});

/* ─── Helpers ───────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2);
const nameOf = (item: any): string =>
  typeof item === "string" ? item : item?.image_name ?? "";

/** Extract scene_label from an item (string items have no scene, object items do) */
const sceneOf = (item: any): string | null =>
  typeof item === "string" ? null : (item?.scene_label ?? null);

const objectsOf = (item: any): string[] =>
  typeof item === "string" ? [] : (item?.objects ?? []);

/** Cleaned, human-friendly scene name from a raw Places365 label */
const SCENE_DISPLAY: Record<string, { name: string; emoji: string }> = {
  beach:            { name: "Beach",         emoji: "🏖️" },
  botanical_garden: { name: "Garden",         emoji: "🌿" },
  classroom:        { name: "Classroom",      emoji: "🎓" },
  lecture_room:     { name: "Lecture Room",   emoji: "🎓" },
  "stage/indoor":   { name: "Stage",          emoji: "🎉" },
  auditorium:       { name: "Auditorium",     emoji: "🎉" },
  ballroom:         { name: "Ballroom",       emoji: "🎉" },
  banquet_hall:     { name: "Banquet Hall",   emoji: "🎉" },
  wedding_reception:{ name: "Wedding",        emoji: "💍" },
  restaurant:       { name: "Restaurant",     emoji: "🍽️" },
  cafeteria:        { name: "Cafeteria",      emoji: "🍽️" },
  "mosque/outdoor": { name: "Mosque",         emoji: "🕌" },
  "temple/india":   { name: "Temple",         emoji: "🛕" },
  art_gallery:      { name: "Art Gallery",    emoji: "🖼️" },
  berth:            { name: "Train Berth",    emoji: "🚆" },
  airplane_cabin:   { name: "Airplane",       emoji: "✈️" },
  clothing_store:   { name: "Clothing Store", emoji: "👗" },
  village:          { name: "Village",        emoji: "🌿" },
  living_room:      { name: "Living Room",    emoji: "🏠" },
  office:           { name: "Office",         emoji: "💼" },
  office_cubicles:  { name: "Office",         emoji: "💼" },
  park:             { name: "Park",           emoji: "🌳" },
  amusement_park:   { name: "Amusement Park", emoji: "🎡" },
  beer_garden:      { name: "Beer Garden",    emoji: "🍺" },
  "stage/outdoor":  { name: "Outdoor Stage",  emoji: "🎉" },
  medina:           { name: "Medina",         emoji: "🏛️" },
  "art_school":     { name: "Art School",     emoji: "🎨" },
  art_studio:       { name: "Art Studio",     emoji: "🎨" },
  amusement:        { name: "Amusement",      emoji: "🎡" },
};

// Labels to never show as filter chips (noise)
const HIDDEN_SCENES = new Set([
  "slum","butchers_shop","biology_laboratory","parking_lot",
  "closet","storage_room","clean_room","nursing_home","phone_booth",
]);

function displayScene(raw: string | null): { name: string; emoji: string } | null {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/ /g, "_");
  if (HIDDEN_SCENES.has(key)) return null;
  if (SCENE_DISPLAY[key]) return SCENE_DISPLAY[key];
  // Fallback: prettify raw label
  return {
    name: raw.replace(/_/g, " ").replace(/\//g, " / ").replace(/\b\w/g, c => c.toUpperCase()),
    emoji: "📸",
  };
}

/** Get unique relevant scene labels from a list of photo items */
function extractScenes(items: any[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const s = sceneOf(item);
    if (s && !HIDDEN_SCENES.has(s.toLowerCase()) && !seen.has(s)) {
      seen.add(s);
      result.push(s);
    }
  }
  return result;
}

/* ─── Animation variants ────────────────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] } }),
};
const scaleIn = {
  hidden: { opacity: 0, scale: 0.88 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};
const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

/* ═══════════════════════════════════════════════════════════
   SCENE FILTER CHIPS COMPONENT
═══════════════════════════════════════════════════════════ */
function SceneFilterBar({
  scenes,
  activeScene,
  onSelect,
  onReset,
}: {
  scenes: string[];
  activeScene: string | null;
  onSelect: (s: string | null) => void;
  onReset: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 5;
  const visible = expanded ? scenes : scenes.slice(0, MAX_VISIBLE);

  if (scenes.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ marginBottom: 20 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Filter size={12} color="var(--text-muted)" />
          <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Scene</span>
        </div>

        {/* All chip */}
        <button
          onClick={onReset}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: !activeScene ? "var(--gold-dim)" : "var(--surface)",
            border: !activeScene ? "1px solid var(--gold-border)" : "1px solid var(--border)",
            color: !activeScene ? "var(--gold)" : "var(--text-dim)",
            transition: "all 0.2s",
          }}
        >
          All
        </button>

        {/* Scene chips */}
        {visible.map(raw => {
          const d = displayScene(raw);
          if (!d) return null;
          const isActive = activeScene === raw;
          return (
            <button
              key={raw}
              onClick={() => onSelect(isActive ? null : raw)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: isActive ? "var(--gold-dim)" : "var(--surface)",
                border: isActive ? "1px solid var(--gold-border)" : "1px solid var(--border)",
                color: isActive ? "var(--gold)" : "var(--text-dim)",
                transition: "all 0.2s",
              }}
            >
              <span style={{ fontSize: 13 }}>{d.emoji}</span>
              {d.name}
            </button>
          );
        })}

        {/* Show more / less */}
        {scenes.length > MAX_VISIBLE && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
              background: "var(--surface)", border: "1px solid var(--border)",
              color: "var(--text-muted)", transition: "all 0.2s",
            }}
          >
            {expanded ? "Show less" : `+${scenes.length - MAX_VISIBLE} more`}
          </button>
        )}

        {/* Reset active filter */}
        {activeScene && (
          <button
            onClick={onReset}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "5px 10px", borderRadius: 99, fontSize: 11, cursor: "pointer",
              background: "transparent", border: "1px solid rgba(248,113,113,0.3)",
              color: "#f87171", transition: "all 0.2s",
            }}
          >
            <RotateCcw size={10} />
            Reset
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════ */
export default function PublicSelfiePage() {
  const params = useParams();
  const token  = params?.token as string;
  const API    = process.env.NEXT_PUBLIC_API_URL;

  /* ── State ── */
  const [event,        setEvent]        = useState<any>(null);
  const [mode,         setMode]         = useState<Mode>("search");
  const [resultId,     setResultId]     = useState<string | null>(null);
  const [activeTab,    setActiveTab]    = useState<"you" | "friends">("you");
  const [tabs,         setTabs]         = useState<Record<"you"|"friends", TabState>>({ you: emptyTab(), friends: emptyTab() });
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [cameraOpen,   setCameraOpen]   = useState(false);
  const [processing,   setProcessing]   = useState(false);
  const [showInfo,     setShowInfo]     = useState(false);
  const [dragOver,     setDragOver]     = useState(false);

  /* Scene filter — separate per tab */
  const [youScene,     setYouScene]     = useState<string | null>(null);
  const [friendsScene, setFriendsScene] = useState<string | null>(null);
  const [youScenes,    setYouScenes]    = useState<string[]>([]);
  const [friendsScenes,setFriendsScenes]= useState<string[]>([]);

  /* Contribute */
  const [uploadStep,   setUploadStep]   = useState<UploadStep>("drop");
  const [contribFiles, setContribFiles] = useState<ContribFile[]>([]);
  const [contribName,  setContribName]  = useState("");
  const [contribMsg,   setContribMsg]   = useState("");
  const [contribError, setContribError] = useState<string | null>(null);
  const [uploadCount,  setUploadCount]  = useState(0);
  const [selectedPreview, setSelectedPreview] = useState<ContribFile | null>(null);

  /* Refs */
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const sentinelRef  = useRef<HTMLDivElement | null>(null);
  const observerRef  = useRef<IntersectionObserver | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tab          = tabs[activeTab];

  /* Filtered items for current tab */
  const activeScene  = activeTab === "you" ? youScene : friendsScene;
  const currentItems = activeScene
    ? tab.items.filter(item => sceneOf(item) === activeScene)
    : tab.items;

  const guestUpload  = true;

  /* ── Load event ── */
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}`).then(r => r.json()).then(setEvent);
  }, [token]);

  /* Reset scene filters when tab changes */
  useEffect(() => {
    // Don't reset — keep each tab's filter independent
  }, [activeTab]);

  /* ── Face search ── */
  const handleUpload = async (file: File) => {
    setProcessing(true);
    setResultId(null);
    setTabs({ you: emptyTab(), friends: emptyTab() });
    setYouScene(null);
    setFriendsScene(null);
    setYouScenes([]);
    setFriendsScenes([]);

    try {
      const form = new FormData();
      form.append("file", file);
      const res  = await fetch(`${API}/public/events/${token}/search`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data: SearchResult = await res.json();

      setResultId(data.result_id);
      setTabs({
        you:     { items: data.you.items,     page: 1, total: data.you.total,     has_more: data.you.has_more,     loading: false, error: null },
        friends: { items: data.friends.items, page: 1, total: data.friends.total, has_more: data.friends.has_more, loading: false, error: null },
      });

      // Build scene lists from page 1 items
      setYouScenes(extractScenes(data.you.items));
      setFriendsScenes(extractScenes(data.friends.items));

      setTimeout(() => document.getElementById("results-section")?.scrollIntoView({ behavior: "smooth" }), 300);
    } catch (err) { console.error(err); }
    finally { setProcessing(false); }
  };

  /* ── Infinite scroll ── */
  const loadNextPage = useCallback(async () => {
    const t = tabs[activeTab];
    // Don't load more while a scene filter is active (we already have the filtered subset loaded)
    if (!resultId || t.loading || !t.has_more || activeScene) return;
    const nextPage = t.page + 1;
    setTabs(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], loading: true, error: null } }));
    try {
      const res = await fetch(`${API}/public/events/${token}/search/${resultId}?kind=${activeTab}&page=${nextPage}`);
      if (res.status === 404) { setTabs(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], loading: false, has_more: false, error: "Session expired." } })); return; }
      if (!res.ok) throw new Error(await res.text());
      const data: PageData = await res.json();

      setTabs(prev => ({
        ...prev,
        [activeTab]: {
          items: [...prev[activeTab].items, ...data.items],
          page: data.page, total: data.total, has_more: data.has_more,
          loading: false, error: null,
        },
      }));

      // Add any new scenes from this page
      const newScenes = extractScenes(data.items);
      if (activeTab === "you") {
        setYouScenes(prev => [...prev, ...newScenes.filter(s => !prev.includes(s))]);
      } else {
        setFriendsScenes(prev => [...prev, ...newScenes.filter(s => !prev.includes(s))]);
      }

    } catch { setTabs(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], loading: false, error: "Failed to load more." } })); }
  }, [tabs, activeTab, activeScene, resultId, token, API]);

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(e => { if (e[0].isIntersecting) loadNextPage(); }, { rootMargin: "300px" });
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [loadNextPage]);

  /* ── Camera ── */
  const startCamera = async () => {
    setCameraOpen(true);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    streamRef.current = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
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
    const valid = Array.from(fl)
      .filter(f => f.type.startsWith("image/"))
      .map(f => ({ file: f, preview: URL.createObjectURL(f), id: uid() }));
    setContribFiles(prev => [...prev, ...valid].slice(0, 30));
    setContribError(null);
    if (valid.length) setUploadStep("preview");
  };

  const removeContribFile = (id: string) => {
    setContribFiles(prev => {
      const updated = prev.filter(f => f.id !== id);
      if (updated.length === 0) setUploadStep("drop");
      return updated;
    });
  };

  const submitContrib = async () => {
    if (!contribFiles.length) return;
    setUploadStep("submitting");
    setContribError(null);
    try {
      const form = new FormData();
      contribFiles.forEach(f => form.append("files", f.file));
      if (contribName.trim()) form.append("contributor_name", contribName.trim());
      if (contribMsg.trim())  form.append("message", contribMsg.trim());
      const res = await fetch(`${API}/public/events/${token}/contribute`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUploadCount(data.uploaded ?? contribFiles.length);
      setContribFiles([]);
      setContribName("");
      setContribMsg("");
      setUploadStep("success");
    } catch (err) {
      setContribError(err instanceof Error ? err.message : "Upload failed");
      setUploadStep("preview");
    }
  };

  const navPreview = (dir: number) => {
    const next = Math.max(0, Math.min(previewIndex + dir, currentItems.length - 1));
    setPreviewIndex(next);
    setPreviewImage(nameOf(currentItems[next]));
  };

  const resetContrib = () => {
    setUploadStep("drop");
    setContribFiles([]);
    setContribName("");
    setContribMsg("");
    setContribError(null);
  };

  /* ── Scene reset helpers ── */
  const resetYouScene     = () => setYouScene(null);
  const resetFriendsScene = () => setFriendsScene(null);

  /* ══════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #0a0a0f 0%, #0f0f1a 50%, #0a0a0f 100%)", fontFamily: "'Outfit', 'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&display=swap');
        :root {
          --gold: #e8c97e;
          --gold-light: #f5e0a6;
          --gold-dim: rgba(232,201,126,0.15);
          --gold-border: rgba(232,201,126,0.25);
          --surface: rgba(255,255,255,0.04);
          --surface-hover: rgba(255,255,255,0.07);
          --border: rgba(255,255,255,0.08);
          --text-muted: rgba(255,255,255,0.35);
          --text-dim: rgba(255,255,255,0.55);
          --jade: #4ade80;
          --jade-dim: rgba(74,222,128,0.15);
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--gold-border); border-radius: 4px; }

        .glass { background: var(--surface); border: 1px solid var(--border); backdrop-filter: blur(20px); }
        .glass-gold { background: var(--gold-dim); border: 1px solid var(--gold-border); }
        .glass-jade { background: var(--jade-dim); border: 1px solid rgba(74,222,128,0.25); }

        .btn-gold {
          background: linear-gradient(135deg, #e8c97e, #d4a843);
          color: #0a0a0f; font-weight: 700; letter-spacing: 0.02em;
          transition: all 0.2s ease; border: none;
          box-shadow: 0 4px 20px rgba(232,201,126,0.25);
        }
        .btn-gold:hover { transform: translateY(-1px); box-shadow: 0 8px 32px rgba(232,201,126,0.4); filter: brightness(1.05); }
        .btn-gold:active { transform: translateY(0); }
        .btn-gold:disabled { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.2); box-shadow: none; transform: none; filter: none; }

        .btn-ghost {
          background: var(--surface); border: 1px solid var(--border);
          color: rgba(255,255,255,0.7); font-weight: 600;
          transition: all 0.2s ease;
        }
        .btn-ghost:hover { background: var(--surface-hover); color: #fff; }

        .serif { font-family: 'Cormorant Garamond', Georgia, serif; }

        .photo-card { transition: transform 0.25s ease, box-shadow 0.25s ease; cursor: pointer; overflow: hidden; }
        .photo-card:hover { transform: scale(1.03); box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
        .photo-card:hover .photo-overlay { opacity: 1; }
        .photo-overlay { opacity: 0; transition: opacity 0.2s ease; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 60%); }

        .drop-zone { transition: all 0.25s ease; }
        .drop-zone.active { border-color: var(--gold) !important; background: var(--gold-dim) !important; }

        .contrib-thumb { transition: all 0.2s ease; }
        .contrib-thumb:hover .thumb-overlay { opacity: 1; }
        .thumb-overlay { opacity: 0; transition: opacity 0.2s ease; }

        .pulse-ring {
          animation: pulseRing 2s ease infinite;
        }
        @keyframes pulseRing {
          0%   { box-shadow: 0 0 0 0 rgba(232,201,126,0.4); }
          70%  { box-shadow: 0 0 0 16px rgba(232,201,126,0); }
          100% { box-shadow: 0 0 0 0 rgba(232,201,126,0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .shimmer-text {
          background: linear-gradient(90deg, var(--gold) 0%, var(--gold-light) 40%, var(--gold) 60%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 4s linear infinite;
        }
        .tab-active {
          background: var(--gold-dim);
          color: var(--gold);
          border-color: var(--gold-border);
        }
        .scene-badge {
          position: absolute; bottom: 8px; left: 8px;
          display: flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 99px;
          background: rgba(10,10,15,0.80); backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.1);
          font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.75);
          pointer-events: none;
        }
        .sim-badge {
          position: absolute; top: 8px; right: 8px;
          padding: 3px 8px; border-radius: 99px;
          background: var(--gold-dim); border: 1px solid var(--gold-border);
          font-size: 10px; font-weight: 700; color: var(--gold);
          pointer-events: none;
        }
        .friends-badge {
          position: absolute; top: 8px; left: 8px;
          padding: 3px 8px; border-radius: 99px;
          background: rgba(99,102,241,0.25); border: 1px solid rgba(99,102,241,0.35);
          font-size: 10px; font-weight: 600; color: #a5b4fc;
          pointer-events: none;
        }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, background: "rgba(10,10,15,0.85)", backdropFilter: "blur(24px)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "0 20px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="pulse-ring" style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg, #e8c97e, #c4882a)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles size={17} color="#0a0a0f" />
            </div>
            <div>
              <p className="serif" style={{ color: "#fff", fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}>
                {event?.name || "Event Photos"}
              </p>
              <p style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                AI · Face Recognition
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {guestUpload && mode === "search" && (
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setMode("contribute")}
                className="glass"
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--gold)" }}
              >
                <CloudUpload size={15} />
                Share Photos
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowInfo(true)}
              className="glass"
              style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-dim)" }}
            >
              <Info size={16} />
            </motion.button>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main style={{ paddingTop: 80, paddingBottom: 80, minHeight: "100vh" }}>
        <AnimatePresence mode="wait">

          {/* ════════ SEARCH MODE ════════ */}
          {mode === "search" && (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }}>

              {/* Hero — only when no results */}
              {!resultId && !processing && (
                <motion.section
                  variants={stagger} initial="hidden" animate="visible"
                  style={{ maxWidth: 680, margin: "0 auto", padding: "60px 20px 40px", textAlign: "center" }}
                >
                  {/* Icon */}
                  <motion.div variants={fadeUp} style={{ display: "inline-flex", marginBottom: 28 }}>
                    <div className="glass-gold" style={{ width: 90, height: 90, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Scan size={42} color="var(--gold)" strokeWidth={1.5} />
                    </div>
                  </motion.div>

                  <motion.h1 variants={fadeUp} className="serif shimmer-text" style={{ fontSize: "clamp(36px,6vw,60px)", fontWeight: 600, lineHeight: 1.1, marginBottom: 16 }}>
                    Find Yourself<br />in Every Photo
                  </motion.h1>

                  <motion.p variants={fadeUp} style={{ color: "var(--text-dim)", fontSize: 16, lineHeight: 1.7, marginBottom: 40, maxWidth: 440, margin: "0 auto 40px" }}>
                    Upload a selfie — AI will scan every event photo and find your matches instantly.
                  </motion.p>

                  {/* CTA buttons */}
                  <motion.div variants={fadeUp} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24, maxWidth: 440, margin: "0 auto 24px" }}>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={startCamera}
                      className="btn-gold"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "15px 20px", borderRadius: 14, fontSize: 15, cursor: "pointer" }}
                    >
                      <Camera size={18} /> Take Selfie
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-ghost"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "15px 20px", borderRadius: 14, fontSize: 15, cursor: "pointer" }}
                    >
                      <Upload size={18} /> Upload Photo
                    </motion.button>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ display: "none" }} />
                  </motion.div>

                  {/* Drag & drop zone */}
                  <motion.div variants={fadeUp}>
                    <motion.div
                      className={`drop-zone ${dragOver ? "active" : ""}`}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                      style={{ border: "2px dashed var(--border)", borderRadius: 16, padding: "20px", marginTop: 0, color: "var(--text-muted)", fontSize: 13, cursor: "default", maxWidth: 440, margin: "0 auto" }}
                    >
                      <p>or drag & drop your selfie here</p>
                    </motion.div>
                  </motion.div>

                  {/* Steps */}
                  <motion.div variants={stagger} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 48, maxWidth: 500, margin: "48px auto 0" }}>
                    {[
                      { icon: Camera,   label: "Snap a selfie",    n: "01" },
                      { icon: Scan,     label: "AI scans photos",   n: "02" },
                      { icon: Download, label: "Download yours",    n: "03" },
                    ].map(step => {
                      const Icon = step.icon;
                      return (
                        <motion.div key={step.n} variants={fadeUp} className="glass" style={{ borderRadius: 14, padding: "18px 12px", textAlign: "center" }}>
                          <p style={{ color: "var(--gold)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 10 }}>{step.n}</p>
                          <Icon size={20} color="var(--gold)" style={{ margin: "0 auto 10px" }} />
                          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 500, lineHeight: 1.4 }}>{step.label}</p>
                        </motion.div>
                      );
                    })}
                  </motion.div>

                  {/* Contribute CTA */}
                  {guestUpload && (
                    <motion.div variants={fadeUp} style={{ marginTop: 32 }}>
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={() => setMode("contribute")}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, background: "rgba(232,201,126,0.08)", border: "1px solid var(--gold-border)", color: "var(--gold)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.2s" }}
                      >
                        <ImagePlus size={15} />
                        Share your event photos
                        <ArrowRight size={14} />
                      </motion.button>
                    </motion.div>
                  )}
                </motion.section>
              )}

              {/* Processing */}
              {processing && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ maxWidth: 480, margin: "60px auto", padding: "0 20px" }}>
                  <div className="glass" style={{ borderRadius: 24, padding: "52px 32px", textAlign: "center" }}>
                    <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 24px" }}>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        style={{ width: 72, height: 72, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "var(--gold)", borderRightColor: "var(--gold-border)", position: "absolute" }}
                      />
                      <div className="glass-gold" style={{ position: "absolute", inset: 8, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Scan size={22} color="var(--gold)" />
                      </div>
                    </div>
                    <h3 className="serif" style={{ color: "#fff", fontSize: 22, marginBottom: 8 }}>Scanning Photos…</h3>
                    <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>AI is finding your face across every event photo. This takes just a moment.</p>
                    <div style={{ marginTop: 28, height: 3, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                      <motion.div
                        animate={{ x: ["-100%", "100%"] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                        style={{ height: "100%", width: "50%", background: "linear-gradient(90deg, transparent, var(--gold), transparent)", borderRadius: 99 }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Results */}
              {resultId && !processing && (
                <motion.section id="results-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px 0" }}>

                  {/* Tab bar + New Search */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {/* Your Photos tab */}
                      <button
                        onClick={() => setActiveTab("you")}
                        className={activeTab === "you" ? "tab-active" : ""}
                        style={{
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "8px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                          border: "1px solid var(--border)", background: "transparent",
                          color: activeTab === "you" ? undefined : "var(--text-dim)",
                          transition: "all 0.2s",
                        }}
                      >
                        <Camera size={14} />
                        Your Photos
                        {tabs.you.total > 0 && (
                          <span style={{ padding: "2px 7px", borderRadius: 99, background: "rgba(255,255,255,0.08)", fontSize: 11, fontWeight: 700 }}>
                            {tabs.you.total}
                          </span>
                        )}
                      </button>

                      {/* Friends Nearby tab */}
                      <button
                        onClick={() => setActiveTab("friends")}
                        className={activeTab === "friends" ? "tab-active" : ""}
                        style={{
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "8px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                          border: "1px solid var(--border)", background: "transparent",
                          color: activeTab === "friends" ? undefined : "var(--text-dim)",
                          transition: "all 0.2s",
                        }}
                      >
                        <Users size={14} />
                        Friends Nearby
                        {tabs.friends.total > 0 && (
                          <span style={{ padding: "2px 7px", borderRadius: 99, background: "rgba(255,255,255,0.08)", fontSize: 11, fontWeight: 700 }}>
                            {tabs.friends.total}
                          </span>
                        )}
                      </button>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => { setResultId(null); setTabs({ you: emptyTab(), friends: emptyTab() }); setYouScene(null); setFriendsScene(null); setYouScenes([]); setFriendsScenes([]); }}
                      className="btn-ghost"
                      style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
                    >
                      <RefreshCw size={14} /> New Search
                    </motion.button>
                  </div>

                  {/* ── Context callout per tab ── */}
                  <AnimatePresence mode="wait">
                    {activeTab === "you" && tabs.you.total > 0 && (
                      <motion.div
                        key="you-context"
                        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "var(--gold-dim)", border: "1px solid var(--gold-border)", marginBottom: 16 }}
                      >
                        <Camera size={13} color="var(--gold)" style={{ flexShrink: 0 }} />
                        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, lineHeight: 1.5 }}>
                          <strong style={{ color: "var(--gold)" }}>{tabs.you.total} photos</strong> where you appear — AI-matched by face recognition
                        </p>
                      </motion.div>
                    )}
                    {activeTab === "friends" && (
                      <motion.div
                        key="friends-context"
                        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", marginBottom: 16 }}
                      >
                        <Users size={13} color="#a5b4fc" style={{ flexShrink: 0, marginTop: 1 }} />
                        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 12, lineHeight: 1.6 }}>
                          {tabs.friends.total > 0
                            ? <><strong style={{ color: "#a5b4fc" }}>{tabs.friends.total} photos</strong> of people who attended the event alongside you — <em>different</em> photos where you don't appear but your co-attendees do</>
                            : <>No co-attendees found. Friends Nearby shows photos of people from the same sessions as you — if it's empty, you may have attended solo, or try re-searching with a clearer selfie.</>
                          }
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ── Scene filter chips ── */}
                  {activeTab === "you" && (
                    <SceneFilterBar
                      scenes={youScenes}
                      activeScene={youScene}
                      onSelect={setYouScene}
                      onReset={resetYouScene}
                    />
                  )}
                  {activeTab === "friends" && (
                    <SceneFilterBar
                      scenes={friendsScenes}
                      activeScene={friendsScene}
                      onSelect={setFriendsScene}
                      onReset={resetFriendsScene}
                    />
                  )}

                  {/* Grid */}
                  {currentItems.length > 0 ? (
                    <>
                      <motion.div
                        variants={stagger} initial="hidden" animate="visible"
                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}
                      >
                        {currentItems.map((item, idx) => {
                          const imgName = nameOf(item);
                          const scene   = displayScene(sceneOf(item));
                          const sim     = typeof item === "object" ? item?.similarity : null;
                          const isFriend = activeTab === "friends";

                          return (
                            <motion.div
                              key={idx} variants={fadeUp} custom={idx % 6}
                              className="photo-card"
                              style={{ aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "var(--surface)", border: "1px solid var(--border)", position: "relative" }}
                              onClick={() => { setPreviewIndex(idx); setPreviewImage(imgName); }}
                            >
                              <img
                                src={`${API}/public/events/${token}/image/${imgName}`}
                                alt=""
                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                              />

                              {/* Hover overlay */}
                              <div className="photo-overlay" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "10px" }}>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <ZoomIn size={14} color="#fff" />
                                  </div>
                                </div>
                                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>{idx + 1}/{tab.total}{tab.has_more ? "+" : ""}</span>
                              </div>

                              {/* AI similarity badge (Your Photos only) */}
                              {!isFriend && sim && (
                                <div className="sim-badge">{Math.round(sim * 100)}%</div>
                              )}

                              {/* Friends badge */}
                              {isFriend && (
                                <div className="friends-badge">
                                  <Users size={9} style={{ marginRight: 3 }} />friend
                                </div>
                              )}

                              {/* Scene badge */}
                              {scene && (
                                <div className="scene-badge">
                                  <span>{scene.emoji}</span>
                                  <span>{scene.name}</span>
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </motion.div>

                      <div ref={sentinelRef} style={{ height: 4 }} />
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "32px 0" }}>
                        {tab.loading && <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}><Loader2 size={22} color="var(--gold)" /></motion.div>}
                        {!tab.loading && !tab.has_more && tab.total > 0 && !activeScene && (
                          <p style={{ color: "var(--text-muted)", fontSize: 12 }}>All {tab.total} photos loaded ✓</p>
                        )}
                        {activeScene && !tab.loading && (
                          <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                            Showing {currentItems.length} of {tab.total} photos filtered by scene
                          </p>
                        )}
                        {tab.error && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#f87171" }}>
                            <AlertCircle size={14} /> {tab.error}
                            <button onClick={loadNextPage} style={{ color: "var(--gold)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                              <RefreshCw size={12} /> Retry
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 20px", gap: 16, textAlign: "center" }}>
                      <div className="glass" style={{ width: 72, height: 72, borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ImageIcon size={28} color="var(--text-muted)" />
                      </div>
                      <div>
                        {activeScene ? (
                          <>
                            <p style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, marginBottom: 6 }}>No photos in this scene</p>
                            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, maxWidth: 260 }}>
                              Try a different scene or clear the filter to see all.
                            </p>
                            <button
                              onClick={activeTab === "you" ? resetYouScene : resetFriendsScene}
                              style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, background: "var(--gold-dim)", border: "1px solid var(--gold-border)", color: "var(--gold)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                            >
                              <RotateCcw size={13} /> Clear filter
                            </button>
                          </>
                        ) : activeTab === "friends" ? (
                          <>
                            <p style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, marginBottom: 6 }}>No friends found nearby</p>
                            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, maxWidth: 300 }}>
                              Friends Nearby shows photos of people who attended alongside you. Try searching with a clearer, front-facing selfie.
                            </p>
                          </>
                        ) : (
                          <>
                            <p style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, marginBottom: 6 }}>No matches found</p>
                            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, maxWidth: 260 }}>Try a clear, front-facing selfie with good lighting for better results.</p>
                          </>
                        )}
                      </div>
                      {!activeScene && (
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => { setResultId(null); setTabs({ you: emptyTab(), friends: emptyTab() }); setYouScene(null); setFriendsScene(null); }} className="btn-gold" style={{ padding: "10px 20px", borderRadius: 10, fontSize: 13, cursor: "pointer" }}>
                          Try Again
                        </motion.button>
                      )}
                    </motion.div>
                  )}
                </motion.section>
              )}
            </motion.div>
          )}

          {/* ════════ CONTRIBUTE MODE ════════ */}
          {mode === "contribute" && (
            <motion.div key="contribute" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}>
              <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px" }}>

                {/* Back */}
                <motion.button
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  onClick={() => { setMode("search"); resetContrib(); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 32, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500, padding: 0 }}
                >
                  <ChevronLeft size={16} /> Back to search
                </motion.button>

                <AnimatePresence mode="wait">

                  {/* ─── SUCCESS ─── */}
                  {uploadStep === "success" && (
                    <motion.div key="success" variants={scaleIn} initial="hidden" animate="visible" style={{ textAlign: "center", padding: "40px 20px" }}>
                      <motion.div
                        initial={{ scale: 0 }} animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
                        className="glass-jade"
                        style={{ width: 96, height: 96, borderRadius: 32, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 28px" }}
                      >
                        <CheckCircle2 size={46} color="var(--jade)" />
                      </motion.div>
                      <motion.h2 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="serif" style={{ fontSize: 36, color: "#fff", marginBottom: 10 }}>
                        Photos Submitted!
                      </motion.h2>
                      <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} style={{ color: "var(--text-dim)", fontSize: 15, lineHeight: 1.7, maxWidth: 400, margin: "0 auto 32px" }}>
                        <strong style={{ color: "var(--jade)" }}>{uploadCount} photo{uploadCount !== 1 ? "s" : ""}</strong> are pending organizer review. Once approved, they'll appear in the gallery.
                      </motion.p>
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                        <button onClick={() => { setMode("search"); resetContrib(); }} className="btn-gold" style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                          Find My Photos <ArrowRight size={15} />
                        </button>
                        <button onClick={resetContrib} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                          <ImagePlus size={15} /> Upload More
                        </button>
                      </motion.div>
                    </motion.div>
                  )}

                  {/* ─── DROP ZONE ─── */}
                  {uploadStep === "drop" && (
                    <motion.div key="drop" variants={stagger} initial="hidden" animate="visible" exit={{ opacity: 0 }}>
                      <motion.div variants={fadeUp} style={{ marginBottom: 28 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
                          <div className="glass-gold" style={{ width: 52, height: 52, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <CloudUpload size={26} color="var(--gold)" />
                          </div>
                          <div>
                            <h2 className="serif" style={{ fontSize: 30, color: "#fff", lineHeight: 1.1 }}>Share Your Photos</h2>
                            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>Contribute to the event gallery</p>
                          </div>
                        </div>
                      </motion.div>

                      {/* Big drop zone */}
                      <motion.div variants={fadeUp}>
                        <motion.label
                          className="drop-zone"
                          htmlFor="contrib-upload"
                          whileHover={{ scale: 1.005 }}
                          style={{
                            display: "block", border: "2px dashed var(--border)", borderRadius: 20,
                            padding: "64px 32px", textAlign: "center", cursor: "pointer",
                            background: "rgba(255,255,255,0.02)",
                          }}
                          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("active"); }}
                          onDragLeave={e => e.currentTarget.classList.remove("active")}
                          onDrop={e => {
                            e.preventDefault(); e.currentTarget.classList.remove("active");
                            addContribFiles(e.dataTransfer.files);
                          }}
                        >
                          <input id="contrib-upload" type="file" multiple accept="image/*" style={{ display: "none" }} onChange={e => addContribFiles(e.target.files)} />
                          <motion.div
                            animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                            style={{ width: 72, height: 72, borderRadius: 20, background: "var(--gold-dim)", border: "1px solid var(--gold-border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}
                          >
                            <Upload size={32} color="var(--gold)" />
                          </motion.div>
                          <p style={{ color: "#fff", fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Drag & drop your event photos</p>
                          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>or click to browse your gallery</p>
                          <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                            {["JPG", "PNG", "HEIC", "WebP"].map(f => (
                              <span key={f} style={{ padding: "3px 10px", borderRadius: 6, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{f}</span>
                            ))}
                            <span style={{ padding: "3px 10px", borderRadius: 6, background: "var(--surface)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Max 30 photos</span>
                          </div>
                        </motion.label>
                      </motion.div>

                      {/* Tips */}
                      <motion.div variants={fadeUp} style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {[
                          { icon: Star,     text: "Clear, well-lit photos get approved faster" },
                          { icon: Users,    text: "Group shots and candids are always welcome" },
                        ].map((tip, i) => {
                          const Icon = tip.icon;
                          return (
                            <div key={i} className="glass" style={{ borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                              <Icon size={14} color="var(--gold)" style={{ marginTop: 2, flexShrink: 0 }} />
                              <p style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>{tip.text}</p>
                            </div>
                          );
                        })}
                      </motion.div>
                    </motion.div>
                  )}

                  {/* ─── PREVIEW & SUBMIT ─── */}
                  {(uploadStep === "preview" || uploadStep === "submitting") && (
                    <motion.div key="preview" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

                      {/* Header */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                        <div>
                          <h2 className="serif" style={{ fontSize: 26, color: "#fff" }}>
                            {contribFiles.length} Photo{contribFiles.length !== 1 ? "s" : ""} Selected
                          </h2>
                          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 3 }}>Review before submitting</p>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <label htmlFor="add-more" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                            <input id="add-more" type="file" multiple accept="image/*" style={{ display: "none" }} onChange={e => addContribFiles(e.target.files)} />
                            <ImagePlus size={14} /> Add more
                          </label>
                          <button onClick={() => { setContribFiles([]); setUploadStep("drop"); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: "transparent", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                            <Trash2 size={14} /> Clear all
                          </button>
                        </div>
                      </div>

                      {/* Thumbnail grid */}
                      <motion.div
                        variants={stagger} initial="hidden" animate="visible"
                        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, marginBottom: 24 }}
                      >
                        {contribFiles.map((cf, idx) => (
                          <motion.div
                            key={cf.id} variants={fadeUp} custom={idx}
                            className="contrib-thumb"
                            style={{ aspectRatio: "1", borderRadius: 10, overflow: "hidden", position: "relative", background: "var(--surface)", border: "1px solid var(--border)" }}
                          >
                            <img src={cf.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            <div className="thumb-overlay" style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                              <button onClick={() => setSelectedPreview(cf)} style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Eye size={14} color="#fff" />
                              </button>
                              <button onClick={() => removeContribFile(cf.id)} style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(248,113,113,0.2)", border: "1px solid rgba(248,113,113,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <X size={14} color="#f87171" />
                              </button>
                            </div>
                            <div style={{ position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.6)", borderRadius: 5, padding: "1px 5px", fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>
                              {(cf.file.size / 1024 / 1024).toFixed(1)}MB
                            </div>
                          </motion.div>
                        ))}
                      </motion.div>

                      {/* Form */}
                      <div className="glass" style={{ borderRadius: 16, padding: 20, marginBottom: 16 }}>
                        <h3 style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600, marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                          About You <span style={{ color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                        </h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                          <div>
                            <label style={{ display: "block", color: "var(--text-muted)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Your name</label>
                            <input
                              type="text" value={contribName} onChange={e => setContribName(e.target.value)}
                              placeholder="e.g. Sarah M."
                              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "#fff", fontSize: 14, outline: "none", transition: "border-color 0.2s" }}
                              onFocus={e => e.target.style.borderColor = "var(--gold-border)"}
                              onBlur={e => e.target.style.borderColor = "var(--border)"}
                            />
                          </div>
                          <div>
                            <label style={{ display: "block", color: "var(--text-muted)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Note to organizer</label>
                            <textarea
                              value={contribMsg} onChange={e => setContribMsg(e.target.value)}
                              placeholder="e.g. Photos from the after-party!"
                              rows={2}
                              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "#fff", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit", transition: "border-color 0.2s" }}
                              onFocus={e => e.target.style.borderColor = "var(--gold-border)"}
                              onBlur={e => e.target.style.borderColor = "var(--border)"}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Error */}
                      <AnimatePresence>
                        {contribError && (
                          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", marginBottom: 16 }}>
                            <AlertCircle size={15} color="#f87171" style={{ flexShrink: 0 }} />
                            <p style={{ color: "#f87171", fontSize: 13 }}>{contribError}</p>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Submit */}
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          onClick={() => { setContribFiles([]); setUploadStep("drop"); }}
                          className="btn-ghost"
                          style={{ padding: "13px 20px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}
                        >
                          Back
                        </button>
                        <motion.button
                          whileHover={{ scale: uploadStep === "submitting" ? 1 : 1.01 }}
                          whileTap={{ scale: uploadStep === "submitting" ? 1 : 0.98 }}
                          onClick={submitContrib}
                          disabled={uploadStep === "submitting" || !contribFiles.length}
                          className="btn-gold"
                          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "13px 20px", borderRadius: 12, fontSize: 15, cursor: uploadStep === "submitting" ? "not-allowed" : "pointer" }}
                        >
                          {uploadStep === "submitting" ? (
                            <>
                              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                                <Loader2 size={17} />
                              </motion.div>
                              Uploading {contribFiles.length} photo{contribFiles.length !== 1 ? "s" : ""}…
                            </>
                          ) : (
                            <>
                              <CloudUpload size={17} />
                              Submit {contribFiles.length} Photo{contribFiles.length !== 1 ? "s" : ""}
                            </>
                          )}
                        </motion.button>
                      </div>

                      {/* Privacy note */}
                      <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
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

      {/* ══════════ MODALS ══════════ */}

      {/* Camera */}
      <AnimatePresence>
        {cameraOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.96)", backdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="glass" style={{ borderRadius: 24, overflow: "hidden", width: "100%", maxWidth: 380 }}>
              <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulseRing 1.5s ease infinite" }} />
                  <span className="serif" style={{ color: "#fff", fontSize: 16 }}>Take Your Selfie</span>
                </div>
                <button onClick={stopCamera} style={{ width: 30, height: 30, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
                  <X size={14} />
                </button>
              </div>
              <div style={{ background: "#000", position: "relative" }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
                <div style={{ position: "absolute", inset: 20, border: "2px solid rgba(232,201,126,0.3)", borderRadius: 16, pointerEvents: "none" }} />
              </div>
              <div style={{ padding: 16, display: "flex", gap: 10 }}>
                <button onClick={stopCamera} className="btn-ghost" style={{ flex: 1, padding: "12px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>Cancel</button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={capturePhoto} className="btn-gold" style={{ flex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                  <Camera size={16} /> Capture
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Photo preview modal */}
      <AnimatePresence>
        {previewImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.97)", backdropFilter: "blur(24px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
            onClick={() => setPreviewImage(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
              <img src={`${API}/public/events/${token}/image/${previewImage}`} alt="" style={{ maxHeight: "85vh", maxWidth: "88vw", borderRadius: 16, display: "block", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }} />

              {/* Scene info on modal */}
              {(() => {
                const cur = currentItems[previewIndex];
                const s = cur ? displayScene(sceneOf(cur)) : null;
                const objs = cur ? objectsOf(cur) : [];
                if (!s && objs.length === 0) return null;
                return (
                  <div style={{ position: "absolute", top: 12, left: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {s && (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 99, background: "rgba(10,10,15,0.85)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.12)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>
                        <span>{s.emoji}</span><span>{s.name}</span>
                      </div>
                    )}
                    {objs.slice(0, 3).map(o => (
                      <div key={o} style={{ padding: "4px 10px", borderRadius: 99, background: "rgba(10,10,15,0.85)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                        {o}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Nav buttons */}
              {currentItems.length > 1 && (
                <>
                  <button onClick={() => navPreview(-1)} className="glass" style={{ position: "absolute", left: -52, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
                    <ChevronLeft size={18} />
                  </button>
                  <button onClick={() => navPreview(1)} className="glass" style={{ position: "absolute", right: -52, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
                    <ChevronRight size={18} />
                  </button>
                </>
              )}

              {/* Bottom bar */}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(to top, rgba(0,0,0,0.95), transparent)", borderRadius: "0 0 16px 16px", padding: "24px 16px 16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{previewIndex + 1} / {tab.total}{tab.has_more ? "+" : ""}</span>
                <a href={`${API}/public/events/${token}/download/${previewImage}`}
                  className="btn-gold"
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, fontSize: 13, textDecoration: "none" }}>
                  <Download size={14} /> Download
                </a>
              </div>

              <button onClick={() => setPreviewImage(null)} className="glass" style={{ position: "absolute", top: 10, right: 10, width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
                <X size={14} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contrib file preview modal */}
      <AnimatePresence>
        {selectedPreview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.96)", backdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
            onClick={() => setSelectedPreview(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} onClick={e => e.stopPropagation()} style={{ position: "relative" }}>
              <img src={selectedPreview.preview} alt="" style={{ maxHeight: "82vh", maxWidth: "88vw", borderRadius: 14, display: "block", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }} />
              <div className="glass" style={{ position: "absolute", bottom: 12, left: 12, right: 12, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{selectedPreview.file.name}</span>
                <button onClick={() => { removeContribFile(selectedPreview.id); setSelectedPreview(null); }} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Trash2 size={12} /> Remove
                </button>
              </div>
              <button onClick={() => setSelectedPreview(null)} className="glass" style={{ position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
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
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
            onClick={() => setShowInfo(false)}>
            <motion.div initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 16 }}
              className="glass" style={{ borderRadius: 24, padding: 32, width: "100%", maxWidth: 380 }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                <h3 className="serif" style={{ fontSize: 24, color: "#fff" }}>How It Works</h3>
                <button onClick={() => setShowInfo(false)} style={{ width: 30, height: 30, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
                  <X size={13} />
                </button>
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
                Our AI uses facial recognition to find every photo where you appear — across the entire event gallery.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: "1px solid var(--border)", paddingTop: 24 }}>
                {[
                  { icon: Camera,      n: "01", title: "Upload your selfie",       desc: "A clear front-facing photo works best" },
                  { icon: Scan,        n: "02", title: "AI finds your face",        desc: "Every event photo is scanned instantly" },
                  { icon: Users,       n: "03", title: "Discover Friends Nearby",   desc: "See photos of people who attended alongside you" },
                  { icon: Download,    n: "04", title: "Browse & download",         desc: "Scroll your matches, download any photo" },
                  ...(guestUpload ? [{ icon: CloudUpload, n: "05", title: "Share your photos", desc: "Contribute shots for organizer review" }] : []),
                ].map(step => {
                  const Icon = step.icon;
                  return (
                    <div key={step.n} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                      <div className="glass-gold" style={{ width: 38, height: 38, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={16} color="var(--gold)" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ color: "#fff", fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{step.title}</p>
                        <p style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={() => setShowInfo(false)} className="btn-gold" style={{ width: "100%", marginTop: 28, padding: "13px", borderRadius: 12, fontSize: 14, cursor: "pointer" }}>
                Got it
              </button>
              <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11, marginTop: 14 }}>Your selfie is never stored on our servers</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "20px", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 11 }}>
          © {new Date().getFullYear()} {APP_CONFIG.name} · Powered by AI Face Recognition
        </p>
      </footer>
    </div>
  );
}
