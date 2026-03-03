/**
 * Enhanced Public Selfie Page
 * Complete implementation with all improvements:
 * - Upload progress with compression
 * - Confidence scores and sensitivity slider
 * - Multi-select mode with batch download
 * - Enhanced photo preview with zoom, keyboard nav, swipe
 * - Skeleton loading states
 * - Accessibility features
 * - Micro-interactions
 */

'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Download, Camera, Info, Scan,
  ImageIcon, RefreshCw, Sparkles,
  Loader2, Star, X, Check, ArrowLeft,
  AlertCircle, CloudUpload,
  SlidersHorizontal, PackageOpen, Grid2X2, LayoutGrid
} from 'lucide-react';
import { compressImage, hapticFeedback, Analytics, nameOf, sceneOf, objectOf, confidenceOf } from '@/lib/snapmatch/utils';
import { 
  useReducedMotion, useLocalStorage 
} from '@/hooks/snapmatch/useSnapmatch';
import { sceneIcon } from '@/components/snapmatch/UIComponents';
import { PhotoPreview } from '@/components/snapmatch/PhotoPreview';
import { 
  MultiSelectToolbar, SelectablePhotoCard, useMultiSelect 
} from '@/components/snapmatch/MultiSelect';
import { 
  ConfidenceSlider, CameraWithEnhancements
} from '@/components/snapmatch/CameraEnhancements';
import {
  WatermarkConfig,
  DEFAULT_WATERMARK_CONFIG,
  applyWatermarkToImageUrl,
  applyWatermarkToCanvas,
} from '@/lib/snapmatch/watermark';


// ─── Types ────────────────────────────────────────────────────────────────────

interface PageData {
  result_id: string;
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_more: boolean;
  items: PhotoItem[];
}

interface SearchResult {
  result_id: string;
  you: PageData;
  sensitivity?: number;
}

interface PhotoItem {
  image_name: string;
  scene_label?: string;
  object_label?: string;
  similarity?: number;
  confidence?: number;
}

interface TabState {
  items: PhotoItem[];
  page: number;
  total: number;
  has_more: boolean;
  loading: boolean;
  error: string | null;
}

interface EventData {
  name: string;
  plan_type?: string;
  watermark_enabled?: boolean;
  watermark_config?: WatermarkConfig;
}

type Mode = 'search' | 'contribute';
type UploadStep = 'drop' | 'preview' | 'submitting' | 'success';
type GridLayout = 'comfortable' | 'compact' | 'large';

const emptyTab = (): TabState => ({
  items: [],
  page: 1,
  total: 0,
  has_more: false,
  loading: false,
  error: null,
});

// ─── Animation Variants ───────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.055, duration: 0.48, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
};

// ─── Main Component ────────────────────────────────────────────────────────────

export default function EnhancedPublicSelfiePage() {
  const params = useParams();
  const token = params?.token as string;
  const API = process.env.NEXT_PUBLIC_API_URL || '';
  const prefersReducedMotion = useReducedMotion();

  // ── State ──
  const [event, setEvent] = useState<EventData | null>(null);
  const [mode, setMode] = useState<Mode>('search');
  const [resultId, setResultId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabState>(emptyTab());
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const [dragOver, setDragOver] = useState(false);

  // Enhanced features state
  const [activeScene, setActiveScene] = useState<string>('all');
  const [activeObject, setActiveObject] = useState<string>('all');
  const [gridLayout, setGridLayout] = useState<GridLayout>('comfortable');
  const [dlAllLoading, setDlAllLoading] = useState(false);
  const [showConfidence, setShowConfidence] = useState(true);
  const [sensitivity, setSensitivity] = useLocalStorage('snapmatch_sensitivity', 75);

  // Upload state
  const [uploadStep, setUploadStep] = useState<UploadStep>('drop');
  const [contribFiles, setContribFiles] = useState<{ file: File; preview: string; id: string }[]>([]);
  const [contribName, setContribName] = useState('');
  const [contribMsg, setContribMsg] = useState('');
  const [contribError, setContribError] = useState<string | null>(null);
  const [uploadCount, setUploadCount] = useState(0);

  // Multi-select state
  const multiSelect = useMultiSelect(tab.items);

  // Watermark state - loaded from event API
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(DEFAULT_WATERMARK_CONFIG);

  // Refs
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contribInputRef = useRef<HTMLInputElement>(null);

  // Plan detection
  const isPro = !!(event?.plan_type && event.plan_type !== 'free');
  const guestUpload = true;

  // ── Scene Counts ──
  const sceneCounts = useMemo(() => {
    return tab.items.reduce((acc: Record<string, number>, item) => {
      const s = sceneOf(item);
      if (s) acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
  }, [tab.items]);

  // ── Object Counts ──
  const objectCounts = useMemo(() => {
    return tab.items.reduce((acc: Record<string, number>, item) => {
      const o = objectOf(item);
      if (o) acc[o] = (acc[o] ?? 0) + 1;
      return acc;
    }, {});
  }, [tab.items]);

  const objectLabels = Object.keys(objectCounts);
  const hasObjects = objectLabels.length > 0;

  const sceneLabels = Object.keys(sceneCounts);
  const hasScenes = sceneLabels.length > 0;

  // ── Reset Filters Function ──
  const resetFilters = useCallback(() => {
    setActiveScene('all');
    setActiveObject('all');
  }, []);

  // ── Combined Filtering ──
  const filteredItems = useMemo(() => {
    let items = tab.items;
    if (activeScene !== 'all') {
      items = items.filter(item => sceneOf(item) === activeScene);
    }
    if (activeObject !== 'all') {
      items = items.filter(item => objectOf(item) === activeObject);
    }
    return items;
  }, [tab.items, activeScene, activeObject]);

  // ── Load Event ──
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}`)
      .then(r => r.json())
      .then((data: EventData) => {
        setEvent(data);

        // ═══════════════════════════════════════════════════════════════
        // 🎨 WATERMARK CONFIGURATION FROM BACKEND
        // ═══════════════════════════════════════════════════════════════
        
        // Backend returns:
        // - watermark_enabled: boolean
        // - watermark_config: { enabled, type, text, textSize, ... }
        
        if (data.watermark_enabled && data.watermark_config) {
          // API returns full watermark config - use it
          console.log('🎨 Watermark loaded from API:', data.watermark_config);
          setWatermarkConfig({
            ...DEFAULT_WATERMARK_CONFIG,
            ...data.watermark_config,
            enabled: true,  // Ensure enabled matches watermark_enabled
          });
        } else if (data.watermark_enabled) {
          // Watermark enabled but no config - use defaults
          console.log('🎨 Watermark enabled with default config');
          setWatermarkConfig({ ...DEFAULT_WATERMARK_CONFIG, enabled: true });
        } else {
          // Watermark disabled
          console.log('🎨 Watermark disabled');
          setWatermarkConfig({ ...DEFAULT_WATERMARK_CONFIG, enabled: false });
        }
      })
      .catch((err) => {
        console.error('Failed to load event:', err);
      });
  }, [token]);

  // ── Reset filters when mode changes ──
  useEffect(() => {
    resetFilters();
  }, [mode, resetFilters]);

  // ── Face Search with Progress ──
  const handleUpload = useCallback(async (file: File) => {
    setProcessing(true);
    setResultId(null);
    setTab(emptyTab());
    resetFilters(); // Reset both scene and object filters
    Analytics.selfieUploaded('upload');

    try {
      // Compress image if needed
      let processedFile = file;
      if (file.size > 1024 * 1024) {
        processedFile = await compressImage(file, { maxWidth: 1920, quality: 0.85 });
      }

      const form = new FormData();
      form.append('file', processedFile);
      form.append('sensitivity', String(sensitivity / 100));

      const res = await fetch(`${API}/public/events/${token}/search`, {
        method: 'POST',
        body: form,
      });

      if (!res.ok) throw new Error(await res.text());

      const data: SearchResult = await res.json();
      setResultId(data.result_id);

      const avgConfidence = data.you.items.length > 0
        ? Math.round(data.you.items.reduce((sum, item) => sum + (item.similarity ?? 0.85) * 100, 0) / data.you.items.length)
        : 0;

      setTab({
        items: data.you.items,
        page: 1,
        total: data.you.total,
        has_more: data.you.has_more,
        loading: false,
        error: null,
      });

      Analytics.searchCompleted(data.you.total, avgConfidence);

      setTimeout(() => {
        document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  }, [token, API, sensitivity]);

  // ── Infinite Scroll ──
  const loadNextPage = useCallback(async () => {
    if (!resultId || tab.loading || !tab.has_more) return;

    const nextPage = tab.page + 1;
    setTab(prev => ({ ...prev, loading: true, error: null }));

    try {
      const res = await fetch(
        `${API}/public/events/${token}/search/${resultId}?kind=you&page=${nextPage}`
      );

      if (res.status === 404) {
        setTab(prev => ({ ...prev, loading: false, has_more: false, error: 'Session expired.' }));
        return;
      }

      if (!res.ok) throw new Error(await res.text());

      const data: PageData = await res.json();
      setTab(prev => ({
        items: [...prev.items, ...data.items],
        page: data.page,
        total: data.total,
        has_more: data.has_more,
        loading: false,
        error: null,
      }));
    } catch {
      setTab(prev => ({ ...prev, loading: false, error: 'Failed to load more.' }));
    }
  }, [tab, resultId, token, API]);

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) loadNextPage();
      },
      { rootMargin: '400px' }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [loadNextPage]);

  // ── Download Single with Watermark ──
  const downloadSinglePhoto = useCallback(async (imageName: string) => {
    try {
      // Fetch the image
      const res = await fetch(`${API}/public/events/${token}/photo/${imageName}`);
      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();

      // Apply watermark if enabled
      if (watermarkConfig.enabled) {
        const img = new Image();
        img.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = URL.createObjectURL(blob);
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          await applyWatermarkToCanvas(canvas, watermarkConfig);

          const watermarkedBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => b ? resolve(b) : reject(new Error('Failed to create blob')),
              'image/jpeg',
              0.95
            );
          });

          const url = URL.createObjectURL(watermarkedBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = imageName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          URL.revokeObjectURL(img.src);
        } else {
          // Fallback without watermark
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = imageName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      } else {
        // No watermark, download directly
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = imageName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      hapticFeedback('success');
      Analytics.photoDownloaded(imageName, false);
    } catch (e) {
      console.error('Download failed:', e);
      hapticFeedback('error');
    }
  }, [token, API, watermarkConfig]);

  // ── Download All (ZIP) ──
  const handleDownloadAll = useCallback(async () => {
    if (!resultId || dlAllLoading) return;

    setDlAllLoading(true);
    hapticFeedback('medium');

    try {
      const res = await fetch(
        `${API}/public/events/${token}/download/${resultId}?kind=matched`
      );

      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${event?.name || 'event'}-photos.zip`,
      });
      a.click();
      URL.revokeObjectURL(url);

      hapticFeedback('success');
      Analytics.photoDownloaded('batch', true);
    } catch (e) {
      console.error(e);
      hapticFeedback('error');
    } finally {
      setDlAllLoading(false);
    }
  }, [resultId, dlAllLoading, token, API, event?.name]);

  // ── Batch Download Selected ──
  const handleBatchDownload = useCallback(async () => {
    if (multiSelect.count === 0) return;

    // For now, download each selected photo individually
    // In production, this would create a ZIP on the server
    for (const imageName of multiSelect.selectionOrder) {
      await downloadSinglePhoto(imageName);
    }

    multiSelect.exitSelectMode();
  }, [multiSelect, downloadSinglePhoto]);

  // ── Camera Capture ──
  const handleCameraCapture = useCallback((file: File) => {
    setCameraOpen(false);
    handleUpload(file);
  }, [handleUpload]);

  // ── Contribution Handlers ──
  const addContribFiles = useCallback((fl: FileList | null) => {
    if (!fl) return;

    const valid = Array.from(fl)
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({
        file: f,
        preview: URL.createObjectURL(f),
        id: Math.random().toString(36).slice(2),
      }));

    setContribFiles(prev => [...prev, ...valid].slice(0, 30));
    setContribError(null);

    if (valid.length) setUploadStep('preview');
  }, []);

  const submitContrib = useCallback(async () => {
    if (!contribFiles.length) return;

    setUploadStep('submitting');
    setContribError(null);

    try {
      const form = new FormData();
      contribFiles.forEach(f => form.append('files', f.file));

      if (contribName.trim()) form.append('contributor_name', contribName.trim());
      if (contribMsg.trim()) form.append('message', contribMsg.trim());

      const res = await fetch(`${API}/public/events/${token}/contribute`, {
        method: 'POST',
        body: form,
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json();
      setUploadCount(data.uploaded ?? contribFiles.length);
      setContribFiles([]);
      setContribName('');
      setContribMsg('');
      setUploadStep('success');

      Analytics.contributeCompleted(data.uploaded ?? contribFiles.length);
    } catch (err) {
      setContribError(err instanceof Error ? err.message : 'Upload failed');
      setUploadStep('preview');
    }
  }, [contribFiles, contribName, contribMsg, token, API]);

  const resetContrib = useCallback(() => {
    setUploadStep('drop');
    setContribFiles([]);
    setContribName('');
    setContribMsg('');
    setContribError(null);
  }, []);

  // ── Grid Columns ──
  const gridCols = useMemo(() => ({
    comfortable: 'repeat(auto-fill, minmax(220px, 1fr))',
    compact: 'repeat(auto-fill, minmax(148px, 1fr))',
    large: 'repeat(auto-fill, minmax(320px, 1fr))',
  }[gridLayout]), [gridLayout]);

  // ── Preview Navigation ──
  const handlePreviewNavigate = useCallback((index: number) => {
    setPreviewIndex(index);
    setPreviewImage(nameOf(filteredItems[index]));
  }, [filteredItems]);

  // ── Render ──
  return (
    <div style={{
      minHeight: '100vh',
      background: '#09090f',
      color: '#fff',
      fontFamily: "'Outfit', sans-serif",
    }}>
      {/* ── Global CSS ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap');

        :root {
          --gold: #e8c97e;
          --gold-l: #f5e0a6;
          --gold-dim: rgba(232,201,126,0.13);
          --gold-border: rgba(232,201,126,0.22);
          --surf: rgba(255,255,255,0.04);
          --surf-h: rgba(255,255,255,0.07);
          --border: rgba(255,255,255,0.07);
          --muted: rgba(255,255,255,0.35);
          --dim: rgba(255,255,255,0.55);
          --jade: #4ade80;
          --jade-dim: rgba(74,222,128,0.12);
          --rose: #f87171;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--gold-border); border-radius: 4px; }

        .serif { font-family: 'Playfair Display', Georgia, serif; }
        .glass { background: var(--surf); border: 1px solid var(--border); backdrop-filter: blur(20px); }
        .g-gold { background: var(--gold-dim); border: 1px solid var(--gold-border); }
        .g-jade { background: var(--jade-dim); border: 1px solid rgba(74,222,128,0.22); }

        .btn-gold {
          background: linear-gradient(135deg, #e8c97e, #c88c25);
          color: #0a0808; font-weight: 700; letter-spacing: 0.015em;
          border: none; cursor: pointer; transition: all 0.2s;
          box-shadow: 0 4px 20px rgba(232,201,126,0.22);
        }
        .btn-gold:hover { filter: brightness(1.06); transform: translateY(-1px); box-shadow: 0 8px 28px rgba(232,201,126,0.38); }
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

        .photo-card {
          cursor: pointer; overflow: hidden; border-radius: 12px; position: relative;
          background: #111; border: 1px solid var(--border);
          transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
        }
        .photo-card:hover { transform: scale(1.028); box-shadow: 0 16px 48px rgba(0,0,0,0.65); border-color: var(--gold-border); z-index: 2; }
        .photo-card:hover .photo-overlay { opacity: 1; }
        .photo-overlay { opacity: 0; transition: opacity 0.2s; }

        .drop-zone { transition: all 0.22s ease; }
        .drop-zone.over { border-color: var(--gold) !important; background: var(--gold-dim) !important; }

        .scene-pill {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 600;
          cursor: pointer; border: 1px solid var(--border); background: var(--surf);
          color: var(--dim); white-space: nowrap; transition: all 0.18s;
          font-family: 'Outfit', sans-serif;
        }
        .scene-pill:hover { background: var(--surf-h); color: #fff; }
        .scene-pill.active { background: var(--gold-dim); border-color: var(--gold-border); color: var(--gold); }

        .layout-btn {
          display: flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border-radius: 7px; border: 1px solid transparent;
          background: transparent; color: var(--muted); cursor: pointer; transition: all 0.15s;
        }
        .layout-btn.active { background: var(--gold-dim); border-color: var(--gold-border); color: var(--gold); }
        .layout-btn:hover:not(.active) { background: var(--surf-h); color: var(--dim); }

        @keyframes pulseRing {
          0%   { box-shadow: 0 0 0 0 rgba(232,201,126,0.45); }
          70%  { box-shadow: 0 0 0 14px rgba(232,201,126,0); }
          100% { box-shadow: 0 0 0 0 rgba(232,201,126,0); }
        }
        .pulse-ring { animation: pulseRing 2.4s ease infinite; }

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

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      {/* Ambient glows */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{
          position: 'absolute', top: '-15%', left: '25%', width: 700, height: 600,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,201,126,0.055) 0%, transparent 68%)', filter: 'blur(80px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '5%', right: '5%', width: 500, height: 500,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.04) 0%, transparent 70%)', filter: 'blur(90px)',
        }} />
      </div>

      {/* ══ HEADER ══ */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        background: 'rgba(9,9,15,0.88)', backdropFilter: 'blur(28px)', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{
          maxWidth: 1300, margin: '0 auto', padding: '0 20px', height: 62,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="pulse-ring" style={{
              width: 38, height: 38, borderRadius: 12,
              background: 'linear-gradient(135deg, #e8c97e, #b86a12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Sparkles size={17} color="#0a0808" />
            </div>
            <div>
              <p className="serif" style={{ color: '#fff', fontSize: 17, fontWeight: 600, lineHeight: 1.15 }}>
                {event?.name || 'Event Photos'}
              </p>
              <p style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 1 }}>
                AI · Face Recognition
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {guestUpload && mode === 'search' && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setMode('contribute')}
                className="glass"
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '7px 14px', borderRadius: 10, cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, color: 'var(--gold)',
                }}
              >
                <CloudUpload size={14} /> Share Photos
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowInfo(true)}
              className="glass"
              style={{
                width: 38, height: 38, borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--dim)',
              }}
            >
              <Info size={16} />
            </motion.button>
          </div>
        </div>
      </header>

      {/* ══ MAIN ══ */}
      <main style={{
        paddingTop: 78, paddingBottom: 90, minHeight: '100vh',
        position: 'relative', zIndex: 1,
      }}>
        <AnimatePresence mode="wait">
          {/* ════════════ SEARCH MODE ════════════ */}
          {mode === 'search' && (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }}>
              {/* ─── Hero (no results yet) ─── */}
              {!resultId && !processing && (
                <motion.section
                  variants={stagger}
                  initial="hidden"
                  animate="visible"
                  style={{ maxWidth: 660, margin: '0 auto', padding: '64px 20px 40px', textAlign: 'center' }}
                >
                  {/* Icon */}
                  <motion.div variants={fadeUp} style={{ display: 'inline-flex', marginBottom: 28, position: 'relative' }}>
                    <div className="g-gold" style={{
                      width: 92, height: 92, borderRadius: 28,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Scan size={44} color="var(--gold)" strokeWidth={1.4} />
                    </div>
                    {/* Corner accents */}
                    {[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']].map(([v, h], i) => (
                      <div key={i} style={{
                        position: 'absolute', [v]: -4, [h]: -4, width: 14, height: 14,
                        borderTop: v === 'top' ? '2px solid var(--gold)' : undefined,
                        borderBottom: v === 'bottom' ? '2px solid var(--gold)' : undefined,
                        borderLeft: h === 'left' ? '2px solid var(--gold)' : undefined,
                        borderRight: h === 'right' ? '2px solid var(--gold)' : undefined,
                        borderRadius: v === 'top' && h === 'left' ? '4px 0 0 0' : v === 'top' && h === 'right' ? '0 4px 0 0' : v === 'bottom' && h === 'left' ? '0 0 0 4px' : '0 0 4px 0',
                      }} />
                    ))}
                  </motion.div>

                  <motion.h1 variants={fadeUp} className="serif shimmer-text"
                    style={{ fontSize: 'clamp(36px,6vw,60px)', fontWeight: 600, lineHeight: 1.08, marginBottom: 16 }}>
                    Find Yourself<br />in Every Photo
                  </motion.h1>

                  <motion.p variants={fadeUp}
                    style={{ color: 'var(--dim)', fontSize: 16, lineHeight: 1.7, maxWidth: 430, margin: '0 auto 40px' }}>
                    Upload a selfie — AI scans every event photo and finds your matches instantly.
                  </motion.p>

                  {/* Sensitivity Slider */}
                  <motion.div variants={fadeUp} style={{ maxWidth: 280, margin: '0 auto 24px' }}>
                    <ConfidenceSlider
                      value={sensitivity}
                      onChange={setSensitivity}
                      min={50}
                      max={95}
                      step={5}
                    />
                  </motion.div>

                  {/* CTA buttons */}
                  <motion.div variants={fadeUp}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11, maxWidth: 430, margin: '0 auto 16px' }}>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setCameraOpen(true)}
                      className="btn-gold"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                        padding: '15px 20px', borderRadius: 14, fontSize: 15, cursor: 'pointer',
                      }}
                    >
                      <Camera size={18} /> Take Selfie
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-ghost"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                        padding: '15px 20px', borderRadius: 14, fontSize: 15, cursor: 'pointer',
                      }}
                    >
                      <Upload size={18} /> Upload Photo
                    </motion.button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={e => {
                        if (e.target.files?.[0]) handleUpload(e.target.files[0]);
                        e.target.value = '';
                      }}
                    />
                  </motion.div>

                  {/* Drag zone */}
                  <motion.div variants={fadeUp}>
                    <div
                      className={`drop-zone ${dragOver ? 'over' : ''}`}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f) handleUpload(f);
                      }}
                      style={{
                        border: '1.5px dashed var(--border)', borderRadius: 14, padding: 16,
                        color: 'var(--muted)', fontSize: 13, maxWidth: 430, margin: '0 auto', textAlign: 'center',
                      }}
                    >
                      or drag & drop your selfie here
                    </div>
                  </motion.div>

                  {/* How it works */}
                  <motion.div variants={stagger}
                    style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 48, maxWidth: 480, margin: '48px auto 0' }}>
                    {[
                      { icon: Camera, label: 'Snap a selfie', n: '01' },
                      { icon: Scan, label: 'AI scans photos', n: '02' },
                      { icon: Download, label: 'Download yours', n: '03' },
                    ].map((step) => {
                      const Icon = step.icon;
                      return (
                        <motion.div key={step.n} variants={fadeUp} className="glass"
                          style={{ borderRadius: 14, padding: '18px 12px', textAlign: 'center' }}>
                          <p style={{ color: 'var(--gold)', fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', marginBottom: 10 }}>{step.n}</p>
                          <Icon size={20} color="var(--gold)" style={{ margin: '0 auto 10px', display: 'block' }} />
                          <p style={{ color: 'rgba(255,255,255,0.68)', fontSize: 12, fontWeight: 500, lineHeight: 1.45 }}>{step.label}</p>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </motion.section>
              )}

              {/* ─── Processing ─── */}
              {processing && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ maxWidth: 460, margin: '72px auto 0', padding: '0 20px' }}>
                  <div className="glass" style={{ borderRadius: 24, padding: '52px 32px', textAlign: 'center' }}>
                    <div style={{ position: 'relative', width: 76, height: 76, margin: '0 auto 26px' }}>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                        style={{
                          position: 'absolute', inset: 0, borderRadius: '50%',
                          border: '2px solid transparent',
                          borderTopColor: 'var(--gold)', borderRightColor: 'var(--gold-border)',
                        }}
                      />
                      <div className="g-gold" style={{
                        position: 'absolute', inset: 10, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Scan size={22} color="var(--gold)" />
                      </div>
                    </div>
                    <h3 className="serif" style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>Scanning Photos…</h3>
                    <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.65 }}>
                      AI is finding your face across every event photo. This takes just a moment.
                    </p>
                    <div style={{ marginTop: 28, height: 2, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
                      <motion.div
                        animate={{ x: ['-100%', '100%'] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                        style={{ height: '100%', width: '50%', background: 'linear-gradient(90deg, transparent, var(--gold), transparent)', borderRadius: 99 }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ─── Results ─── */}
              {resultId && !processing && (
                <motion.section id="results-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  style={{ maxWidth: 1300, margin: '0 auto', padding: '24px 20px 0' }}>

                  {/* Results header */}
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    gap: 12, marginBottom: 18, flexWrap: 'wrap',
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>Your Photos</h2>
                        {tab.total > 0 && (
                          <span style={{
                            padding: '2px 9px', borderRadius: 99,
                            background: 'var(--gold-dim)', border: '1px solid var(--gold-border)',
                            fontSize: 12, fontWeight: 700, color: 'var(--gold)',
                          }}>
                            {tab.total}{tab.has_more ? '+' : ''}
                          </span>
                        )}
                      </div>
                      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                        {activeScene !== 'all' && activeObject !== 'all'
                          ? `Scene: ${activeScene}, Object: ${activeObject} · ${filteredItems.length} photo${filteredItems.length !== 1 ? 's' : ''}`
                          : activeScene !== 'all'
                          ? `Scene: ${activeScene} · ${filteredItems.length} photo${filteredItems.length !== 1 ? 's' : ''}`
                          : activeObject !== 'all'
                          ? `Object: ${activeObject} · ${filteredItems.length} photo${filteredItems.length !== 1 ? 's' : ''}`
                          : `${tab.total} photo${tab.total !== 1 ? 's' : ''} found across the event`}
                      </p>
                    </div>

                    {/* Action bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {/* Multi-select toggle */}
                      {!multiSelect.isSelectMode && (
                        <MultiSelectToolbar
                          items={tab.items}
                          selectedIds={multiSelect.selectedIds}
                          onToggle={multiSelect.toggle}
                          onSelectAll={multiSelect.selectAll}
                          onClearSelection={multiSelect.clearSelection}
                          onBatchDownload={handleBatchDownload}
                          isActive={multiSelect.isSelectMode}
                          onActivate={multiSelect.enterSelectMode}
                          onDeactivate={multiSelect.exitSelectMode}
                        />
                      )}

                      {/* Grid layout toggle */}
                      <div className="glass" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9 }}>
                        {([
                          { k: 'large' as GridLayout, icon: <Grid2X2 size={13} />, title: 'Large' },
                          { k: 'comfortable' as GridLayout, icon: <LayoutGrid size={13} />, title: 'Comfortable' },
                          { k: 'compact' as GridLayout, icon: <SlidersHorizontal size={13} />, title: 'Compact' },
                        ]).map(({ k, icon, title }) => (
                          <button
                            key={k}
                            title={title}
                            onClick={() => {
                              setGridLayout(k);
                              Analytics.layoutChanged(k);
                            }}
                            className={`layout-btn${gridLayout === k ? ' active' : ''}`}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>

                      {/* Download All */}
                      {isPro && tab.total > 0 && (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAll}
                          disabled={dlAllLoading}
                          className="btn-gold"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '8px 16px', borderRadius: 10, fontSize: 13, cursor: 'pointer',
                          }}
                        >
                          {dlAllLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={14} /></motion.div> Preparing…</>
                            : <><PackageOpen size={14} /> Download All ({tab.total})</>}
                        </motion.button>
                      )}

                      {/* Free plan upsell */}
                      {!isPro && tab.total > 1 && (
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAll}
                          disabled={dlAllLoading}
                          className="g-gold"
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '7px 12px', borderRadius: 9, fontSize: 12,
                            cursor: dlAllLoading ? 'not-allowed' : 'pointer', border: 'none', background: 'transparent',
                          }}
                        >
                          {dlAllLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={12} /></motion.div> Preparing…</>
                            : <><Star size={12} style={{ color: 'var(--gold)', flexShrink: 0 }} /><span style={{ color: 'rgba(232,201,126,0.85)', fontWeight: 500 }}>Download all {tab.total} photos as ZIP</span></>}
                        </motion.button>
                      )}

                      {/* New search */}
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => { setResultId(null); setTab(emptyTab()); resetFilters(); }}
                        className="btn-ghost"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '8px 14px', borderRadius: 10, fontSize: 13, cursor: 'pointer',
                        }}
                      >
                        <RefreshCw size={13} /> New Search
                      </motion.button>
                    </div>
                  </div>

                  {/* Multi-select toolbar (when active) */}
                  <AnimatePresence>
                    {multiSelect.isSelectMode && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        style={{ marginBottom: 16 }}
                      >
                        <MultiSelectToolbar
                          items={tab.items}
                          selectedIds={multiSelect.selectedIds}
                          onToggle={multiSelect.toggle}
                          onSelectAll={multiSelect.selectAll}
                          onClearSelection={multiSelect.clearSelection}
                          onBatchDownload={handleBatchDownload}
                          isActive={multiSelect.isSelectMode}
                          onActivate={multiSelect.enterSelectMode}
                          onDeactivate={multiSelect.exitSelectMode}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ── Scene filter pills ── */}
                  {hasScenes && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center',
                        marginBottom: 20, paddingBottom: 18, borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={{
                        color: 'var(--muted)', fontSize: 10, fontWeight: 700,
                        letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0, marginRight: 2,
                      }}>
                        Scene
                      </span>

                      <button
                        className={`scene-pill${activeScene === 'all' && activeObject === 'all' ? ' active' : ''}`}
                        onClick={() => resetFilters()}
                      >
                        All · {tab.total}
                      </button>

                      {sceneLabels.map(label => (
                        <button
                          key={label}
                          className={`scene-pill${activeScene === label ? ' active' : ''}`}
                          onClick={() => {
                            setActiveScene(activeScene === label ? 'all' : label);
                            Analytics.sceneFiltered(label);
                          }}
                          style={{ textTransform: 'capitalize' }}
                        >
                          {sceneIcon(label)}
                          {label} · {sceneCounts[label]}
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {/* ── Object filter pills ── */}
                  {hasObjects && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center',
                        marginBottom: 20, paddingBottom: 18, borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={{
                        color: 'var(--muted)', fontSize: 10, fontWeight: 700,
                        letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0, marginRight: 2,
                      }}>
                        Objects
                      </span>

                      <button
                        className={`scene-pill${activeObject === 'all' ? ' active' : ''}`}
                        onClick={() => setActiveObject('all')}
                      >
                        All · {tab.total}
                      </button>

                      {objectLabels.map(label => (
                        <button
                          key={label}
                          className={`scene-pill${activeObject === label ? ' active' : ''}`}
                          onClick={() => {
                            setActiveObject(activeObject === label ? 'all' : label);
                            Analytics.sceneFiltered(label);
                          }}
                          style={{ textTransform: 'capitalize' }}
                        >
                          {label} · {objectCounts[label]}
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {/* ── Photo grid ── */}
                  {filteredItems.length > 0 ? (
                    <>
                      <motion.div
                        variants={stagger}
                        initial="hidden"
                        animate="visible"
                        style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8 }}
                      >
                        {filteredItems.map((item, idx) => {
                          const imgName = nameOf(item);
                          const scene = sceneOf(item);
                          const confidence = confidenceOf(item);
                          const isSelected = multiSelect.selectedIds.has(imgName);

                          return (
                            <SelectablePhotoCard
                              key={`${imgName}-${idx}`}
                              item={item}
                              imageId={imgName}
                              imageUrl={`${API}/public/events/${token}/image/${imgName}`}
                              //thumbnailUrl={`${API}/public/events/${token}/image/${imgName}`}
                              thumbnailUrl={`${API}/public/events/${token}/thumbnail/${imgName}`}  // Optimized thumbnail
                              isSelected={isSelected}
                              selectionIndex={multiSelect.getSelectionIndex(imgName)}
                              isSelectMode={multiSelect.isSelectMode}
                              onToggle={() => multiSelect.toggle(imgName)}
                              onClick={() => {
                                setPreviewIndex(idx);
                                setPreviewImage(imgName);
                              }}
                              scene={scene}
                              confidence={confidence}
                              showConfidence={showConfidence}
                              watermarkConfig={watermarkConfig}
                            />
                          );
                        })}
                      </motion.div>

                      <div ref={sentinelRef} style={{ height: 4 }} />

                      {/* Load state */}
                      <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 8, padding: '36px 0',
                      }}>
                        {tab.loading && (
                          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                            <Loader2 size={22} color="var(--gold)" />
                          </motion.div>
                        )}
                        {!tab.loading && !tab.has_more && tab.total > 0 && (
                          <p style={{ color: 'var(--muted)', fontSize: 12 }}>All {tab.total} photos loaded ✓</p>
                        )}
                        {tab.error && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--rose)' }}>
                            <AlertCircle size={14} /> {tab.error}
                            <button onClick={loadNextPage} style={{ color: 'var(--gold)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                              <RefreshCw size={12} /> Retry
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Empty state */
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', padding: '80px 20px', gap: 16, textAlign: 'center',
                      }}
                    >
                      <div className="glass" style={{
                        width: 72, height: 72, borderRadius: 22,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ImageIcon size={28} color="var(--muted)" />
                      </div>
                      <div>
                        <p style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
                          {activeScene !== 'all' ? `No photos tagged "${activeScene}"` : activeObject !== 'all' ? `No photos with "${activeObject}"` : 'No matches found'}
                        </p>
                        {activeScene === 'all' && activeObject === 'all' && (
                          <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.65, maxWidth: 270 }}>
                            Try a clear, front-facing selfie with good lighting for the best results.
                          </p>
                        )}
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          if (activeScene !== 'all' || activeObject !== 'all') {
                            resetFilters();
                          } else {
                            setResultId(null);
                            setTab(emptyTab());
                          }
                        }}
                        className="btn-gold"
                        style={{ padding: '11px 22px', borderRadius: 11, fontSize: 14, cursor: 'pointer' }}
                      >
                        {activeScene !== 'all' || activeObject !== 'all' ? 'Show all photos' : 'Try Again'}
                      </motion.button>
                    </motion.div>
                  )}
                </motion.section>
              )}
            </motion.div>
          )}

          {/* ════════════ CONTRIBUTE MODE ════════════ */}
          {mode === 'contribute' && (
            <motion.div
              key="contribute"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              style={{ maxWidth: 660, margin: '0 auto', padding: '64px 20px 40px' }}
            >
              {/* Header with back button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { setMode('search'); resetContrib(); }}
                  className="glass"
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'var(--dim)',
                  }}
                >
                  <ArrowLeft size={18} />
                </motion.button>
                <div>
                  <h2 className="serif" style={{ fontSize: 24, fontWeight: 600, color: '#fff' }}>Share Your Photos</h2>
                  <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Help others find themselves in your shots</p>
                </div>
              </div>

              {/* Drop zone / Preview / Success states */}
              <AnimatePresence mode="wait">
                {/* ─── Drop Zone ─── */}
                {uploadStep === 'drop' && (
                  <motion.div
                    key="drop"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    <div
                      className={`drop-zone ${dragOver ? 'over' : ''}`}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOver(false);
                        addContribFiles(e.dataTransfer.files);
                      }}
                      onClick={() => contribInputRef.current?.click()}
                      style={{
                        border: '2px dashed var(--border)', borderRadius: 20, padding: '48px 24px',
                        textAlign: 'center', cursor: 'pointer',
                        background: dragOver ? 'var(--gold-dim)' : 'var(--surf)',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div className="g-gold" style={{
                        width: 72, height: 72, borderRadius: 20,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 20px',
                      }}>
                        <CloudUpload size={32} color="var(--gold)" />
                      </div>
                      <p style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                        Drag & drop your photos here
                      </p>
                      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>
                        or click to browse your device
                      </p>
                      <p style={{ color: 'var(--muted)', fontSize: 12 }}>
                        Up to 30 photos · JPG, PNG, WebP
                      </p>
                      <input
                        ref={contribInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={e => addContribFiles(e.target.files)}
                      />
                    </div>

                    {/* Optional: Show event info */}
                    <div className="glass" style={{ marginTop: 20, padding: 16, borderRadius: 14 }}>
                      <p style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.6 }}>
                        <strong style={{ color: '#fff' }}>Your photos will be added to:</strong><br />
                        {event?.name || 'This event'} · Photos are processed securely and made available for face matching.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ─── Preview ─── */}
                {uploadStep === 'preview' && (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {/* Photo previews */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                      gap: 8, marginBottom: 20,
                    }}>
                      {contribFiles.map((f, idx) => (
                        <div key={f.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden' }}>
                          <img src={f.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <button
                            onClick={() => setContribFiles(prev => prev.filter((_, i) => i !== idx))}
                            style={{
                              position: 'absolute', top: 4, right: 4, width: 22, height: 22,
                              borderRadius: '50%', background: 'rgba(0,0,0,0.6)',
                              border: 'none', cursor: 'pointer', display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            <X size={12} color="#fff" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add more button */}
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => contribInputRef.current?.click()}
                      className="btn-ghost"
                      style={{
                        width: '100%', padding: '12px', borderRadius: 10, fontSize: 14,
                        cursor: 'pointer', marginBottom: 20,
                      }}
                    >
                      <Upload size={16} style={{ marginRight: 8 }} /> Add More Photos
                    </motion.button>
                    <input
                      ref={contribInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={e => addContribFiles(e.target.files)}
                    />

                    {/* Optional name and message */}
                    <div style={{ marginBottom: 20 }}>
                      <label style={{ display: 'block', color: 'var(--dim)', fontSize: 13, marginBottom: 6 }}>
                        Your name (optional)
                      </label>
                      <input
                        type="text"
                        value={contribName}
                        onChange={e => setContribName(e.target.value)}
                        placeholder="So others know who contributed"
                        className="glass"
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 10,
                          background: 'var(--surf)', border: '1px solid var(--border)',
                          color: '#fff', fontSize: 14, outline: 'none',
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <label style={{ display: 'block', color: 'var(--dim)', fontSize: 13, marginBottom: 6 }}>
                        Message (optional)
                      </label>
                      <textarea
                        value={contribMsg}
                        onChange={e => setContribMsg(e.target.value)}
                        placeholder="A note for the event organizer"
                        className="glass"
                        style={{
                          width: '100%', padding: '12px 16px', borderRadius: 10,
                          background: 'var(--surf)', border: '1px solid var(--border)',
                          color: '#fff', fontSize: 14, outline: 'none', resize: 'none',
                          minHeight: 80,
                        }}
                      />
                    </div>

                    {/* Error message */}
                    {contribError && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: 12, borderRadius: 10, background: 'rgba(248,113,113,0.12)',
                        border: '1px solid rgba(248,113,113,0.22)', marginBottom: 16,
                      }}>
                        <AlertCircle size={16} color="var(--rose)" />
                        <span style={{ color: 'var(--rose)', fontSize: 13 }}>{contribError}</span>
                      </div>
                    )}

                    {/* Submit buttons */}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={resetContrib}
                        className="btn-ghost"
                        style={{ flex: 1, padding: '14px', borderRadius: 12, fontSize: 14, cursor: 'pointer' }}
                      >
                        Cancel
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={submitContrib}
                        className="btn-gold"
                        style={{ flex: 2, padding: '14px', borderRadius: 12, fontSize: 14, cursor: 'pointer' }}
                      >
                        Upload {contribFiles.length} Photo{contribFiles.length !== 1 ? 's' : ''}
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {/* ─── Submitting ─── */}
                {uploadStep === 'submitting' && (
                  <motion.div
                    key="submitting"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="glass"
                    style={{ borderRadius: 20, padding: '48px 24px', textAlign: 'center' }}
                  >
                    <div style={{ position: 'relative', width: 64, height: 64, margin: '0 auto 20px' }}>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        style={{
                          position: 'absolute', inset: 0, borderRadius: '50%',
                          border: '3px solid transparent',
                          borderTopColor: 'var(--gold)', borderRightColor: 'var(--gold-border)',
                        }}
                      />
                    </div>
                    <p style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
                      Uploading your photos…
                    </p>
                    <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                      Please wait while we process your contribution
                    </p>
                  </motion.div>
                )}

                {/* ─── Success ─── */}
                {uploadStep === 'success' && (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="g-jade"
                    style={{ borderRadius: 20, padding: '48px 24px', textAlign: 'center' }}
                  >
                    <div style={{
                      width: 72, height: 72, borderRadius: '50%',
                      background: 'rgba(74,222,128,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 20px',
                    }}>
                      <Check size={36} color="var(--jade)" />
                    </div>
                    <p style={{ color: '#fff', fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
                      Thank you for sharing!
                    </p>
                    <p style={{ color: 'var(--dim)', fontSize: 14, marginBottom: 24 }}>
                      {uploadCount} photo{uploadCount !== 1 ? 's' : ''} uploaded successfully
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => { setMode('search'); resetContrib(); }}
                      className="btn-gold"
                      style={{ padding: '14px 28px', borderRadius: 12, fontSize: 14, cursor: 'pointer' }}
                    >
                      Find Your Photos
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ════════════ PHOTO PREVIEW MODAL ════════════ */}
      <AnimatePresence>
        {previewImage && (
          <PhotoPreview
            isOpen={!!previewImage}
            onClose={() => setPreviewImage(null)}
            items={filteredItems}
            currentIndex={previewIndex}
            onNavigate={(idx) => {
              setPreviewIndex(idx);
              setPreviewImage(nameOf(filteredItems[idx]));
            }}
            apiBaseUrl={API}
            token={token}
            showConfidence={showConfidence}
            showScene={true}
            onDownload={downloadSinglePhoto}
            watermarkConfig={watermarkConfig}
          />
        )}
      </AnimatePresence>

      {/* ════════════ INFO MODAL ════════════ */}
      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowInfo(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 100,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="glass"
              style={{
                maxWidth: 420, padding: 32, borderRadius: 20,
                background: 'rgba(17,17,27,0.95)',
              }}
            >
              <h3 className="serif" style={{ fontSize: 24, marginBottom: 16 }}>How It Works</h3>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 700 }}>01</span>
                  <span style={{ color: 'var(--dim)', fontSize: 14 }}>Upload a clear selfie with your face visible</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 700 }}>02</span>
                  <span style={{ color: 'var(--dim)', fontSize: 14 }}>Our AI scans all event photos for your face</span>
                </li>
                <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{ color: 'var(--gold)', fontSize: 12, fontWeight: 700 }}>03</span>
                  <span style={{ color: 'var(--dim)', fontSize: 14 }}>Download your matched photos instantly</span>
                </li>
              </ul>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowInfo(false)}
                className="btn-gold"
                style={{ width: '100%', padding: '12px 0', borderRadius: 12, fontSize: 14, marginTop: 24, cursor: 'pointer' }}
              >
                Got it!
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════ CAMERA MODAL ════════════ */}
      <CameraWithEnhancements
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleUpload}
        showFaceGuide={true}
        defaultTimer={0}
      />
    </div>
  );
}