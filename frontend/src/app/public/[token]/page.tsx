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

  // Watermark state
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(DEFAULT_WATERMARK_CONFIG);

  // Refs
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contribInputRef = useRef<HTMLInputElement>(null);

  // Plan detection
  const isPro = !!(event?.plan_type && event.plan_type !== 'free');
  const guestUpload = true;

  // ── Scene / Object Counts ──
  const sceneCounts = useMemo(() => {
    return tab.items.reduce((acc: Record<string, number>, item) => {
      const s = sceneOf(item);
      if (s) acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
  }, [tab.items]);

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

  const resetFilters = useCallback(() => {
    setActiveScene('all');
    setActiveObject('all');
  }, []);

  const filteredItems = useMemo(() => {
    let items = tab.items;
    if (activeScene !== 'all') items = items.filter(item => sceneOf(item) === activeScene);
    if (activeObject !== 'all') items = items.filter(item => objectOf(item) === activeObject);
    return items;
  }, [tab.items, activeScene, activeObject]);

  // ── Load Event ──
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}`)
      .then(r => r.json())
      .then((data: EventData) => {
        setEvent(data);
        if (data.watermark_enabled && data.watermark_config) {
          setWatermarkConfig({ ...DEFAULT_WATERMARK_CONFIG, ...data.watermark_config, enabled: true });
        } else if (data.watermark_enabled) {
          setWatermarkConfig({ ...DEFAULT_WATERMARK_CONFIG, enabled: true });
        } else {
          setWatermarkConfig({ ...DEFAULT_WATERMARK_CONFIG, enabled: false });
        }
      })
      .catch(err => console.error('Failed to load event:', err));
  }, [token]);

  useEffect(() => { resetFilters(); }, [mode, resetFilters]);

  // ── Face Search ──
  const handleUpload = useCallback(async (file: File) => {
    setProcessing(true);
    setResultId(null);
    setTab(emptyTab());
    resetFilters();
    Analytics.selfieUploaded('upload');

    try {
      let processedFile = file;
      if (file.size > 1024 * 1024) {
        processedFile = await compressImage(file, { maxWidth: 1920, quality: 0.85 });
      }
      const form = new FormData();
      form.append('file', processedFile);
      form.append('sensitivity', String(sensitivity / 100));

      const res = await fetch(`${API}/public/events/${token}/search`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());

      const data: SearchResult = await res.json();
      setResultId(data.result_id);

      const avgConfidence = data.you.items.length > 0
        ? Math.round(data.you.items.reduce((sum, item) => sum + (item.similarity ?? 0.85) * 100, 0) / data.you.items.length)
        : 0;

      setTab({ items: data.you.items, page: 1, total: data.you.total, has_more: data.you.has_more, loading: false, error: null });
      Analytics.searchCompleted(data.you.total, avgConfidence);
      setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 300);
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
      const res = await fetch(`${API}/public/events/${token}/search/${resultId}?kind=you&page=${nextPage}`);
      if (res.status === 404) { setTab(prev => ({ ...prev, loading: false, has_more: false, error: 'Session expired.' })); return; }
      if (!res.ok) throw new Error(await res.text());
      const data: PageData = await res.json();
      setTab(prev => ({ items: [...prev.items, ...data.items], page: data.page, total: data.total, has_more: data.has_more, loading: false, error: null }));
    } catch {
      setTab(prev => ({ ...prev, loading: false, error: 'Failed to load more.' }));
    }
  }, [tab, resultId, token, API]);

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadNextPage(); }, { rootMargin: '400px' });
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [loadNextPage]);

  // ── Download Single with Watermark ──
  const downloadSinglePhoto = useCallback(async (imageName: string) => {
    try {
      const res = await fetch(`${API}/public/events/${token}/photo/${imageName}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();

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
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to create blob')), 'image/jpeg', 0.95);
          });
          const url = URL.createObjectURL(watermarkedBlob);
          const a = document.createElement('a');
          a.href = url; a.download = imageName;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url); URL.revokeObjectURL(img.src);
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = imageName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
      const res = await fetch(`${API}/public/events/${token}/download/${resultId}?kind=matched`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${event?.name || 'event'}-photos.zip` });
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
    const valid = Array.from(fl).filter(f => f.type.startsWith('image/')).map(f => ({
      file: f, preview: URL.createObjectURL(f), id: Math.random().toString(36).slice(2),
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
      const res = await fetch(`${API}/public/events/${token}/contribute`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUploadCount(data.uploaded ?? contribFiles.length);
      setContribFiles([]); setContribName(''); setContribMsg('');
      setUploadStep('success');
      Analytics.contributeCompleted(data.uploaded ?? contribFiles.length);
    } catch (err) {
      setContribError(err instanceof Error ? err.message : 'Upload failed');
      setUploadStep('preview');
    }
  }, [contribFiles, contribName, contribMsg, token, API]);

  const resetContrib = useCallback(() => {
    setUploadStep('drop'); setContribFiles([]); setContribName(''); setContribMsg(''); setContribError(null);
  }, []);

  // ── Grid CSS ──
  const gridCols = useMemo(() => ({
    comfortable: 'repeat(auto-fill, minmax(220px, 1fr))',
    compact: 'repeat(auto-fill, minmax(148px, 1fr))',
    large: 'repeat(auto-fill, minmax(320px, 1fr))',
  }[gridLayout]), [gridLayout]);

  const handlePreviewNavigate = useCallback((index: number) => {
    setPreviewIndex(index);
    setPreviewImage(nameOf(filteredItems[index]));
  }, [filteredItems]);

  // ── Filter pill shared classes ──
  const pillBase = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-colors whitespace-nowrap capitalize';
  const pillInactive = 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200';
  const pillActive = 'bg-blue-500/10 border-blue-500/30 text-blue-400';

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#09090f] text-white font-sans">

      {/* ── Ambient glows ── */}
      <div aria-hidden className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-[15%] left-1/4 w-[700px] h-[600px] rounded-full bg-blue-500/[0.04] blur-[80px]" />
        <div className="absolute bottom-[5%] right-[5%] w-[500px] h-[500px] rounded-full bg-violet-500/[0.03] blur-[90px]" />
      </div>

      {/* ══ HEADER ══ */}
      <header className="fixed top-0 inset-x-0 z-50 h-[62px] bg-[#09090f]/88 backdrop-blur-2xl border-b border-zinc-800/60">
        <div className="max-w-6xl mx-auto h-full px-5 flex items-center justify-between">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 ring-2 ring-blue-500/20">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100 leading-tight">
                {event?.name || 'Event Photos'}
              </p>
              <p className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mt-0.5">
                AI · Face Recognition
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {guestUpload && mode === 'search' && (
              <motion.button
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setMode('contribute')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-xs font-semibold text-zinc-200 transition-colors"
              >
                <CloudUpload size={13} /> Share Photos
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowInfo(true)}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <Info size={15} />
            </motion.button>
          </div>
        </div>
      </header>

      {/* ══ MAIN ══ */}
      <main className="pt-[78px] pb-24 min-h-screen relative z-10">
        <AnimatePresence mode="wait">

          {/* ════════════ SEARCH MODE ════════════ */}
          {mode === 'search' && (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }}>

              {/* ─── Hero ─── */}
              {!resultId && !processing && (
                <motion.section
                  variants={stagger} initial="hidden" animate="visible"
                  className="max-w-xl mx-auto px-5 pt-16 pb-10 text-center"
                >
                  {/* Icon */}
                  <motion.div variants={fadeUp} className="inline-flex mb-7 relative">
                    <div className="w-[92px] h-[92px] rounded-[28px] bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Scan size={44} className="text-blue-400" strokeWidth={1.4} />
                    </div>
                    {/* Corner accents */}
                    {[['top-[-4px]', 'left-[-4px]', 'border-t-2', 'border-l-2', 'rounded-tl'],
                      ['top-[-4px]', 'right-[-4px]', 'border-t-2', 'border-r-2', 'rounded-tr'],
                      ['bottom-[-4px]', 'left-[-4px]', 'border-b-2', 'border-l-2', 'rounded-bl'],
                      ['bottom-[-4px]', 'right-[-4px]', 'border-b-2', 'border-r-2', 'rounded-br'],
                    ].map((cls, i) => (
                      <div key={i} className={`absolute w-3.5 h-3.5 border-blue-400 ${cls.join(' ')}`} />
                    ))}
                  </motion.div>

                  <motion.h1 variants={fadeUp} className="text-[clamp(36px,6vw,60px)] font-bold leading-[1.08] mb-4 text-zinc-50 tracking-tight">
                    Find Yourself<br />in Every Photo
                  </motion.h1>

                  <motion.p variants={fadeUp} className="text-zinc-400 text-base leading-relaxed max-w-[430px] mx-auto mb-10">
                    Upload a selfie — AI scans every event photo and finds your matches instantly.
                  </motion.p>

                  {/* Sensitivity Slider */}
                  <motion.div variants={fadeUp} className="max-w-[280px] mx-auto mb-6">
                    <ConfidenceSlider value={sensitivity} onChange={setSensitivity} min={50} max={95} step={5} />
                  </motion.div>

                  {/* CTA buttons */}
                  <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3 max-w-[430px] mx-auto mb-4">
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => setCameraOpen(true)}
                      className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
                    >
                      <Camera size={17} /> Take Selfie
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold transition-colors"
                    >
                      <Upload size={17} /> Upload Photo
                    </motion.button>
                    <input
                      ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ''; }}
                    />
                  </motion.div>

                  {/* Drag zone */}
                  <motion.div variants={fadeUp}>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                      className={`border-2 border-dashed rounded-2xl p-4 text-sm text-zinc-500 max-w-[430px] mx-auto text-center transition-colors ${
                        dragOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-zinc-700/60'
                      }`}
                    >
                      or drag &amp; drop your selfie here
                    </div>
                  </motion.div>

                  {/* How it works */}
                  <motion.div
                    variants={stagger}
                    className="grid grid-cols-3 gap-3 mt-12 max-w-[480px] mx-auto"
                  >
                    {[
                      { icon: Camera, label: 'Snap a selfie', n: '01' },
                      { icon: Scan, label: 'AI scans photos', n: '02' },
                      { icon: Download, label: 'Download yours', n: '03' },
                    ].map((step) => {
                      const Icon = step.icon;
                      return (
                        <motion.div key={step.n} variants={fadeUp}
                          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center">
                          <p className="text-[9px] font-black tracking-widest text-blue-400 mb-2.5">{step.n}</p>
                          <Icon size={20} className="text-blue-400 mx-auto mb-2.5" />
                          <p className="text-zinc-300 text-xs font-medium leading-snug">{step.label}</p>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </motion.section>
              )}

              {/* ─── Processing ─── */}
              {processing && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="max-w-[460px] mx-auto mt-[72px] px-5">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-14 text-center">
                    <div className="relative w-[76px] h-[76px] mx-auto mb-7">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-400 border-r-blue-400/30"
                      />
                      <div className="absolute inset-[10px] rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Scan size={22} className="text-blue-400" />
                      </div>
                    </div>
                    <h3 className="text-zinc-100 text-2xl font-bold mb-2.5">Scanning Photos…</h3>
                    <p className="text-zinc-500 text-sm leading-relaxed">
                      AI is finding your face across every event photo. This takes just a moment.
                    </p>
                    <div className="mt-7 h-0.5 rounded-full bg-zinc-800 overflow-hidden">
                      <motion.div
                        animate={{ x: ['-100%', '100%'] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                        className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-blue-400 to-transparent"
                      />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ─── Results ─── */}
              {resultId && !processing && (
                <motion.section id="results-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="max-w-6xl mx-auto px-5 pt-6">

                  {/* Results header row */}
                  <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2.5 mb-1">
                        <h2 className="text-xl font-bold text-zinc-100">Your Photos</h2>
                        {tab.total > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-bold text-blue-400">
                            {tab.total}{tab.has_more ? '+' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">
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
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Multi-select toggle (inactive) */}
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
                      <div className="flex gap-0.5 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
                        {([
                          { k: 'large' as GridLayout, icon: <Grid2X2 size={13} />, title: 'Large' },
                          { k: 'comfortable' as GridLayout, icon: <LayoutGrid size={13} />, title: 'Comfortable' },
                          { k: 'compact' as GridLayout, icon: <SlidersHorizontal size={13} />, title: 'Compact' },
                        ]).map(({ k, icon, title }) => (
                          <button
                            key={k} title={title}
                            onClick={() => { setGridLayout(k); Analytics.layoutChanged(k); }}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-colors ${
                              gridLayout === k
                                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                            }`}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>

                      {/* Download All — Pro */}
                      {isPro && tab.total > 0 && (
                        <motion.button
                          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAll} disabled={dlAllLoading}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                        >
                          {dlAllLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={13} /></motion.div> Preparing…</>
                            : <><PackageOpen size={13} /> Download All ({tab.total})</>}
                        </motion.button>
                      )}

                      {/* Free plan upsell */}
                      {!isPro && tab.total > 1 && (
                        <motion.button
                          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAll} disabled={dlAllLoading}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs font-medium text-blue-400 disabled:opacity-50 transition-colors"
                        >
                          {dlAllLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={12} /></motion.div> Preparing…</>
                            : <><Star size={12} /> Download all {tab.total} photos as ZIP</>}
                        </motion.button>
                      )}

                      {/* New search */}
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => { setResultId(null); setTab(emptyTab()); resetFilters(); }}
                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
                      >
                        <RefreshCw size={12} /> New Search
                      </motion.button>
                    </div>
                  </div>

                  {/* Multi-select toolbar (when active) */}
                  <AnimatePresence>
                    {multiSelect.isSelectMode && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="mb-4"
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
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      className="flex gap-2 flex-wrap items-center mb-4 pb-4 border-b border-zinc-800"
                    >
                      <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-600 flex-shrink-0 mr-1">Scene</span>
                      <button
                        onClick={resetFilters}
                        className={`${pillBase} ${activeScene === 'all' && activeObject === 'all' ? pillActive : pillInactive}`}
                      >
                        All · {tab.total}
                      </button>
                      {sceneLabels.map(label => (
                        <button
                          key={label}
                          onClick={() => { setActiveScene(activeScene === label ? 'all' : label); Analytics.sceneFiltered(label); }}
                          className={`${pillBase} ${activeScene === label ? pillActive : pillInactive}`}
                        >
                          {sceneIcon(label)} {label} · {sceneCounts[label]}
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {/* ── Object filter pills ── */}
                  {hasObjects && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      className="flex gap-2 flex-wrap items-center mb-4 pb-4 border-b border-zinc-800"
                    >
                      <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-600 flex-shrink-0 mr-1">Objects</span>
                      <button
                        onClick={() => setActiveObject('all')}
                        className={`${pillBase} ${activeObject === 'all' ? pillActive : pillInactive}`}
                      >
                        All · {tab.total}
                      </button>
                      {objectLabels.map(label => (
                        <button
                          key={label}
                          onClick={() => { setActiveObject(activeObject === label ? 'all' : label); Analytics.sceneFiltered(label); }}
                          className={`${pillBase} ${activeObject === label ? pillActive : pillInactive}`}
                        >
                          {label} · {objectCounts[label]}
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {/* ── Photo grid ── */}
                  {filteredItems.length > 0 ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8 }}>
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
                              thumbnailUrl={`${API}/public/events/${token}/thumbnail/${imgName}`}
                              isSelected={isSelected}
                              selectionIndex={multiSelect.getSelectionIndex(imgName)}
                              isSelectMode={multiSelect.isSelectMode}
                              onToggle={() => multiSelect.toggle(imgName)}
                              onClick={() => { setPreviewIndex(idx); setPreviewImage(imgName); }}
                              scene={scene}
                              confidence={confidence}
                              showConfidence={showConfidence}
                              watermarkConfig={watermarkConfig}
                            />
                          );
                        })}
                      </div>

                      <div ref={sentinelRef} className="h-1" />

                      {/* Load state */}
                      <div className="flex flex-col items-center gap-2 py-10">
                        {tab.loading && (
                          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                            <Loader2 size={22} className="text-blue-400" />
                          </motion.div>
                        )}
                        {!tab.loading && !tab.has_more && tab.total > 0 && (
                          <p className="text-xs text-zinc-600">All {tab.total} photos loaded ✓</p>
                        )}
                        {tab.error && (
                          <div className="flex items-center gap-2 text-xs text-red-400">
                            <AlertCircle size={13} /> {tab.error}
                            <button onClick={loadNextPage} className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors">
                              <RefreshCw size={11} /> Retry
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Empty state */
                    <motion.div
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="flex flex-col items-center justify-center py-20 gap-4 text-center"
                    >
                      <div className="w-[72px] h-[72px] rounded-[22px] bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                        <ImageIcon size={28} className="text-zinc-600" />
                      </div>
                      <div>
                        <p className="text-zinc-200 font-semibold text-base mb-2">
                          {activeScene !== 'all' ? `No photos tagged "${activeScene}"`
                            : activeObject !== 'all' ? `No photos with "${activeObject}"`
                            : 'No matches found'}
                        </p>
                        {activeScene === 'all' && activeObject === 'all' && (
                          <p className="text-zinc-500 text-sm leading-relaxed max-w-[270px]">
                            Try a clear, front-facing selfie with good lighting for the best results.
                          </p>
                        )}
                      </div>
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          if (activeScene !== 'all' || activeObject !== 'all') resetFilters();
                          else { setResultId(null); setTab(emptyTab()); }
                        }}
                        className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
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
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="max-w-lg mx-auto px-5 pt-8"
            >
              {/* Back header */}
              <div className="flex items-center gap-3 mb-8">
                <motion.button
                  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => { setMode('search'); resetContrib(); }}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <ArrowLeft size={17} />
                </motion.button>
                <div>
                  <h2 className="text-xl font-bold text-zinc-100">Share Your Photos</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Help others find themselves in your shots</p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {/* ─── Drop Zone ─── */}
                {uploadStep === 'drop' && (
                  <motion.div key="drop" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); addContribFiles(e.dataTransfer.files); }}
                      onClick={() => contribInputRef.current?.click()}
                      className={`rounded-2xl p-12 text-center cursor-pointer border-2 border-dashed transition-all ${
                        dragOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900/60'
                      }`}
                    >
                      <div className="w-[72px] h-[72px] rounded-[20px] bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-5">
                        <CloudUpload size={32} className="text-blue-400" />
                      </div>
                      <p className="text-zinc-100 text-lg font-semibold mb-2">Drag &amp; drop your photos here</p>
                      <p className="text-zinc-500 text-sm mb-4">or click to browse your device</p>
                      <p className="text-zinc-600 text-xs">Up to 30 photos · JPG, PNG, WebP</p>
                      <input ref={contribInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addContribFiles(e.target.files)} />
                    </div>

                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mt-4">
                      <p className="text-zinc-400 text-xs leading-relaxed">
                        <span className="text-zinc-200 font-medium">Your photos will be added to: </span>
                        {event?.name || 'This event'} · Photos are processed securely and made available for face matching.
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ─── Preview ─── */}
                {uploadStep === 'preview' && (
                  <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    {/* Photo thumbnails */}
                    <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
                      {contribFiles.map((f, idx) => (
                        <div key={f.id} className="relative aspect-square rounded-xl overflow-hidden">
                          <img src={f.preview} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setContribFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 border border-white/10 flex items-center justify-center hover:bg-black/80 transition-colors"
                          >
                            <X size={10} className="text-white" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add more */}
                    <button
                      onClick={() => contribInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm font-medium transition-colors mb-5"
                    >
                      <Upload size={14} /> Add More Photos
                    </button>
                    <input ref={contribInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addContribFiles(e.target.files)} />

                    {/* Optional name */}
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Your name (optional)</label>
                      <input
                        type="text" value={contribName} onChange={e => setContribName(e.target.value)}
                        placeholder="So others know who contributed"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                      />
                    </div>

                    {/* Optional message */}
                    <div className="mb-5">
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Message (optional)</label>
                      <textarea
                        value={contribMsg} onChange={e => setContribMsg(e.target.value)}
                        placeholder="A note for the event organizer"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors resize-none min-h-[80px]"
                      />
                    </div>

                    {/* Error */}
                    {contribError && (
                      <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                        <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                        <span className="text-red-400 text-xs">{contribError}</span>
                      </div>
                    )}

                    {/* Submit */}
                    <div className="flex gap-2.5">
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={resetContrib}
                        className="flex-1 py-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm font-medium transition-colors"
                      >
                        Cancel
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                        onClick={submitContrib}
                        className="flex-[2] py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
                      >
                        Upload {contribFiles.length} Photo{contribFiles.length !== 1 ? 's' : ''}
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {/* ─── Submitting ─── */}
                {uploadStep === 'submitting' && (
                  <motion.div key="submitting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl py-14 px-6 text-center">
                    <div className="relative w-16 h-16 mx-auto mb-6">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-400 border-r-blue-400/30"
                      />
                    </div>
                    <p className="text-zinc-100 text-lg font-semibold mb-2">Uploading your photos…</p>
                    <p className="text-zinc-500 text-sm">Please wait while we process your contribution</p>
                  </motion.div>
                )}

                {/* ─── Success ─── */}
                {uploadStep === 'success' && (
                  <motion.div key="success" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                    className="bg-emerald-500/8 border border-emerald-500/20 rounded-2xl py-14 px-6 text-center">
                    <div className="w-[72px] h-[72px] rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto mb-6">
                      <Check size={34} className="text-emerald-400" />
                    </div>
                    <p className="text-zinc-100 text-xl font-bold mb-2">Thank you for sharing!</p>
                    <p className="text-zinc-500 text-sm mb-8">
                      {uploadCount} photo{uploadCount !== 1 ? 's' : ''} uploaded successfully
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => { setMode('search'); resetContrib(); }}
                      className="px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
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
            onNavigate={handlePreviewNavigate}
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
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowInfo(false)}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-bold text-zinc-100">How It Works</h3>
                <button onClick={() => setShowInfo(false)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors">
                  <X size={13} />
                </button>
              </div>
              <ul className="space-y-4">
                {[
                  ['01', 'Upload a clear selfie with your face visible'],
                  ['02', 'Our AI scans all event photos for your face'],
                  ['03', 'Download your matched photos instantly'],
                ].map(([n, text]) => (
                  <li key={n} className="flex items-start gap-3">
                    <span className="text-[10px] font-black text-blue-400 tracking-wider mt-0.5 flex-shrink-0">{n}</span>
                    <span className="text-zinc-400 text-sm leading-snug">{text}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setShowInfo(false)}
                className="w-full mt-7 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
              >
                Got it!
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════════════ CAMERA MODAL ════════════ */}
      <CameraWithEnhancements
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        showFaceGuide={true}
        defaultTimer={0}
      />
    </div>
  );
}