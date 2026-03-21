'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Download, Camera, Info, Scan,
  ImageIcon, RefreshCw, Sparkles,
  Loader2, X, Check, ArrowLeft,
  AlertCircle, CloudUpload,
  SlidersHorizontal, PackageOpen, Grid2X2, LayoutGrid, Lock, ShieldCheck, Eye, EyeOff,
  Images,
} from 'lucide-react';
import { compressImage, hapticFeedback, Analytics, nameOf, sceneOf, objectOf } from '@/lib/snapmatch/utils';
import { useReducedMotion } from '@/hooks/snapmatch/useSnapmatch';
import { sceneIcon } from '@/components/snapmatch/UIComponents';
import { PhotoPreview } from '@/components/snapmatch/PhotoPreview';
import { MultiSelectToolbar, SelectablePhotoCard, useMultiSelect } from '@/components/snapmatch/MultiSelect';
import { CameraWithEnhancements } from '@/components/snapmatch/CameraEnhancements';
import {
  WatermarkConfig,
  DEFAULT_WATERMARK_CONFIG,
  applyWatermarkToCanvas,
} from '@/lib/snapmatch/watermark';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhotoItem {
  image_name:   string;
  scene_label?: string;
  object_label?: string;
  objects?:     string[];
  similarity?:  number;
}

interface PageData {
  result_id?:  string;
  page:        number;
  page_size:   number;
  total:       number;
  total_pages: number;
  has_more:    boolean;
  items:       PhotoItem[];
}

interface TabState {
  items:    PhotoItem[];
  page:     number;
  total:    number;
  has_more: boolean;
  loading:  boolean;
  error:    string | null;
}

interface EventData {
  name:                 string;
  image_count?:         number;
  processed_count?:     number;
  watermark_enabled?:   boolean;
  watermark_config?:    WatermarkConfig;
  pin_enabled?:         boolean;
  pin_version?:         string | null;
  expires_at?:          string | null;
  owner_id?:            number;
  upload_photo_enabled?: boolean;
  processing_status?:   string;
}

type ActiveTab    = 'my-photos' | 'all-photos';
type Mode         = 'search' | 'contribute';
type UploadStep   = 'drop' | 'preview' | 'submitting' | 'success';
type GridLayout   = 'comfortable' | 'compact' | 'large';

const emptyTab = (): TabState => ({ items: [], page: 1, total: 0, has_more: false, loading: false, error: null });

// ─── Animations ───────────────────────────────────────────────────────────────

const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.055, duration: 0.48, ease: [0.22, 1, 0.36, 1] as const },
  }),
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } } };

// ─── Main Component ────────────────────────────────────────────────────────────

export default function PublicSelfiePage() {
  const params  = useParams();
  const token   = params?.token as string;
  const API     = process.env.NEXT_PUBLIC_API_URL || '';

  // ── Core state ──
  const [event,        setEvent]       = useState<EventData | null>(null);
  const [activeTab,    setActiveTab]   = useState<ActiveTab>('my-photos');
  const [mode,         setMode]        = useState<Mode>('search');
  const [resultId,     setResultId]    = useState<string | null>(null);
  const [myTab,        setMyTab]       = useState<TabState>(emptyTab());
  const [allTab,       setAllTab]      = useState<TabState>(emptyTab());
  const [allSceneFilter, setAllSceneFilter] = useState('');
  const [allScenes,    setAllScenes]   = useState<{ scene_label: string; count: number }[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [cameraOpen,   setCameraOpen]  = useState(false);
  const [processing,   setProcessing]  = useState(false);
  const [showInfo,     setShowInfo]    = useState(false);
  const [dragOver,     setDragOver]    = useState(false);
  const [gridLayout,   setGridLayout]  = useState<GridLayout>('comfortable');
  const [dlAllLoading,    setDlAllLoading]    = useState(false);
  const [dlAllTabLoading, setDlAllTabLoading] = useState(false);
  const [batchDlLoading,  setBatchDlLoading]  = useState(false);
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(DEFAULT_WATERMARK_CONFIG);

  // ── Filter state (My Photos tab) ──
  const [activeScene,  setActiveScene]  = useState('all');
  const [activeObject, setActiveObject] = useState('all');

  // ── Contribute state ──
  const [uploadStep,   setUploadStep]  = useState<UploadStep>('drop');
  const [contribFiles, setContribFiles] = useState<{ file: File; preview: string; id: string }[]>([]);
  const [contribName,  setContribName] = useState('');
  const [contribMsg,   setContribMsg]  = useState('');
  const [contribError, setContribError] = useState<string | null>(null);
  const [uploadCount,  setUploadCount] = useState(0);

  // ── PIN state ──
  const [pinVerified, setPinVerified] = useState(false);
  const [pinInput,    setPinInput]    = useState(['', '', '', '']);
  const [pinError,    setPinError]    = useState<string | null>(null);
  const [pinLoading,  setPinLoading]  = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [showPin,     setShowPin]     = useState(false);
  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  // ── Refs ──
  const mySentinelRef  = useRef<HTMLDivElement>(null);
  const allSentinelRef = useRef<HTMLDivElement>(null);
  const myObserverRef  = useRef<IntersectionObserver | null>(null);
  const allObserverRef = useRef<IntersectionObserver | null>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const contribInputRef = useRef<HTMLInputElement>(null);

  // ── Multi-select (shares whichever tab is active) ──
  const activeItems   = activeTab === 'my-photos' ? myTab.items : allTab.items;
  const multiSelect   = useMultiSelect(activeItems);

  // ── PIN helpers ──
  const PIN_KEY = (t: string) => `pin_verified_${t}`;
  const readPinSession = (t: string, ver?: string | null): boolean => {
    try {
      const raw = localStorage.getItem(PIN_KEY(t));
      if (!raw) return false;
      const { verified, expiry, pinVersion } = JSON.parse(raw);
      if (!verified || Date.now() >= expiry) { localStorage.removeItem(PIN_KEY(t)); return false; }
      if (ver && pinVersion !== ver) { localStorage.removeItem(PIN_KEY(t)); return false; }
      return true;
    } catch { return false; }
  };
  const writePinSession = (t: string, pinVersion: string, expiresAt?: string | null) => {
    const eventExpiry = expiresAt ? new Date(expiresAt).getTime() : null;
    const expiry = eventExpiry && eventExpiry > Date.now() ? eventExpiry : Date.now() + 30 * 86400000;
    localStorage.setItem(PIN_KEY(t), JSON.stringify({ verified: true, expiry, pinVersion }));
  };

  // ── Load event ──
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}`)
      .then(r => r.json())
      .then((data: EventData) => {
        setEvent(data);
        if (data.watermark_enabled && data.watermark_config) {
          setWatermarkConfig({ ...DEFAULT_WATERMARK_CONFIG, ...data.watermark_config, enabled: true });
        } else {
          setWatermarkConfig({ ...DEFAULT_WATERMARK_CONFIG, enabled: !!data.watermark_enabled });
        }
      })
      .catch(console.error);
  }, [token, API]);

  // ── Load scene list for All Photos filter ──
  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/events/${token}/scenes`)
      .then(r => r.json())
      .then(d => setAllScenes(d.scenes ?? []))
      .catch(() => {});
  }, [token, API]);

  // ── PIN hydration ──
  useEffect(() => {
    if (!token || !event) return;
    if (!event.pin_enabled) { setPinVerified(true); return; }
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user?.id && event?.owner_id && user.id === event.owner_id) { setPinVerified(true); return; }
    } catch {}
    if (readPinSession(token, event.pin_version)) setPinVerified(true);
  }, [token, event]);

  // Auto-focus PIN
  useEffect(() => {
    if (event?.pin_enabled && !pinVerified) setTimeout(() => pinRefs[0].current?.focus(), 200);
  }, [event?.pin_enabled, pinVerified]);

  // Auto-submit PIN when all 4 digits filled
  useEffect(() => {
    if (pinInput.join('').length === 4 && !pinLoading && !pinError) verifyPin();
  }, [pinInput]);

  // ── PIN verify ──
  const verifyPin = useCallback(async () => {
    const pin = pinInput.join('');
    if (pin.length < 4) return;
    setPinLoading(true); setPinError(null);
    try {
      const res = await fetch(`${API}/public/events/${token}/verify-pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        writePinSession(token, event?.pin_version ?? '', event?.expires_at);
        setPinVerified(true); hapticFeedback('success');
      } else {
        const attempts = pinAttempts + 1;
        setPinAttempts(attempts);
        setPinError(attempts >= 5 ? 'Too many attempts. Please try again later.' : 'Incorrect PIN. Please try again.');
        setPinInput(['', '', '', '']); pinRefs[0].current?.focus(); hapticFeedback('error');
      }
    } catch { setPinError('Connection error. Please try again.'); }
    finally { setPinLoading(false); }
  }, [pinInput, token, API, pinAttempts, event]);

  // ── Scene / object counts for My Photos ──
  const sceneCounts = useMemo(() =>
    myTab.items.reduce((acc: Record<string, number>, item) => {
      const s = sceneOf(item); if (s) acc[s] = (acc[s] ?? 0) + 1; return acc;
    }, {}), [myTab.items]);

  const objectCounts = useMemo(() =>
    myTab.items.reduce((acc: Record<string, number>, item) => {
      const o = objectOf(item); if (o) acc[o] = (acc[o] ?? 0) + 1; return acc;
    }, {}), [myTab.items]);

  const resetFilters = useCallback(() => { setActiveScene('all'); setActiveObject('all'); }, []);

  const filteredMyItems = useMemo(() => {
    let items = myTab.items;
    if (activeScene !== 'all')  items = items.filter(i => sceneOf(i) === activeScene);
    if (activeObject !== 'all') items = items.filter(i => objectOf(i) === activeObject);
    return items;
  }, [myTab.items, activeScene, activeObject]);

  // ── Face search ──
  const handleUpload = useCallback(async (file: File) => {
    setProcessing(true); setResultId(null); setMyTab(emptyTab()); resetFilters();
    Analytics.selfieUploaded('upload');
    try {
      let f = file;
      if (file.size > 1024 * 1024) f = await compressImage(file, { maxWidth: 1920, quality: 0.85 });
      const form = new FormData(); form.append('file', f);
      const res = await fetch(`${API}/public/events/${token}/search`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResultId(data.result_id);
      setMyTab({ items: data.you.items, page: 1, total: data.you.total, has_more: data.you.has_more, loading: false, error: null });
      setActiveTab('my-photos');
      setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 300);
    } catch (err) { console.error(err); }
    finally { setProcessing(false); }
  }, [token, API, resetFilters]);

  // ── Load more My Photos ──
  const loadMoreMy = useCallback(async () => {
    if (!resultId || myTab.loading || !myTab.has_more) return;
    const nextPage = myTab.page + 1;
    setMyTab(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`${API}/public/events/${token}/search/${resultId}?kind=you&page=${nextPage}`);
      if (res.status === 404) { setMyTab(prev => ({ ...prev, loading: false, has_more: false, error: 'Session expired.' })); return; }
      if (!res.ok) throw new Error();
      const data: PageData = await res.json();
      setMyTab(prev => ({ items: [...prev.items, ...data.items], page: data.page, total: data.total, has_more: data.has_more, loading: false, error: null }));
    } catch { setMyTab(prev => ({ ...prev, loading: false, error: 'Failed to load more.' })); }
  }, [myTab, resultId, token, API]);

  // ── Load All Photos (initial + more) ──
  const loadAllPhotos = useCallback(async (page = 1, scene = '', reset = false) => {
    setAllTab(prev => reset ? { ...emptyTab(), loading: true } : { ...prev, loading: true, error: null });
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '30' });
      if (scene) params.set('scene', scene);
      const res = await fetch(`${API}/public/events/${token}/photos?${params}`);
      if (!res.ok) throw new Error();
      const data: PageData = await res.json();
      setAllTab(prev => ({
        items:    reset ? data.items : [...prev.items, ...data.items],
        page:     data.page,
        total:    data.total,
        has_more: data.has_more,
        loading:  false,
        error:    null,
      }));
    } catch { setAllTab(prev => ({ ...prev, loading: false, error: 'Failed to load photos.' })); }
  }, [token, API]);

  const loadMoreAll = useCallback(() => {
    if (allTab.loading || !allTab.has_more) return;
    loadAllPhotos(allTab.page + 1, allSceneFilter);
  }, [allTab, allSceneFilter, loadAllPhotos]);

  // ── Switch to All Photos tab — load first page if empty ──
  const handleTabSwitch = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === 'all-photos') {
      // Refresh scene pills every time the user opens All Photos tab.
      // AI enrichment runs after processing — scenes may have populated
      // after the page first loaded, so always re-fetch to stay current.
      fetch(`${API}/public/events/${token}/scenes`)
        .then(r => r.json())
        .then(d => setAllScenes(d.scenes ?? []))
        .catch(() => {});
      if (allTab.items.length === 0 && !allTab.loading) {
        loadAllPhotos(1, allSceneFilter, true);
      }
    }
    multiSelect.exitSelectMode();
  }, [allTab, allSceneFilter, loadAllPhotos, multiSelect, token, API]);

  // ── All Photos scene filter change ──
  const handleAllSceneFilter = useCallback((scene: string) => {
    setAllSceneFilter(scene);
    loadAllPhotos(1, scene, true);
  }, [loadAllPhotos]);

  // ── Infinite scroll observers ──
  useEffect(() => {
    myObserverRef.current?.disconnect();
    myObserverRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreMy(); },
      { rootMargin: '400px' }
    );
    if (mySentinelRef.current) myObserverRef.current.observe(mySentinelRef.current);
    return () => myObserverRef.current?.disconnect();
  }, [loadMoreMy]);

  useEffect(() => {
    allObserverRef.current?.disconnect();
    allObserverRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreAll(); },
      { rootMargin: '400px' }
    );
    if (allSentinelRef.current) allObserverRef.current.observe(allSentinelRef.current);
    return () => allObserverRef.current?.disconnect();
  }, [loadMoreAll]);

  // ── Download single with watermark ──
  const downloadSinglePhoto = useCallback(async (imageName: string) => {
    try {
      const res = await fetch(`${API}/public/events/${token}/photo/${imageName}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      if (watermarkConfig.enabled) {
        const img = new Image(); img.crossOrigin = 'anonymous';
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          await applyWatermarkToCanvas(canvas, watermarkConfig);
          const wblob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(), 'image/jpeg', 0.95));
          const wurl = URL.createObjectURL(wblob);
          const a = document.createElement('a'); a.href = wurl; a.download = imageName;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(wurl); URL.revokeObjectURL(url);
        }
      } else {
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = objUrl; a.download = imageName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
      }
      hapticFeedback('success');
    } catch { hapticFeedback('error'); }
  }, [token, API, watermarkConfig]);

  // ── Download all matched as ZIP ──
  const handleDownloadAll = useCallback(async () => {
    if (!resultId || dlAllLoading) return;
    setDlAllLoading(true); hapticFeedback('medium');
    try {
      const res = await fetch(`${API}/public/events/${token}/download/${resultId}?kind=matched`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${event?.name || 'event'}-photos.zip` });
      a.click(); URL.revokeObjectURL(url); hapticFeedback('success');
    } catch { hapticFeedback('error'); }
    finally { setDlAllLoading(false); }
  }, [resultId, dlAllLoading, token, API, event]);

  // ── Download all event photos as ZIP (All Photos tab) ──
  const handleDownloadAllTab = useCallback(async () => {
    if (dlAllTabLoading) return;
    setDlAllTabLoading(true); hapticFeedback('medium');
    try {
      const res = await fetch(`${API}/public/events/${token}/download-all`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${event?.name || 'event'}-all-photos.zip` });
      a.click(); URL.revokeObjectURL(url); hapticFeedback('success');
    } catch { hapticFeedback('error'); }
    finally { setDlAllTabLoading(false); }
  }, [dlAllTabLoading, token, API, event]);

  // ── Batch download selected → concurrent fetch → client-side ZIP ──
  const handleBatchDownload = useCallback(async () => {
    if (multiSelect.count === 0 || batchDlLoading) return;
    setBatchDlLoading(true); hapticFeedback('medium');
    try {
      const results = await Promise.allSettled(
        multiSelect.selectionOrder.map(async (imageName) => {
          const res = await fetch(`${API}/public/events/${token}/photo/${imageName}`);
          if (!res.ok) throw new Error();
          const blob = await res.blob();
          return { name: imageName, blob };
        })
      );
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const result of results) {
        if (result.status === 'fulfilled') {
          zip.file(result.value.name, result.value.blob);
        }
      }
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      const url = URL.createObjectURL(zipBlob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${event?.name || 'selected'}-photos.zip`,
      });
      a.click(); URL.revokeObjectURL(url);
      hapticFeedback('success');
      multiSelect.exitSelectMode();
    } catch { hapticFeedback('error'); }
    finally { setBatchDlLoading(false); }
  }, [multiSelect, batchDlLoading, token, API, event]);

  // ── Camera ──
  const handleCameraCapture = useCallback((file: File) => { setCameraOpen(false); handleUpload(file); }, [handleUpload]);

  // ── Contribute ──
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
    setUploadStep('submitting'); setContribError(null);
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
    } catch (err) {
      setContribError(err instanceof Error ? err.message : 'Upload failed');
      setUploadStep('preview');
    }
  }, [contribFiles, contribName, contribMsg, token, API]);

  const resetContrib = useCallback(() => { setUploadStep('drop'); setContribFiles([]); setContribName(''); setContribMsg(''); setContribError(null); }, []);

  // ── Grid CSS ──
  const gridCols = useMemo(() => ({
    comfortable: 'repeat(auto-fill, minmax(220px, 1fr))',
    compact:     'repeat(auto-fill, minmax(148px, 1fr))',
    large:       'repeat(auto-fill, minmax(320px, 1fr))',
  }[gridLayout]), [gridLayout]);

  const handlePreviewNavigate = useCallback((index: number) => {
    setPreviewIndex(index);
    setPreviewImage(nameOf(activeItems[index]));
  }, [activeItems]);

  const pillBase     = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-colors whitespace-nowrap capitalize';
  const pillInactive = 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200';
  const pillActive   = 'bg-blue-500/10 border-blue-500/30 text-blue-400';

  // ── Shared photo grid renderer ──────────────────────────────────────────────
  const renderPhotoGrid = (
    items:       PhotoItem[],
    sentinelRef: React.RefObject<HTMLDivElement>,
    tabState:    TabState,
    onRetry:     () => void,
    emptyMsg:    string,
    emptyAction: () => void,
    emptyActionLabel: string,
  ) => (
    <>
      {items.length > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8 }}>
            {items.map((item, idx) => {
              const imgName   = nameOf(item);
              const scene     = sceneOf(item);
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
                  confidence={0}
                  showConfidence={false}
                  watermarkConfig={watermarkConfig}
                />
              );
            })}
          </div>
          <div ref={sentinelRef} className="h-1" />
          <div className="flex flex-col items-center gap-2 py-10">
            {tabState.loading && (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                <Loader2 size={22} className="text-blue-400" />
              </motion.div>
            )}
            {!tabState.loading && !tabState.has_more && tabState.total > 0 && (
              <p className="text-xs text-zinc-600">All {tabState.total} photos loaded ✓</p>
            )}
            {tabState.error && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle size={13} /> {tabState.error}
                <button onClick={onRetry} className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
                  <RefreshCw size={11} /> Retry
                </button>
              </div>
            )}
          </div>
        </>
      ) : tabState.loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
            <Loader2 size={28} className="text-blue-400" />
          </motion.div>
          <p className="text-sm text-zinc-500">Loading photos…</p>
        </div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-[72px] h-[72px] rounded-[22px] bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <ImageIcon size={28} className="text-zinc-600" />
          </div>
          <div>
            <p className="text-zinc-200 font-semibold text-base mb-2">{emptyMsg}</p>
            <p className="text-zinc-500 text-sm max-w-[270px]">Try a clear front-facing selfie with good lighting.</p>
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={emptyAction}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
            {emptyActionLabel}
          </motion.button>
        </motion.div>
      )}
    </>
  );

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#09090f] text-white font-sans">

      {/* ════════ PIN GATE ════════ */}
      <AnimatePresence>
        {event?.pin_enabled && !pinVerified && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-[#09090f] flex items-center justify-center p-5">
            <div aria-hidden className="fixed inset-0 pointer-events-none">
              <div className="absolute -top-[10%] left-1/4 w-[600px] h-[500px] rounded-full bg-blue-500/[0.05] blur-[80px]" />
              <div className="absolute bottom-[5%] right-[10%] w-[400px] h-[400px] rounded-full bg-violet-500/[0.04] blur-[90px]" />
            </div>
            <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-sm">
              <div className="bg-zinc-900/80 backdrop-blur-2xl border border-zinc-800 rounded-3xl p-8">
                <div className="flex justify-center mb-6">
                  <div className="relative">
                    <div className="w-[72px] h-[72px] rounded-[22px] bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Lock size={30} className="text-blue-400" strokeWidth={1.6} />
                    </div>
                    {[['top-[-4px]','left-[-4px]','border-t-2','border-l-2','rounded-tl'],
                      ['top-[-4px]','right-[-4px]','border-t-2','border-r-2','rounded-tr'],
                      ['bottom-[-4px]','left-[-4px]','border-b-2','border-l-2','rounded-bl'],
                      ['bottom-[-4px]','right-[-4px]','border-b-2','border-r-2','rounded-br']
                    ].map((cls, i) => <div key={i} className={`absolute w-3.5 h-3.5 border-blue-400 ${cls.join(' ')}`} />)}
                  </div>
                </div>
                <h1 className="text-xl font-bold text-zinc-100 text-center mb-1">Protected Event</h1>
                <p className="text-sm text-zinc-500 text-center mb-7 leading-relaxed">
                  Enter the 4-digit PIN to access<br />
                  <span className="text-zinc-400 font-medium">{event?.name || 'this event'}</span>
                </p>
                <div className="flex gap-3 justify-center mb-5">
                  {pinInput.map((digit, idx) => (
                    <input key={idx} ref={pinRefs[idx]} type={showPin ? 'text' : 'password'}
                      inputMode="numeric" maxLength={1} value={digit}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        const next = [...pinInput]; next[idx] = val.slice(-1); setPinInput(next); setPinError(null);
                        if (val && idx < 3) pinRefs[idx + 1].current?.focus();
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Backspace' && !digit && idx > 0) {
                          const next = [...pinInput]; next[idx - 1] = ''; setPinInput(next); pinRefs[idx - 1].current?.focus();
                        }
                        if (e.key === 'Enter') verifyPin();
                      }}
                      onPaste={e => {
                        e.preventDefault();
                        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
                        if (!pasted) return;
                        const next = ['', '', '', '']; pasted.split('').forEach((ch, i) => { next[i] = ch; });
                        setPinInput(next); pinRefs[Math.min(pasted.length, 3)].current?.focus();
                      }}
                      className={`w-14 h-14 text-center text-xl font-bold rounded-2xl border-2 bg-zinc-800 text-zinc-100 outline-none transition-all ${
                        pinError ? 'border-red-500/60 bg-red-500/5' : digit ? 'border-blue-500/60 bg-blue-500/5' : 'border-zinc-700 focus:border-blue-500/50 focus:bg-zinc-800/80'
                      }`} aria-label={`PIN digit ${idx + 1}`} />
                  ))}
                </div>
                <div className="flex justify-center mb-5">
                  <button onClick={() => setShowPin(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    {showPin ? <EyeOff size={13} /> : <Eye size={13} />} {showPin ? 'Hide PIN' : 'Show PIN'}
                  </button>
                </div>
                <AnimatePresence>
                  {pinError && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                      <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-400 text-xs">{pinError}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={verifyPin}
                  disabled={pinInput.join('').length < 4 || pinLoading || pinAttempts >= 5}
                  className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                  {pinLoading
                    ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={15} /></motion.div>Verifying…</>
                    : <><ShieldCheck size={15} />Access Event</>}
                </motion.button>
                <p className="text-center text-[10px] text-zinc-700 mt-5 tracking-wide">
                  Powered by <span className="text-zinc-600 font-semibold">AI · Face Recognition</span>
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Ambient glows ── */}
      <div aria-hidden className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-[15%] left-1/4 w-[700px] h-[600px] rounded-full bg-blue-500/[0.04] blur-[80px]" />
        <div className="absolute bottom-[5%] right-[5%] w-[500px] h-[500px] rounded-full bg-violet-500/[0.03] blur-[90px]" />
      </div>

      {/* ════════ HEADER ════════ */}
      <header className="fixed top-0 inset-x-0 z-50 h-[62px] bg-[#09090f]/88 backdrop-blur-2xl border-b border-zinc-800/60">
        <div className="max-w-6xl mx-auto h-full px-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0 ring-2 ring-blue-500/20">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100 leading-tight">{event?.name || 'Event Photos'}</p>
              <p className="text-[9px] font-bold tracking-widest uppercase text-zinc-500 mt-0.5">AI · Face Recognition</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'search' && (
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setMode('contribute')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-xs font-semibold text-zinc-200 transition-colors">
                <CloudUpload size={13} /> Share Photos
              </motion.button>
            )}
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowInfo(true)}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
              <Info size={15} />
            </motion.button>
          </div>
        </div>
      </header>

      {/* ════════ MAIN ════════ */}
      <main className="pt-[78px] pb-24 min-h-screen relative z-10">
        <AnimatePresence mode="wait">

          {/* ════ SEARCH MODE ════ */}
          {mode === 'search' && (
            <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }}>

              {/* ─── Hero (no result yet) ─── */}
              {!resultId && !processing && (
                <motion.section variants={stagger} initial="hidden" animate="visible"
                  className="max-w-xl mx-auto px-5 pt-16 pb-10 text-center">
                  <motion.div variants={fadeUp} className="inline-flex mb-7 relative">
                    <div className="w-[92px] h-[92px] rounded-[28px] bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Scan size={44} className="text-blue-400" strokeWidth={1.4} />
                    </div>
                    {[['top-[-4px]','left-[-4px]','border-t-2','border-l-2','rounded-tl'],
                      ['top-[-4px]','right-[-4px]','border-t-2','border-r-2','rounded-tr'],
                      ['bottom-[-4px]','left-[-4px]','border-b-2','border-l-2','rounded-bl'],
                      ['bottom-[-4px]','right-[-4px]','border-b-2','border-r-2','rounded-br'],
                    ].map((cls, i) => <div key={i} className={`absolute w-3.5 h-3.5 border-blue-400 ${cls.join(' ')}`} />)}
                  </motion.div>

                  <motion.h1 variants={fadeUp} className="text-[clamp(36px,6vw,60px)] font-bold leading-[1.08] mb-4 text-zinc-50 tracking-tight">
                    Find Yourself<br />in Every Photo
                  </motion.h1>
                  <motion.p variants={fadeUp} className="text-zinc-400 text-base leading-relaxed max-w-[430px] mx-auto mb-10">
                    Upload a selfie — AI scans every event photo and finds your matches instantly.
                  </motion.p>

                  {/* CTAs */}
                  <motion.div variants={fadeUp}
                    className={`grid gap-3 max-w-[430px] mx-auto mb-4 ${event?.upload_photo_enabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => setCameraOpen(true)}
                      className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
                      <Camera size={17} /> Take Selfie
                    </motion.button>
                    {event?.upload_photo_enabled && (
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-semibold transition-colors">
                        <Upload size={17} /> Upload Photo
                      </motion.button>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ''; }} />
                  </motion.div>

                  {/* Drag zone */}
                  <motion.div variants={fadeUp}>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                      className={`border-2 border-dashed rounded-2xl p-4 text-sm text-zinc-500 max-w-[430px] mx-auto text-center transition-colors ${dragOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-zinc-700/60'}`}>
                      or drag &amp; drop your selfie here
                    </div>
                  </motion.div>

                  {/* Browse all photos CTA */}
                  <motion.div variants={fadeUp} className="mt-8">
                    <button onClick={() => handleTabSwitch('all-photos')}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm font-medium transition-colors">
                      <Images size={15} /> Browse all {(event?.processed_count ?? event?.image_count) ? `${event?.processed_count ?? event?.image_count} ` : ''}event photos
                    </button>
                  </motion.div>

                  {/* Steps */}
                  <motion.div variants={stagger} className="grid grid-cols-3 gap-3 mt-12 max-w-[480px] mx-auto">
                    {[
                      { icon: Camera,   label: 'Snap a selfie',  n: '01' },
                      { icon: Scan,     label: 'AI scans photos', n: '02' },
                      { icon: Download, label: 'Download yours',  n: '03' },
                    ].map(({ icon: Icon, label, n }) => (
                      <motion.div key={n} variants={fadeUp}
                        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center">
                        <p className="text-[9px] font-black tracking-widest text-blue-400 mb-2.5">{n}</p>
                        <Icon size={20} className="text-blue-400 mx-auto mb-2.5" />
                        <p className="text-zinc-300 text-xs font-medium leading-snug">{label}</p>
                      </motion.div>
                    ))}
                  </motion.div>
                </motion.section>
              )}

              {/* ─── Processing ─── */}
              {processing && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="max-w-[460px] mx-auto mt-[72px] px-5">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-14 text-center">
                    <div className="relative w-[76px] h-[76px] mx-auto mb-7">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-400 border-r-blue-400/30" />
                      <div className="absolute inset-[10px] rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <Scan size={22} className="text-blue-400" />
                      </div>
                    </div>
                    <h3 className="text-zinc-100 text-2xl font-bold mb-2.5">Scanning Photos…</h3>
                    <p className="text-zinc-500 text-sm leading-relaxed">AI is finding your face across every event photo.</p>
                    <div className="mt-7 h-0.5 rounded-full bg-zinc-800 overflow-hidden">
                      <motion.div animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                        className="h-full w-1/2 rounded-full bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ─── Results (My Photos + All Photos tabs) ─── */}
              {(resultId || activeTab === 'all-photos') && !processing && (
                <motion.section id="results-section" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="max-w-6xl mx-auto px-5 pt-6">

                  {/* ── Tab bar ── */}
                  <div className="flex items-center gap-1 mb-5 p-1 bg-zinc-900 border border-zinc-800 rounded-2xl w-fit">
                    <button
                      onClick={() => setActiveTab('my-photos')}
                      disabled={!resultId}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        activeTab === 'my-photos'
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}>
                      <Scan size={14} />
                      My Photos
                      {myTab.total > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          activeTab === 'my-photos' ? 'bg-white/20 text-white' : 'bg-blue-500/15 text-blue-400'
                        }`}>{myTab.total}</span>
                      )}
                    </button>
                    <button
                      onClick={() => handleTabSwitch('all-photos')}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                        activeTab === 'all-photos'
                          ? 'bg-zinc-700 text-white'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}>
                      <Images size={14} />
                      All Photos
                      {allTab.total > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          activeTab === 'all-photos' ? 'bg-white/20 text-white' : 'bg-zinc-600 text-zinc-300'
                        }`}>{allTab.total}</span>
                      )}
                    </button>
                  </div>

                  {/* ── Shared toolbar ── */}
                  <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
                    <div>
                      <p className="text-xs text-zinc-500">
                        {activeTab === 'my-photos'
                          ? `${myTab.total} photo${myTab.total !== 1 ? 's' : ''} matched for you`
                          : `${allTab.total} photo${allTab.total !== 1 ? 's' : ''} in this event`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Multi-select (inactive trigger) */}
                      {!multiSelect.isSelectMode && (
                        <MultiSelectToolbar
                          items={activeItems}
                          selectedIds={multiSelect.selectedIds}
                          onToggle={multiSelect.toggle}
                          onSelectAll={multiSelect.selectAll}
                          onClearSelection={multiSelect.clearSelection}
                          onBatchDownload={handleBatchDownload}
                          isActive={false}
                          onActivate={multiSelect.enterSelectMode}
                          onDeactivate={multiSelect.exitSelectMode}
                        />
                      )}
                      {/* Grid layout */}
                      <div className="flex gap-0.5 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
                        {([
                          { k: 'large'       as GridLayout, icon: <Grid2X2 size={13} />,        title: 'Large'       },
                          { k: 'comfortable' as GridLayout, icon: <LayoutGrid size={13} />,      title: 'Comfortable' },
                          { k: 'compact'     as GridLayout, icon: <SlidersHorizontal size={13} />, title: 'Compact'   },
                        ]).map(({ k, icon, title }) => (
                          <button key={k} title={title} onClick={() => setGridLayout(k)}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-colors ${
                              gridLayout === k
                                ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                            }`}>
                            {icon}
                          </button>
                        ))}
                      </div>
                      {/* Download All ZIP — My Photos tab */}
                      {activeTab === 'my-photos' && myTab.total > 0 && resultId && (
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAll} disabled={dlAllLoading}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors">
                          {dlAllLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={13} /></motion.div>Preparing…</>
                            : <><PackageOpen size={13} />Download All ({myTab.total})</>}
                        </motion.button>
                      )}
                      {/* Download All ZIP — All Photos tab */}
                      {activeTab === 'all-photos' && allTab.total > 0 && (
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={handleDownloadAllTab} disabled={dlAllTabLoading}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors">
                          {dlAllTabLoading
                            ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={13} /></motion.div>Preparing…</>
                            : <><PackageOpen size={13} />Download All ({allTab.total})</>}
                        </motion.button>
                      )}
                      {/* New search */}
                      {activeTab === 'my-photos' && resultId && (
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                          onClick={() => { setResultId(null); setMyTab(emptyTab()); resetFilters(); }}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-xs font-medium transition-colors">
                          <RefreshCw size={12} /> New Search
                        </motion.button>
                      )}
                    </div>
                  </div>

                  {/* Multi-select toolbar (active state) */}
                  <AnimatePresence>
                    {multiSelect.isSelectMode && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="mb-4">
                        {batchDlLoading ? (
                          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800">
                            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                              <Loader2 size={14} className="text-blue-400" />
                            </motion.div>
                            <span className="text-xs font-medium text-zinc-300">Packaging {multiSelect.count} photos into ZIP…</span>
                          </div>
                        ) : (
                          <MultiSelectToolbar
                            items={activeItems}
                            selectedIds={multiSelect.selectedIds}
                            onToggle={multiSelect.toggle}
                            onSelectAll={multiSelect.selectAll}
                            onClearSelection={multiSelect.clearSelection}
                            onBatchDownload={handleBatchDownload}
                            isActive={true}
                            onActivate={multiSelect.enterSelectMode}
                            onDeactivate={multiSelect.exitSelectMode}
                          />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ══ MY PHOTOS TAB ══ */}
                  {activeTab === 'my-photos' && (
                    <>
                      {/* Scene filters */}
                      {Object.keys(sceneCounts).length > 0 && (
                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          className="flex gap-2 flex-wrap items-center mb-4 pb-4 border-b border-zinc-800">
                          <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-600 flex-shrink-0 mr-1">Scene</span>
                          <button onClick={resetFilters}
                            className={`${pillBase} ${activeScene === 'all' && activeObject === 'all' ? pillActive : pillInactive}`}>
                            All · {myTab.total}
                          </button>
                          {Object.entries(sceneCounts).map(([label, count]) => (
                            <button key={label}
                              onClick={() => setActiveScene(activeScene === label ? 'all' : label)}
                              className={`${pillBase} ${activeScene === label ? pillActive : pillInactive}`}>
                              {sceneIcon(label)} {label} · {count}
                            </button>
                          ))}
                        </motion.div>
                      )}
                      {/* Object filters */}
                      {Object.keys(objectCounts).length > 0 && (
                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          className="flex gap-2 flex-wrap items-center mb-4 pb-4 border-b border-zinc-800">
                          <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-600 flex-shrink-0 mr-1">Objects</span>
                          <button onClick={() => setActiveObject('all')}
                            className={`${pillBase} ${activeObject === 'all' ? pillActive : pillInactive}`}>
                            All · {myTab.total}
                          </button>
                          {Object.entries(objectCounts).map(([label, count]) => (
                            <button key={label}
                              onClick={() => setActiveObject(activeObject === label ? 'all' : label)}
                              className={`${pillBase} ${activeObject === label ? pillActive : pillInactive}`}>
                              {label} · {count}
                            </button>
                          ))}
                        </motion.div>
                      )}
                      {renderPhotoGrid(
                        filteredMyItems,
                        mySentinelRef,
                        myTab,
                        loadMoreMy,
                        activeScene !== 'all' || activeObject !== 'all' ? `No photos in "${activeScene !== 'all' ? activeScene : activeObject}"` : 'No matches found',
                        () => { if (activeScene !== 'all' || activeObject !== 'all') resetFilters(); else { setResultId(null); setMyTab(emptyTab()); } },
                        activeScene !== 'all' || activeObject !== 'all' ? 'Show all my photos' : 'Try Again',
                      )}
                    </>
                  )}

                  {/* ══ ALL PHOTOS TAB ══ */}
                  {activeTab === 'all-photos' && (
                    <>
                      {/* Scene filter for All Photos */}
                      {allScenes.length > 0 && (
                        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                          className="flex gap-2 flex-wrap items-center mb-4 pb-4 border-b border-zinc-800">
                          <span className="text-[10px] font-bold tracking-widest uppercase text-zinc-600 flex-shrink-0 mr-1">Scene</span>
                          <button onClick={() => handleAllSceneFilter('')}
                            className={`${pillBase} ${allSceneFilter === '' ? pillActive : pillInactive}`}>
                            All · {allTab.total || '…'}
                          </button>
                          {allScenes.map(({ scene_label, count }) => (
                            <button key={scene_label}
                              onClick={() => handleAllSceneFilter(allSceneFilter === scene_label ? '' : scene_label)}
                              className={`${pillBase} ${allSceneFilter === scene_label ? pillActive : pillInactive}`}>
                              {sceneIcon(scene_label)} {scene_label} · {count}
                            </button>
                          ))}
                        </motion.div>
                      )}
                      {renderPhotoGrid(
                        allTab.items,
                        allSentinelRef,
                        allTab,
                        () => loadAllPhotos(allTab.page + 1, allSceneFilter),
                        'No photos found',
                        () => handleAllSceneFilter(''),
                        'Show all photos',
                      )}
                    </>
                  )}
                </motion.section>
              )}
            </motion.div>
          )}

          {/* ════ CONTRIBUTE MODE ════ */}
          {mode === 'contribute' && (
            <motion.div key="contribute" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="max-w-lg mx-auto px-5 pt-8">
              <div className="flex items-center gap-3 mb-8">
                <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => { setMode('search'); resetContrib(); }}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
                  <ArrowLeft size={17} />
                </motion.button>
                <div>
                  <h2 className="text-xl font-bold text-zinc-100">Share Your Photos</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Help others find themselves in your shots</p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {uploadStep === 'drop' && (
                  <motion.div key="drop" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); addContribFiles(e.dataTransfer.files); }}
                      onClick={() => contribInputRef.current?.click()}
                      className={`rounded-2xl p-12 text-center cursor-pointer border-2 border-dashed transition-all ${dragOver ? 'border-blue-500/50 bg-blue-500/5' : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900/60'}`}>
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
                        <span className="text-zinc-200 font-medium">Adding to: </span>
                        {event?.name || 'This event'} · Photos are reviewed and processed for face matching.
                      </p>
                    </div>
                  </motion.div>
                )}

                {uploadStep === 'preview' && (
                  <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
                      {contribFiles.map((f, idx) => (
                        <div key={f.id} className="relative aspect-square rounded-xl overflow-hidden">
                          <img src={f.preview} alt="" className="w-full h-full object-cover" />
                          <button onClick={() => setContribFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 border border-white/10 flex items-center justify-center hover:bg-black/80 transition-colors">
                            <X size={10} className="text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => contribInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm font-medium transition-colors mb-5">
                      <Upload size={14} /> Add More Photos
                    </button>
                    <input ref={contribInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addContribFiles(e.target.files)} />
                    <div className="mb-4">
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Your name (optional)</label>
                      <input type="text" value={contribName} onChange={e => setContribName(e.target.value)}
                        placeholder="So others know who contributed"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors" />
                    </div>
                    <div className="mb-5">
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Message (optional)</label>
                      <textarea value={contribMsg} onChange={e => setContribMsg(e.target.value)}
                        placeholder="A note for the event organizer"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors resize-none min-h-[80px]" />
                    </div>
                    {contribError && (
                      <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
                        <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                        <span className="text-red-400 text-xs">{contribError}</span>
                      </div>
                    )}
                    <div className="flex gap-2.5">
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={resetContrib}
                        className="flex-1 py-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                        Cancel
                      </motion.button>
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={submitContrib}
                        className="flex-[2] py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
                        Upload {contribFiles.length} Photo{contribFiles.length !== 1 ? 's' : ''}
                      </motion.button>
                    </div>
                  </motion.div>
                )}

                {uploadStep === 'submitting' && (
                  <motion.div key="submitting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl py-14 px-6 text-center">
                    <div className="relative w-16 h-16 mx-auto mb-6">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-400 border-r-blue-400/30" />
                    </div>
                    <p className="text-zinc-100 text-lg font-semibold mb-2">Uploading your photos…</p>
                    <p className="text-zinc-500 text-sm">Please wait while we process your contribution</p>
                  </motion.div>
                )}

                {uploadStep === 'success' && (
                  <motion.div key="success" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-emerald-500/8 border border-emerald-500/20 rounded-2xl py-14 px-6 text-center">
                    <div className="w-[72px] h-[72px] rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto mb-6">
                      <Check size={34} className="text-emerald-400" />
                    </div>
                    <p className="text-zinc-100 text-xl font-bold mb-2">Thank you for sharing!</p>
                    <p className="text-zinc-500 text-sm mb-8">{uploadCount} photo{uploadCount !== 1 ? 's' : ''} uploaded successfully</p>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => { setMode('search'); resetContrib(); }}
                      className="px-7 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
                      Find Your Photos
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ════ PHOTO PREVIEW ════ */}
      <AnimatePresence>
        {previewImage && (
          <PhotoPreview
            isOpen={!!previewImage}
            onClose={() => setPreviewImage(null)}
            items={activeItems}
            currentIndex={previewIndex}
            onNavigate={handlePreviewNavigate}
            apiBaseUrl={API}
            token={token}
            showConfidence={false}
            showScene={true}
            onDownload={downloadSinglePhoto}
            watermarkConfig={watermarkConfig}
          />
        )}
      </AnimatePresence>

      {/* ════ INFO MODAL ════ */}
      <AnimatePresence>
        {showInfo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShowInfo(false)}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-5">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-full max-w-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-bold text-zinc-100">How It Works</h3>
                <button onClick={() => setShowInfo(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors">
                  <X size={13} />
                </button>
              </div>
              <ul className="space-y-4">
                {[
                  ['01', 'Upload a clear selfie with your face visible'],
                  ['02', 'Our AI scans all event photos for your face'],
                  ['03', 'Download your matched photos instantly'],
                  ['04', 'Or browse all event photos in the "All Photos" tab'],
                ].map(([n, text]) => (
                  <li key={n} className="flex items-start gap-3">
                    <span className="text-[10px] font-black text-blue-400 tracking-wider mt-0.5 flex-shrink-0">{n}</span>
                    <span className="text-zinc-400 text-sm leading-snug">{text}</span>
                  </li>
                ))}
              </ul>
              <button onClick={() => setShowInfo(false)}
                className="w-full mt-7 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors">
                Got it!
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════ CAMERA ════ */}
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