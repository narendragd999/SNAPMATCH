'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Download, Camera, Info, Scan,
  ImageIcon, RefreshCw, Sparkles,
  Loader2, X, Check, ArrowLeft,
  AlertCircle, CloudUpload, CheckCircle,
  SlidersHorizontal, PackageOpen, Grid2X2, LayoutGrid, Lock, ShieldCheck, Eye, EyeOff,
  Images, Package, User, Users,
} from 'lucide-react';
import { compressImage, hapticFeedback, Analytics, nameOf, sceneOf, objectOf } from '@/lib/snapmatch/utils';
import { useReducedMotion } from '@/hooks/snapmatch/useSnapmatch';
import { sceneIcon } from '@/components/snapmatch/UIComponents';
import { PhotoPreview } from '@/components/snapmatch/PhotoPreview';
import { MultiSelectToolbar, SelectablePhotoCard, useMultiSelect, PhotoItem as MultiSelectPhotoItem } from '@/components/snapmatch/MultiSelect';
import { CameraWithEnhancements } from '@/components/snapmatch/CameraEnhancements';
import {
  WatermarkConfig,
  DEFAULT_WATERMARK_CONFIG,
  applyWatermarkToCanvas,
} from '@/lib/snapmatch/watermark';
// 🔐 Persistence imports
import {
  StoredSelfie,
  CachedSearchResult,
  getStoredSelfie,
  saveSelfie,
  clearStoredSelfie,
  getSelfieDaysRemaining,
  storedSelfieToFile,
  getSearchCache,
  saveSearchCache,
  clearSearchCache,
  getCachedEventTokens,
  clearAllPersistenceData,
} from '@/lib/snapmatch/persistence';
import {
  SavedSelfieBanner,
  CachedResultsBanner,
  RememberSelfieCheckbox,
  AutoSearchIndicator,
  DataManagementSection,
} from '@/components/snapmatch/PersistenceUI';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhotoItem extends MultiSelectPhotoItem {
  image_name:   string;
  scene_label?: string;
  object_label?: string;
  objects?:     string[];
  similarity?:  number;
  total_faces?: number;   // Total faces detected in photo
  other_faces?: number;   // Faces other than the matched user
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
  // 🎨 Branding fields
  template_id?:         string;
  brand_logo_url?:      string;
  brand_primary_color?: string;
  brand_accent_color?:  string;
  brand_font?:          string;
  brand_footer_text?:   string;
  brand_show_powered_by?: boolean;
}

// 🎨 Branding config interface
interface BrandingConfig {
  template_id:         string;
  brand_logo_url:      string;
  brand_primary_color: string;
  brand_accent_color:  string;
  brand_font:          string;
  brand_footer_text:   string;
  brand_show_powered_by: boolean;
}

type ActiveTab    = 'my-photos' | 'all-photos' | 'with-friends';
type Mode         = 'search' | 'contribute';
type UploadStep   = 'drop' | 'preview' | 'submitting' | 'success';
type GridLayout   = 'comfortable' | 'compact' | 'large';

const emptyTab = (): TabState => ({ items: [], page: 1, total: 0, has_more: false, loading: false, error: null });

// 🎨 Default branding config
const DEFAULT_BRANDING_CONFIG: BrandingConfig = {
  template_id: 'classic',
  brand_logo_url: '',
  brand_primary_color: '#3b82f6',
  brand_accent_color: '#60a5fa',
  brand_font: 'system',
  brand_footer_text: '',
  brand_show_powered_by: true,
};

// 🎨 Template theme definitions
const TEMPLATE_THEMES: Record<string, {
  bg: string;
  surface: string;
  text: string;
  subtext: string;
  border: string;
}> = {
  classic: {
    bg: '#09090f',
    surface: '#0d0d10',
    text: '#f4f4f5',
    subtext: '#71717a',
    border: '#27272a',
  },
  minimal: {
    bg: '#fafafa',
    surface: '#ffffff',
    text: '#18181b',
    subtext: '#a1a1aa',
    border: '#e4e4e7',
  },
  wedding: {
    bg: '#1a0a10',
    surface: '#2d1119',
    text: '#fdf2f8',
    subtext: '#f9a8d4',
    border: '#4a1626',
  },
  corporate: {
    bg: '#0a0f1a',
    surface: '#0f172a',
    text: '#f8fafc',
    subtext: '#94a3b8',
    border: '#1e293b',
  },
  dark: {
    bg: '#000000',
    surface: '#0a0a0a',
    text: '#ffffff',
    subtext: '#a855f7',
    border: '#1a1a1a',
  },
};

// 🎨 Font family mappings
const FONT_FAMILIES: Record<string, string> = {
  system: 'system-ui, -apple-system, sans-serif',
  playfair: "'Playfair Display', serif",
  'dm-serif': "'DM Serif Display', serif",
  cormorant: "'Cormorant Garamond', serif",
  syne: "'Syne', sans-serif",
  outfit: "'Outfit', sans-serif",
  josefin: "'Josefin Sans', sans-serif",
  mono: "'JetBrains Mono', monospace",
};

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
  const [friendsTab,   setFriendsTab]  = useState<TabState>(emptyTab()); // 👥 With Friends tab
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

  // 🔔 Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Show toast helper with auto-dismiss
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 🎨 Branding state
  const [brandingConfig, setBrandingConfig] = useState<BrandingConfig>(DEFAULT_BRANDING_CONFIG);

  // 🔐 Persistence state
  const [storedSelfie, setStoredSelfie] = useState<StoredSelfie | null>(null);
  const [cachedResults, setCachedResults] = useState<CachedSearchResult | null>(null);
  const [autoSearching, setAutoSearching] = useState(false);
  const [rememberSelfie, setRememberSelfie] = useState(true);
  const [cacheAge, setCacheAge] = useState<number | null>(null);

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
  const friendsSentinelRef = useRef<HTMLDivElement>(null); // 👥 Friends tab sentinel
  const myObserverRef  = useRef<IntersectionObserver | null>(null);
  const allObserverRef = useRef<IntersectionObserver | null>(null);
  const friendsObserverRef = useRef<IntersectionObserver | null>(null); // 👥 Friends tab observer
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const contribInputRef = useRef<HTMLInputElement>(null);

  // ── Multi-select (shares whichever tab is active) ──
  const activeItems   = activeTab === 'my-photos' ? myTab.items 
                      : activeTab === 'with-friends' ? friendsTab.items 
                      : allTab.items;
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
        // 🎨 Set branding config
        setBrandingConfig({
          template_id: data.template_id || 'classic',
          brand_logo_url: data.brand_logo_url || '',
          brand_primary_color: data.brand_primary_color || '#3b82f6',
          brand_accent_color: data.brand_accent_color || '#60a5fa',
          brand_font: data.brand_font || 'system',
          brand_footer_text: data.brand_footer_text || '',
          brand_show_powered_by: data.brand_show_powered_by !== false,
        });
      })
      .catch(console.error);
  }, [token, API]);

  // 🎨 Inject CSS variables when branding changes
  useEffect(() => {
    const theme = TEMPLATE_THEMES[brandingConfig.template_id] || TEMPLATE_THEMES.classic;
    const root = document.documentElement;

    // Primary/accent colors
    root.style.setProperty('--brand-primary', brandingConfig.brand_primary_color);
    root.style.setProperty('--brand-accent', brandingConfig.brand_accent_color);

    // Template theme colors
    root.style.setProperty('--brand-bg', theme.bg);
    root.style.setProperty('--brand-surface', theme.surface);
    root.style.setProperty('--brand-text', theme.text);
    root.style.setProperty('--brand-subtext', theme.subtext);
    root.style.setProperty('--brand-border', theme.border);

    // Font family
    const fontFamily = FONT_FAMILIES[brandingConfig.brand_font] || FONT_FAMILIES.system;
    root.style.setProperty('--brand-font', fontFamily);

    return () => {
      // Cleanup on unmount
      root.style.removeProperty('--brand-primary');
      root.style.removeProperty('--brand-accent');
      root.style.removeProperty('--brand-bg');
      root.style.removeProperty('--brand-surface');
      root.style.removeProperty('--brand-text');
      root.style.removeProperty('--brand-subtext');
      root.style.removeProperty('--brand-border');
      root.style.removeProperty('--brand-font');
    };
  }, [brandingConfig]);

  // 🎨 Load Google Fonts if custom font selected
  useEffect(() => {
    const font = brandingConfig.brand_font;
    if (font && font !== 'system' && font !== 'mono') {
      const fontMap: Record<string, string> = {
        'playfair': 'Playfair+Display:wght@400;500;600;700',
        'dm-serif': 'DM+Serif+Display:wght@400;500;600;700',
        'cormorant': 'Cormorant+Garamond:wght@400;500;600;700',
        'syne': 'Syne:wght@400;500;600;700',
        'outfit': 'Outfit:wght@400;500;600;700',
        'josefin': 'Josefin+Sans:wght@400;500;600;700',
      };

      const href = `https://fonts.googleapis.com/css2?family=${fontMap[font]}&display=swap`;

      // Check if already loaded
      if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      }
    }
  }, [brandingConfig.brand_font]);

  // 🔐 Persistence: Check for stored selfie and cached results on mount
  useEffect(() => {
    if (!token) return;
    
    // Check for stored selfie
    const selfie = getStoredSelfie();
    setStoredSelfie(selfie);
    
    // Check for cached results for this event
    const cached = getSearchCache(token, event?.pin_version);
    if (cached) {
      setCachedResults(cached);
      setCacheAge(Date.now() - cached.cachedAt);
    }
  }, [token, event?.pin_version]);

  // 🔐 Persistence: Auto-search with stored selfie if no cache exists
  useEffect(() => {
    // Only run if: PIN verified, event loaded, no results yet, stored selfie exists, no cache, not already searching
    if (!pinVerified || !token || !event || resultId || processing || autoSearching) return;
    if (!storedSelfie) return;
    if (cachedResults) return; // Cache exists, don't auto-search
    
    const performAutoSearch = async () => {
      setAutoSearching(true);
      try {
        const file = await storedSelfieToFile(storedSelfie);
        let f = file;
        if (file.size > 1024 * 1024) f = await compressImage(file, { maxWidth: 1920, quality: 0.85 });
        const form = new FormData(); form.append('file', f);
        const res = await fetch(`${API}/public/events/${token}/search`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        
        setResultId(data.result_id);
        setMyTab({ items: data.you.items, page: 1, total: data.you.total, has_more: data.you.has_more, loading: false, error: null });
        
        // 👥 Set friends tab data (Group/Family Detection)
        if (data.friends && data.friends.total > 0) {
          setFriendsTab({ 
            items: data.friends.items.map((item: any) => ({ 
              ...item, 
              image_name: item.image_name 
            })), 
            page: 1, 
            total: data.friends.total, 
            has_more: data.friends.has_more, 
            loading: false, 
            error: null 
          });
        }
        
        setActiveTab('my-photos');
        
        // Cache the results (including friends photos)
        saveSearchCache(
          token, 
          data.result_id, 
          data.you.items, 
          data.you.total, 
          data.you.has_more, 
          storedSelfie.thumbnailBase64, 
          event.pin_version || undefined,
          // 👥 Friends photos cache
          data.friends?.items || [],
          data.friends?.total || 0,
          data.friends?.has_more || false
        );
        
        Analytics.selfieUploaded('auto');
      } catch (err) {
        console.error('[Persistence] Auto-search failed:', err);
        // Don't show error to user, just fall back to normal flow
      } finally {
        setAutoSearching(false);
      }
    };
    
    // Small delay to let the UI render first
    const timer = setTimeout(performAutoSearch, 500);
    return () => clearTimeout(timer);
  }, [pinVerified, token, event, storedSelfie, cachedResults, resultId, processing, autoSearching, API]);

  // 🔐 Persistence: Load cached results if available
  useEffect(() => {
    if (!cachedResults || resultId || processing) return;
    
    // Restore from cache
    setResultId(cachedResults.resultId);
    setMyTab({ items: cachedResults.items, page: 1, total: cachedResults.total, has_more: cachedResults.hasMore, loading: false, error: null });
    
    // 👥 Restore friends tab from cache
    if (cachedResults.friendsItems && cachedResults.friendsTotal && cachedResults.friendsTotal > 0) {
      setFriendsTab({ 
        items: cachedResults.friendsItems, 
        page: 1, 
        total: cachedResults.friendsTotal, 
        has_more: cachedResults.friendsHasMore || false, 
        loading: false, 
        error: null 
      });
    }
    
    setActiveTab('my-photos');
    setCacheAge(Date.now() - cachedResults.cachedAt);
  }, [cachedResults, resultId, processing]);

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
  const handleUpload = useCallback(async (file: File, saveSelfieFlag?: boolean) => {
    setProcessing(true); setResultId(null); setMyTab(emptyTab()); setFriendsTab(emptyTab()); resetFilters();
    setCachedResults(null); // Clear cache when doing new search
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
      
      // 👥 Set friends tab data (Group/Family Detection)
      if (data.friends && data.friends.total > 0) {
        setFriendsTab({ 
          items: data.friends.items.map((item: any) => ({ 
            ...item, 
            image_name: item.image_name 
          })), 
          page: 1, 
          total: data.friends.total, 
          has_more: data.friends.has_more, 
          loading: false, 
          error: null 
        });
      }
      
      setActiveTab('my-photos');
      
      // 🔐 Persistence: Save selfie if requested
      const shouldSaveSelfie = saveSelfieFlag ?? rememberSelfie;
      if (shouldSaveSelfie) {
        const saved = await saveSelfie(file);
        if (saved) {
          const selfie = getStoredSelfie();
          setStoredSelfie(selfie);
          
          // Cache the results with selfie preview (including friends photos)
          if (selfie) {
            saveSearchCache(
              token, 
              data.result_id, 
              data.you.items, 
              data.you.total, 
              data.you.has_more, 
              selfie.thumbnailBase64, 
              event?.pin_version || undefined,
              // 👥 Friends photos cache
              data.friends?.items || [],
              data.friends?.total || 0,
              data.friends?.has_more || false
            );
            setCacheAge(0);
          }
        }
      }
      
      setTimeout(() => document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' }), 300);
    } catch (err) { console.error(err); }
    finally { setProcessing(false); }
  }, [token, API, resetFilters, rememberSelfie, event?.pin_version]);

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

  // 👥 ── Load more Friends Photos ──
  const loadMoreFriends = useCallback(async () => {
    if (!resultId || friendsTab.loading || !friendsTab.has_more) return;
    const nextPage = friendsTab.page + 1;
    setFriendsTab(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`${API}/public/events/${token}/search/${resultId}?kind=friends&page=${nextPage}`);
      if (res.status === 404) { setFriendsTab(prev => ({ ...prev, loading: false, has_more: false, error: 'Session expired.' })); return; }
      if (!res.ok) throw new Error();
      const data: PageData = await res.json();
      setFriendsTab(prev => ({ items: [...prev.items, ...data.items], page: data.page, total: data.total, has_more: data.has_more, loading: false, error: null }));
    } catch { setFriendsTab(prev => ({ ...prev, loading: false, error: 'Failed to load more.' })); }
  }, [friendsTab, resultId, token, API]);

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

  // ── Infinite scroll observers with refs to avoid stale closures ──
  // Store latest callbacks in refs so observer always calls current version
  const loadMoreMyRef = useRef(loadMoreMy);
  const loadMoreAllRef = useRef(loadMoreAll);
  const loadMoreFriendsRef = useRef(loadMoreFriends);
  
  useEffect(() => { loadMoreMyRef.current = loadMoreMy; }, [loadMoreMy]);
  useEffect(() => { loadMoreAllRef.current = loadMoreAll; }, [loadMoreAll]);
  useEffect(() => { loadMoreFriendsRef.current = loadMoreFriends; }, [loadMoreFriends]);

  // My Photos observer - only active when on my-photos tab and has results
  useEffect(() => {
    // Only set up observer when this tab is active and we have results
    if (activeTab !== 'my-photos' || !resultId) {
      myObserverRef.current?.disconnect();
      return;
    }
    
    myObserverRef.current?.disconnect();
    myObserverRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreMyRef.current(); },
      { rootMargin: '400px' }
    );
    // Small delay to ensure sentinel is in DOM
    const timer = setTimeout(() => {
      if (mySentinelRef.current && myObserverRef.current) {
        myObserverRef.current.observe(mySentinelRef.current);
      }
    }, 100);
    return () => { clearTimeout(timer); myObserverRef.current?.disconnect(); };
  }, [resultId, activeTab]);

  // All Photos observer - only active when on all-photos tab
  useEffect(() => {
    // Only set up observer when this tab is active
    if (activeTab !== 'all-photos') {
      allObserverRef.current?.disconnect();
      return;
    }
    
    allObserverRef.current?.disconnect();
    allObserverRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreAllRef.current(); },
      { rootMargin: '400px' }
    );
    const timer = setTimeout(() => {
      if (allSentinelRef.current && allObserverRef.current) {
        allObserverRef.current.observe(allSentinelRef.current);
      }
    }, 100);
    return () => { clearTimeout(timer); allObserverRef.current?.disconnect(); };
  }, [activeTab, allTab.items.length]);

  // 👥 Friends tab infinite scroll observer - only active when on with-friends tab
  useEffect(() => {
    // Only set up observer when this tab is active and we have results
    if (activeTab !== 'with-friends' || !resultId) {
      friendsObserverRef.current?.disconnect();
      return;
    }
    
    friendsObserverRef.current?.disconnect();
    friendsObserverRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreFriendsRef.current(); },
      { rootMargin: '400px' }
    );
    const timer = setTimeout(() => {
      if (friendsSentinelRef.current && friendsObserverRef.current) {
        friendsObserverRef.current.observe(friendsSentinelRef.current);
      }
    }, 100);
    return () => { clearTimeout(timer); friendsObserverRef.current?.disconnect(); };
  }, [resultId, activeTab, friendsTab.items.length]);

  // ── Helper: Apply watermark to a blob and return watermarked blob ──
  const applyWatermarkToBlob = useCallback(async (blob: Blob): Promise<Blob> => {
    if (!watermarkConfig.enabled) return blob;
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const url = URL.createObjectURL(blob);
      
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(blob);
            return;
          }
          ctx.drawImage(img, 0, 0);
          await applyWatermarkToCanvas(canvas, watermarkConfig);
          canvas.toBlob(
            (watermarkedBlob) => {
              URL.revokeObjectURL(url);
              if (watermarkedBlob) {
                resolve(watermarkedBlob);
              } else {
                resolve(blob);
              }
            },
            'image/jpeg',
            0.95
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          resolve(blob);
        }
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(blob);
      };
      
      img.src = url;
    });
  }, [watermarkConfig]);

  // ── Download single with watermark ──
  const downloadSinglePhoto = useCallback(async (imageName: string) => {
    try {
      const res = await fetch(`${API}/public/events/${token}/photo/${imageName}`);
      if (!res.ok) throw new Error();
      let blob = await res.blob();
      
      // Apply watermark if enabled
      blob = await applyWatermarkToBlob(blob);
      
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = imageName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
      hapticFeedback('success');
    } catch { hapticFeedback('error'); }
  }, [token, API, applyWatermarkToBlob]);

  // ── Download all matched as ZIP (with watermark) ──
  const handleDownloadAll = useCallback(async () => {
    if (!resultId || dlAllLoading) return;
    setDlAllLoading(true); hapticFeedback('medium');
    try {
      // Fetch all matched photos with pagination
      const allPhotos: { name: string; blob: Blob }[] = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        const res = await fetch(`${API}/public/events/${token}/search/${resultId}?kind=you&page=${page}&page_size=50`);
        if (res.status === 404) break;
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
          // Fetch each photo and apply watermark
          const photoPromises = data.items.map(async (item: PhotoItem) => {
            const imgName = nameOf(item);
            try {
              const photoRes = await fetch(`${API}/public/events/${token}/photo/${imgName}`);
              if (!photoRes.ok) return null;
              let blob = await photoRes.blob();
              blob = await applyWatermarkToBlob(blob);
              return { name: imgName, blob };
            } catch {
              return null;
            }
          });
          
          const results = await Promise.allSettled(photoPromises);
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value && result.value.blob.size > 0) {
              allPhotos.push(result.value);
            }
          }
        }
        
        hasMore = data.has_more;
        page++;
      }
      
      if (allPhotos.length === 0) throw new Error('No photos found');
      
      // Create ZIP
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const { name, blob } of allPhotos) {
        zip.file(name, blob);
      }
      
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      const url = URL.createObjectURL(zipBlob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${event?.name || 'event'}-photos.zip` });
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${allPhotos.length} photos successfully!`, 'success');
      hapticFeedback('success');
    } catch { showToast('Download failed. Please try again.', 'error'); hapticFeedback('error'); }
    finally { setDlAllLoading(false); }
  }, [resultId, dlAllLoading, token, API, event, applyWatermarkToBlob, showToast]);

  // ── Download all event photos as ZIP (All Photos tab) with watermark ──
  const handleDownloadAllTab = useCallback(async () => {
    if (dlAllTabLoading) return;
    setDlAllTabLoading(true); hapticFeedback('medium');
    try {
      // Fetch all event photos with pagination
      const allPhotos: { name: string; blob: Blob }[] = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        const params = new URLSearchParams({ page: String(page), page_size: '50' });
        const res = await fetch(`${API}/public/events/${token}/photos?${params}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
          // Fetch each photo and apply watermark
          const photoPromises = data.items.map(async (item: PhotoItem) => {
            const imgName = nameOf(item);
            try {
              const photoRes = await fetch(`${API}/public/events/${token}/photo/${imgName}`);
              if (!photoRes.ok) return null;
              let blob = await photoRes.blob();
              blob = await applyWatermarkToBlob(blob);
              return { name: imgName, blob };
            } catch {
              return null;
            }
          });
          
          const results = await Promise.allSettled(photoPromises);
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value && result.value.blob.size > 0) {
              allPhotos.push(result.value);
            }
          }
        }
        
        hasMore = data.has_more;
        page++;
        
        // Safety limit
        if (page > 100) break;
      }
      
      if (allPhotos.length === 0) throw new Error('No photos found');
      
      // Create ZIP
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const { name, blob } of allPhotos) {
        zip.file(name, blob);
      }
      
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      const url = URL.createObjectURL(zipBlob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${event?.name || 'event'}-all-photos.zip` });
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${allPhotos.length} photos successfully!`, 'success');
      hapticFeedback('success');
    } catch { showToast('Download failed. Please try again.', 'error'); hapticFeedback('error'); }
    finally { setDlAllTabLoading(false); }
  }, [dlAllTabLoading, token, API, event, applyWatermarkToBlob, showToast]);

  // ── Batch download selected → concurrent fetch → client-side ZIP (with watermark) ──
  const handleBatchDownload = useCallback(async () => {
    if (multiSelect.count === 0 || batchDlLoading) return;
    const downloadCount = multiSelect.count;
    setBatchDlLoading(true); hapticFeedback('medium');
    try {
      const results = await Promise.allSettled(
        multiSelect.selectionOrder.map(async (imageName) => {
          const probe = await fetch(`${API}/public/events/${token}/photo/${imageName}`, {
            redirect: 'follow',
          });
          
          let blob: Blob;
          if (probe.ok && probe.url === `${API}/public/events/${token}/photo/${imageName}`) {
            blob = await probe.blob();
          } else {
            const finalUrl = probe.url || `${API}/public/events/${token}/photo/${imageName}`;
            const res2 = await fetch(finalUrl, { mode: 'cors' });
            if (!res2.ok) throw new Error(`${res2.status}`);
            blob = await res2.blob();
          }
          
          // Apply watermark to each photo
          blob = await applyWatermarkToBlob(blob);
          
          return { name: imageName, blob };
        })
      );
      
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let added = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.blob.size > 0) {
          zip.file(result.value.name, result.value.blob);
          added++;
        }
      }
      if (added === 0) throw new Error('No photos could be fetched');
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      const url = URL.createObjectURL(zipBlob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${event?.name || 'selected'}-photos.zip`,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // ✅ Success: Show toast and clear selection
      showToast(`Downloaded ${added} photo${added !== 1 ? 's' : ''} successfully!`, 'success');
      hapticFeedback('success');
      multiSelect.exitSelectMode();
    } catch {
      showToast('Download failed. Please try again.', 'error');
      hapticFeedback('error');
    }
    finally { setBatchDlLoading(false); }
  }, [multiSelect, batchDlLoading, token, API, event, applyWatermarkToBlob, showToast]);

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

  // 🔐 Persistence helper functions
  const handleUseDifferentSelfie = useCallback(() => {
    clearStoredSelfie();
    setStoredSelfie(null);
    clearSearchCache(token);
    setCachedResults(null);
    setResultId(null);
    setMyTab(emptyTab());
    setCacheAge(null);
  }, [token]);

  const handleRefreshResults = useCallback(async () => {
    if (!storedSelfie) return;
    setCachedResults(null);
    setResultId(null);
    setMyTab(emptyTab());
    setProcessing(true);
    
    try {
      const file = await storedSelfieToFile(storedSelfie);
      await handleUpload(file, false);
    } catch (err) {
      console.error('[Persistence] Refresh failed:', err);
    } finally {
      setProcessing(false);
    }
  }, [storedSelfie, handleUpload]);

  const handleClearSelfie = useCallback(() => {
    clearStoredSelfie();
    setStoredSelfie(null);
  }, []);

  const handleClearCache = useCallback(() => {
    clearSearchCache(token);
    setCachedResults(null);
    setCacheAge(null);
  }, [token]);

  const handleClearAllData = useCallback(() => {
    clearAllPersistenceData();
    setStoredSelfie(null);
    setCachedResults(null);
    setCacheAge(null);
  }, []);

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

  // 🎨 Get theme colors for current template
  const theme = TEMPLATE_THEMES[brandingConfig.template_id] || TEMPLATE_THEMES.classic;

  const pillBase     = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-colors whitespace-nowrap capitalize';
  const pillInactive = 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200';
  const pillActive   = 'bg-blue-500/10 border-blue-500/30 text-blue-400';

  // ── Shared photo grid renderer ──────────────────────────────────────────────
  const renderPhotoGrid = (
    items:       PhotoItem[],
    sentinelRef: React.RefObject<HTMLDivElement | null>,
    tabState:    TabState,
    onRetry:     () => void,
    emptyMsg:    string,
    emptyAction: () => void,
    emptyActionLabel: string,
    showGroupBadge: boolean = false,  // Show "+N" badge for group photos
  ) => (
    <>
      {/* Loading state - show spinner while initially loading */}
      {items.length === 0 && tabState.loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
            <Loader2 size={28} className="text-blue-400" />
          </motion.div>
          <p className="text-sm text-zinc-500">Loading photos…</p>
        </div>
      )}
      
      {/* Empty state - show when no items and not loading */}
      {items.length === 0 && !tabState.loading && (
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
            className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors"
            style={{ background: 'var(--brand-primary, #3b82f6)' }}>
            {emptyActionLabel}
          </motion.button>
        </motion.div>
      )}
      
      {/* Grid with items - always render sentinel for infinite scroll */}
      {items.length > 0 && (
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
                showGroupBadge={showGroupBadge}
              />
            );
          })}
        </div>
      )}
      
      {/* Sentinel for infinite scroll - always rendered when tab has items or is loading */}
      {(items.length > 0 || tabState.loading) && (
        <>
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
      )}
    </>
  );

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen text-white font-sans"
      style={{
        background: 'var(--brand-bg, #09090f)',
        fontFamily: 'var(--brand-font, system-ui, sans-serif)',
        color: 'var(--brand-text, #ffffff)',
      }}
    >

      {/* ════════ PIN GATE ════════ */}
      <AnimatePresence>
        {event?.pin_enabled && !pinVerified && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-5"
            style={{ background: 'var(--brand-bg, #09090f)' }}>
            <div aria-hidden className="fixed inset-0 pointer-events-none">
              <div className="absolute -top-[10%] left-1/4 w-[600px] h-[500px] rounded-full blur-[80px]"
                style={{ background: `${brandingConfig.brand_primary_color}10` }} />
              <div className="absolute bottom-[5%] right-[10%] w-[400px] h-[400px] rounded-full blur-[90px]"
                style={{ background: `${brandingConfig.brand_accent_color}08` }} />
            </div>
            <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-sm">
              <div className="backdrop-blur-2xl border rounded-3xl p-8"
                style={{
                  background: `${theme.surface}cc`,
                  borderColor: 'var(--brand-border, #27272a)',
                }}>
                <div className="flex justify-center mb-6">
                  <div className="relative">
                    <div className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
                      style={{
                        background: `${brandingConfig.brand_primary_color}15`,
                        border: `1px solid ${brandingConfig.brand_primary_color}30`,
                      }}>
                      <Lock size={30} style={{ color: brandingConfig.brand_primary_color }} strokeWidth={1.6} />
                    </div>
                    {[['top-[-4px]','left-[-4px]','border-t-2','border-l-2','rounded-tl'],
                      ['top-[-4px]','right-[-4px]','border-t-2','border-r-2','rounded-tr'],
                      ['bottom-[-4px]','left-[-4px]','border-b-2','border-l-2','rounded-bl'],
                      ['bottom-[-4px]','right-[-4px]','border-b-2','border-r-2','rounded-br']
                    ].map((cls, i) => <div key={i} className={`absolute w-3.5 h-3.5 ${cls.join(' ')}`}
                      style={{ borderColor: brandingConfig.brand_primary_color }} />)}
                  </div>
                </div>
                <h1 className="text-xl font-bold text-center mb-1" style={{ color: 'var(--brand-text, #f4f4f5)' }}>Protected Event</h1>
                <p className="text-sm text-center mb-7 leading-relaxed" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                  Enter the 4-digit PIN to access<br />
                  <span className="font-medium" style={{ color: 'var(--brand-text, #f4f4f5)' }}>{event?.name || 'this event'}</span>
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
                      className={`w-14 h-14 text-center text-xl font-bold rounded-2xl border-2 outline-none transition-all`}
                      style={{
                        background: pinError ? `${brandingConfig.brand_primary_color}10` : digit ? `${brandingConfig.brand_primary_color}10` : 'var(--brand-surface, #18181b)',
                        borderColor: pinError ? '#ef444480' : digit ? `${brandingConfig.brand_primary_color}80` : 'var(--brand-border, #27272a)',
                        color: 'var(--brand-text, #f4f4f5)',
                      }}
                      aria-label={`PIN digit ${idx + 1}`} />
                  ))}
                </div>
                <div className="flex justify-center mb-5">
                  <button onClick={() => setShowPin(v => !v)}
                    className="flex items-center gap-1.5 text-xs transition-colors"
                    style={{ color: 'var(--brand-subtext, #71717a)' }}>
                    {showPin ? <EyeOff size={13} /> : <Eye size={13} />} {showPin ? 'Hide PIN' : 'Show PIN'}
                  </button>
                </div>
                <AnimatePresence>
                  {pinError && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border mb-4"
                      style={{ background: '#ef444410', borderColor: '#ef444430' }}>
                      <AlertCircle size={13} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-400 text-xs">{pinError}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} onClick={verifyPin}
                  disabled={pinInput.join('').length < 4 || pinLoading || pinAttempts >= 5}
                  className="w-full py-3.5 rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  style={{ background: 'var(--brand-primary, #3b82f6)' }}>
                  {pinLoading
                    ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={15} /></motion.div>Verifying…</>
                    : <><ShieldCheck size={15} />Access Event</>}
                </motion.button>
                <p className="text-center text-[10px] mt-5 tracking-wide" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                  Powered by <span className="font-semibold" style={{ color: brandingConfig.brand_accent_color }}>AI · Face Recognition</span>
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Ambient glows ── */}
      <div aria-hidden className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-[15%] left-1/4 w-[700px] h-[600px] rounded-full blur-[80px]"
          style={{ background: `${brandingConfig.brand_primary_color}08` }} />
        <div className="absolute bottom-[5%] right-[5%] w-[500px] h-[500px] rounded-full blur-[90px]"
          style={{ background: `${brandingConfig.brand_accent_color}06` }} />
      </div>

      {/* ════════ HEADER ════════ */}
      <header className="fixed top-0 inset-x-0 z-50 h-[62px] backdrop-blur-2xl border-b"
        style={{
          background: 'color-mix(in srgb, var(--brand-bg, #09090f) 88%, transparent)',
          borderColor: 'var(--brand-border, #27272a)',
        }}>
        <div className="max-w-6xl mx-auto h-full px-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 🎨 Logo or default icon */}
            {brandingConfig.brand_logo_url ? (
              <img
                src={brandingConfig.brand_logo_url}
                alt="Logo"
                className="w-9 h-9 rounded-xl object-contain"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              />
            ) : (
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ring-2"
                style={{
                  background: `${brandingConfig.brand_primary_color}20`,
                  borderColor: `${brandingConfig.brand_primary_color}30`,
                }}>
                <Sparkles size={16} style={{ color: brandingConfig.brand_primary_color }} />
              </div>
            )}
            <div>
              <p className="text-sm font-semibold leading-tight" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                {event?.name || 'Event Photos'}
              </p>
              <p className="text-[9px] font-bold tracking-widest uppercase mt-0.5" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                AI · Face Recognition
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'search' && (
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => setMode('contribute')}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors"
                style={{
                  background: 'var(--brand-surface, #18181b)',
                  borderColor: 'var(--brand-border, #27272a)',
                  color: 'var(--brand-text, #f4f4f5)',
                }}>
                <CloudUpload size={13} /> Share Photos
              </motion.button>
            )}
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={() => setShowInfo(true)}
              className="w-9 h-9 flex items-center justify-center rounded-xl border transition-colors"
              style={{
                background: 'var(--brand-surface, #18181b)',
                borderColor: 'var(--brand-border, #27272a)',
                color: 'var(--brand-subtext, #71717a)',
              }}>
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
              {!resultId && !processing && !autoSearching && (
                <motion.section variants={stagger} initial="hidden" animate="visible"
                  className="max-w-xl mx-auto px-5 pt-16 pb-10 text-center">
                  
                  {/* 🔐 Saved Selfie Banner */}
                  {storedSelfie && (
                    <motion.div variants={fadeUp} className="mb-6">
                      <SavedSelfieBanner
                        selfie={storedSelfie}
                        onUseDifferent={handleUseDifferentSelfie}
                        onClear={handleClearSelfie}
                        primaryColor={brandingConfig.brand_primary_color}
                      />
                    </motion.div>
                  )}
                  
                  <motion.div variants={fadeUp} className="inline-flex mb-7 relative">
                    <div className="w-[92px] h-[92px] rounded-[28px] flex items-center justify-center"
                      style={{
                        background: `${brandingConfig.brand_primary_color}15`,
                        border: `1px solid ${brandingConfig.brand_primary_color}25`,
                      }}>
                      <Scan size={44} style={{ color: brandingConfig.brand_primary_color }} strokeWidth={1.4} />
                    </div>
                    {[['top-[-4px]','left-[-4px]','border-t-2','border-l-2','rounded-tl'],
                      ['top-[-4px]','right-[-4px]','border-t-2','border-r-2','rounded-tr'],
                      ['bottom-[-4px]','left-[-4px]','border-b-2','border-l-2','rounded-bl'],
                      ['bottom-[-4px]','right-[-4px]','border-b-2','border-r-2','rounded-br'],
                    ].map((cls, i) => <div key={i} className={`absolute w-3.5 h-3.5 ${cls.join(' ')}`}
                      style={{ borderColor: brandingConfig.brand_primary_color }} />)}
                  </motion.div>

                  <motion.h1 variants={fadeUp} className="text-[clamp(36px,6vw,60px)] font-bold leading-[1.08] mb-4 tracking-tight"
                    style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                    Find Yourself<br />in Every Photo
                  </motion.h1>
                  <motion.p variants={fadeUp} className="text-base leading-relaxed max-w-[430px] mx-auto mb-10"
                    style={{ color: 'var(--brand-subtext, #71717a)' }}>
                    Upload a selfie — AI scans every event photo and finds your matches instantly.
                  </motion.p>

                  {/* CTAs */}
                  <motion.div variants={fadeUp}
                    className={`grid gap-3 max-w-[430px] mx-auto mb-4 ${event?.upload_photo_enabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      onClick={() => setCameraOpen(true)}
                      className="flex items-center justify-center gap-2 py-4 rounded-2xl text-white text-sm font-semibold transition-colors"
                      style={{ background: 'var(--brand-primary, #3b82f6)' }}>
                      <Camera size={17} /> Take Selfie
                    </motion.button>
                    {event?.upload_photo_enabled && (
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center justify-center gap-2 py-4 rounded-2xl border text-sm font-semibold transition-colors"
                        style={{
                          background: 'var(--brand-surface, #18181b)',
                          borderColor: 'var(--brand-border, #27272a)',
                          color: 'var(--brand-text, #f4f4f5)',
                        }}>
                        <Upload size={17} /> Upload Photo
                      </motion.button>
                    )}
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ''; }} />
                  </motion.div>

                  {/* 🔐 Remember Selfie Checkbox */}
                  <motion.div variants={fadeUp} className="max-w-[430px] mx-auto mb-4">
                    <div className="p-3 rounded-xl border" style={{ background: 'var(--brand-surface, #18181b)', borderColor: 'var(--brand-border, #27272a)' }}>
                      <RememberSelfieCheckbox
                        checked={rememberSelfie}
                        onChange={setRememberSelfie}
                        primaryColor={brandingConfig.brand_primary_color}
                      />
                    </div>
                  </motion.div>

                  {/* Drag zone */}
                  <motion.div variants={fadeUp}>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                      className={`border-2 border-dashed rounded-2xl p-4 text-sm max-w-[430px] mx-auto text-center transition-colors`}
                      style={{
                        borderColor: dragOver ? `${brandingConfig.brand_primary_color}60` : 'var(--brand-border, #27272a)',
                        background: dragOver ? `${brandingConfig.brand_primary_color}08` : 'transparent',
                        color: 'var(--brand-subtext, #71717a)',
                      }}>
                      or drag &amp; drop your selfie here
                    </div>
                  </motion.div>

                </motion.section>
              )}

              {/* 🔐 Auto-Search Indicator */}
              {autoSearching && (
                <AutoSearchIndicator primaryColor={brandingConfig.brand_primary_color} />
              )}

              {/* ─── Processing state ─── */}
              {processing && (
                <motion.div key="processing" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="max-w-md mx-auto px-5 py-20 text-center">
                  <div className="relative w-20 h-20 mx-auto mb-8">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                      className="absolute inset-0 rounded-full border-2 border-transparent"
                      style={{
                        borderTopColor: brandingConfig.brand_primary_color,
                        borderRightColor: `${brandingConfig.brand_primary_color}40`,
                      }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Scan size={28} style={{ color: brandingConfig.brand_primary_color }} />
                    </div>
                  </div>
                  <p className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                    Scanning photos…
                  </p>
                  <p className="text-sm" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                    AI is finding your matches
                  </p>
                </motion.div>
              )}

              {/* ─── Results section ─── */}
              {resultId && !processing && (
                <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {/* Tabs */}
                  <div className="sticky top-[62px] z-30 backdrop-blur-xl border-b"
                    style={{
                      background: 'color-mix(in srgb, var(--brand-bg, #09090f) 92%, transparent)',
                      borderColor: 'var(--brand-border, #27272a)',
                    }}>
                    <div className="max-w-6xl mx-auto px-5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleTabSwitch('my-photos')}
                          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'my-photos' ? '' : 'border-transparent'
                          }`}
                          style={{
                            color: activeTab === 'my-photos' ? 'var(--brand-primary, #3b82f6)' : 'var(--brand-subtext, #71717a)',
                            borderColor: activeTab === 'my-photos' ? 'var(--brand-primary, #3b82f6)' : 'transparent',
                          }}>
                          <Scan size={14} /> 
                          <span>My Photos</span>
                          <span className="text-xs opacity-75">({myTab.total})</span>
                        </button>
                        {/* 👥 With Friends tab - show if user has any photos (even if 0 group photos) */}
                        {myTab.total > 0 && (
                          <button onClick={() => handleTabSwitch('with-friends')}
                            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                              activeTab === 'with-friends' ? '' : 'border-transparent'
                            }`}
                            style={{
                              color: activeTab === 'with-friends' ? 'var(--brand-primary, #3b82f6)' : 'var(--brand-subtext, #71717a)',
                              borderColor: activeTab === 'with-friends' ? 'var(--brand-primary, #3b82f6)' : 'transparent',
                            }}>
                            <Users size={14} /> 
                            <span>With Friends</span>
                            <span className="text-xs opacity-75">({friendsTab.total})</span>
                          </button>
                        )}
                        <button onClick={() => handleTabSwitch('all-photos')}
                          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                            activeTab === 'all-photos' ? '' : 'border-transparent'
                          }`}
                          style={{
                            color: activeTab === 'all-photos' ? 'var(--brand-primary, #3b82f6)' : 'var(--brand-subtext, #71717a)',
                            borderColor: activeTab === 'all-photos' ? 'var(--brand-primary, #3b82f6)' : 'transparent',
                          }}>
                          <Images size={14} /> 
                          <span>All Photos</span>
                          <span className="text-xs opacity-75">({allTab.total || event?.processed_count || 0})</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Results grid */}
                  <div id="results-section" className="max-w-6xl mx-auto px-5 py-6">
                    
                    {/* 🔐 Cached Results Banner */}
                    {cacheAge !== null && activeTab === 'my-photos' && (
                      <CachedResultsBanner
                        cacheAge={cacheAge}
                        totalResults={myTab.total}
                        onRefresh={handleRefreshResults}
                        primaryColor={brandingConfig.brand_primary_color}
                      />
                    )}
                    
                    {/* 👥 Friends photos info banner */}
                    {activeTab === 'with-friends' && friendsTab.total > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border mb-4 overflow-hidden"
                        style={{
                          background: `${brandingConfig.brand_primary_color}08`,
                          borderColor: `${brandingConfig.brand_primary_color}20`,
                        }}
                      >
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: `${brandingConfig.brand_primary_color}15` }}>
                            <Users size={20} style={{ color: brandingConfig.brand_primary_color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                              {friendsTab.total} group photo{friendsTab.total !== 1 ? 's' : ''}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                              Photos where you appear with others
                            </p>
                          </div>
                        </div>
                        <div className="px-4 py-2 text-xs flex items-center gap-4"
                          style={{ 
                            background: `${brandingConfig.brand_primary_color}05`,
                            color: 'var(--brand-subtext, #71717a)' 
                          }}>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: brandingConfig.brand_primary_color }}></span>
                            Each photo shows how many people are in it
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: brandingConfig.brand_primary_color }}></span>
                            Solo photos are in "My Photos" tab
                          </span>
                        </div>
                      </motion.div>
                    )}
                    
                    {/* 👥 Friends photos empty state */}
                    {activeTab === 'with-friends' && friendsTab.total === 0 && myTab.total > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col items-center justify-center py-12 gap-4 text-center"
                      >
                        <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                          style={{ 
                            background: `${brandingConfig.brand_primary_color}10`,
                            border: `1px solid ${brandingConfig.brand_primary_color}20`
                          }}>
                          <User size={28} style={{ color: brandingConfig.brand_primary_color }} />
                        </div>
                        <div>
                          <p className="text-base font-medium mb-1" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                            No group photos found
                          </p>
                          <p className="text-sm max-w-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                            All {myTab.total} of your photos are solo portraits. 
                            Group photos where you appear with others will appear here.
                          </p>
                        </div>
                        <motion.button 
                          whileHover={{ scale: 1.02 }} 
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setActiveTab('my-photos')}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                          style={{ 
                            background: `${brandingConfig.brand_primary_color}15`,
                            color: brandingConfig.brand_primary_color 
                          }}>
                          View My Photos ({myTab.total})
                        </motion.button>
                      </motion.div>
                    )}
                    
                    {/* ════════ ACTION BAR ════════ */}
                    <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                      {/* Left side - Results count */}
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                          {activeTab === 'my-photos' 
                            ? `${myTab.total} photo${myTab.total !== 1 ? 's' : ''} found`
                            : activeTab === 'with-friends'
                            ? `${friendsTab.total} group photo${friendsTab.total !== 1 ? 's' : ''}`
                            : `${allTab.total || event?.processed_count || 0} event photos`}
                        </p>
                      </div>

                      {/* Right side - Action buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Grid layout toggle */}
                        <div className="flex items-center gap-1 p-1 rounded-lg border"
                          style={{
                            background: 'var(--brand-surface, #18181b)',
                            borderColor: 'var(--brand-border, #27272a)',
                          }}>
                          {[
                            { k: 'large' as GridLayout, icon: <Grid2X2 size={13} />, title: 'Large' },
                            { k: 'comfortable' as GridLayout, icon: <LayoutGrid size={13} />, title: 'Comfortable' },
                            { k: 'compact' as GridLayout, icon: <SlidersHorizontal size={13} />, title: 'Compact' },
                          ].map(({ k, icon, title }) => (
                            <button key={k} title={title} onClick={() => setGridLayout(k)}
                              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                                gridLayout === k ? '' : 'opacity-50 hover:opacity-75'
                              }`}
                              style={gridLayout === k ? {
                                background: `${brandingConfig.brand_primary_color}20`,
                                color: brandingConfig.brand_primary_color,
                              } : { color: 'var(--brand-subtext, #71717a)' }}>
                              {icon}
                            </button>
                          ))}
                        </div>

                        {/* New Search button - only on My Photos tab */}
                        {activeTab === 'my-photos' && (
                          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                            onClick={() => { setResultId(null); setMyTab(emptyTab()); setFriendsTab(emptyTab()); setActiveScene('all'); setActiveObject('all'); }}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors"
                            style={{
                              background: 'var(--brand-surface, #18181b)',
                              borderColor: 'var(--brand-border, #27272a)',
                              color: 'var(--brand-text, #f4f4f5)',
                            }}>
                            <RefreshCw size={14} /> New Search
                          </motion.button>
                        )}
                      </div>
                    </div>

                    {/* ════════ SCENE/OBJECT FILTERS FOR MY PHOTOS ════════ */}
                    {activeTab === 'my-photos' && (Object.keys(sceneCounts).length > 0 || Object.keys(objectCounts).length > 0) && (
                      <div className="flex flex-col gap-2 mb-4 pb-4 border-b" style={{ borderColor: 'var(--brand-border, #27272a)' }}>
                        {/* Scene filter */}
                        {Object.keys(sceneCounts).length > 0 && (
                          <div className="flex items-center gap-2 overflow-x-auto pb-1">
                            <span className="text-[10px] font-bold tracking-wider uppercase flex-shrink-0" 
                              style={{ color: 'var(--brand-subtext, #71717a)' }}>Scene:</span>
                            <button onClick={() => setActiveScene('all')}
                              className={pillBase + ' ' + (activeScene === 'all' ? pillActive : pillInactive)}
                              style={activeScene === 'all' ? {
                                background: `${brandingConfig.brand_primary_color}15`,
                                borderColor: `${brandingConfig.brand_primary_color}35`,
                                color: brandingConfig.brand_primary_color,
                              } : {}}>
                              All
                            </button>
                            {Object.entries(sceneCounts).map(([label, count]) => (
                              <button key={label} onClick={() => setActiveScene(activeScene === label ? 'all' : label)}
                                className={pillBase + ' ' + (activeScene === label ? pillActive : pillInactive)}
                                style={activeScene === label ? {
                                  background: `${brandingConfig.brand_primary_color}15`,
                                  borderColor: `${brandingConfig.brand_primary_color}35`,
                                  color: brandingConfig.brand_primary_color,
                                } : {}}>
                                {label} ({count})
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Object filter */}
                        {Object.keys(objectCounts).length > 0 && (
                          <div className="flex items-center gap-2 overflow-x-auto pb-1">
                            <span className="text-[10px] font-bold tracking-wider uppercase flex-shrink-0"
                              style={{ color: 'var(--brand-subtext, #71717a)' }}>Content:</span>
                            <button onClick={() => setActiveObject('all')}
                              className={pillBase + ' ' + (activeObject === 'all' ? pillActive : pillInactive)}
                              style={activeObject === 'all' ? {
                                background: `${brandingConfig.brand_accent_color}15`,
                                borderColor: `${brandingConfig.brand_accent_color}35`,
                                color: brandingConfig.brand_accent_color,
                              } : {}}>
                              All
                            </button>
                            {Object.entries(objectCounts).slice(0, 10).map(([label, count]) => (
                              <button key={label} onClick={() => setActiveObject(activeObject === label ? 'all' : label)}
                                className={pillBase + ' ' + (activeObject === label ? pillActive : pillInactive)}
                                style={activeObject === label ? {
                                  background: `${brandingConfig.brand_accent_color}15`,
                                  borderColor: `${brandingConfig.brand_accent_color}35`,
                                  color: brandingConfig.brand_accent_color,
                                } : {}}>
                                {label} ({count})
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Multi-select toolbar - unified for all tabs */}
                    <MultiSelectToolbar
                      items={activeItems}
                      selectedIds={multiSelect.selectedIds}
                      onToggle={multiSelect.toggle}
                      onSelectAll={multiSelect.selectAll}
                      onClearSelection={multiSelect.clearSelection}
                      onBatchDownload={handleBatchDownload}
                      isActive={multiSelect.isSelectMode}
                      onActivate={multiSelect.enterSelectMode}
                      onDeactivate={multiSelect.exitSelectMode}
                      isDownloading={batchDlLoading}
                      totalCount={activeTab === 'my-photos' ? myTab.total : activeTab === 'with-friends' ? friendsTab.total : allTab.total}
                      onDownloadAll={activeTab === 'my-photos' ? handleDownloadAll : activeTab === 'all-photos' ? handleDownloadAllTab : undefined}
                      primaryColor={brandingConfig.brand_primary_color}
                    />

                    {activeTab === 'my-photos' ? (
                      renderPhotoGrid(filteredMyItems, mySentinelRef, myTab, () => handleUpload(new File([], '')), 'No photos found', () => {}, 'Take Selfie')
                    ) : activeTab === 'with-friends' ? (
                      renderPhotoGrid(friendsTab.items, friendsSentinelRef, friendsTab, () => setActiveTab('my-photos'), 'No group photos found', () => setActiveTab('my-photos'), 'View My Photos', true /* Show group badges */)
                    ) : (
                      <>
                        {/* Scene filter for All Photos */}
                        {allScenes.length > 0 && (
                          <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                            <button onClick={() => handleAllSceneFilter('')}
                              className={pillBase + ' ' + (!allSceneFilter ? pillActive : pillInactive)}
                              style={!allSceneFilter ? {
                                background: `${brandingConfig.brand_primary_color}15`,
                                borderColor: `${brandingConfig.brand_primary_color}35`,
                                color: brandingConfig.brand_primary_color,
                              } : {}}>
                              All
                            </button>
                            {allScenes.map(s => (
                              <button key={s.scene_label} onClick={() => handleAllSceneFilter(s.scene_label)}
                                className={pillBase + ' ' + (allSceneFilter === s.scene_label ? pillActive : pillInactive)}
                                style={allSceneFilter === s.scene_label ? {
                                  background: `${brandingConfig.brand_primary_color}15`,
                                  borderColor: `${brandingConfig.brand_primary_color}35`,
                                  color: brandingConfig.brand_primary_color,
                                } : {}}>
                                {s.scene_label} ({s.count})
                              </button>
                            ))}
                          </div>
                        )}
                        {renderPhotoGrid(allTab.items, allSentinelRef, allTab, () => loadAllPhotos(1, allSceneFilter, true), 'No photos yet', () => loadAllPhotos(1, '', true), 'Load Photos')}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* ════ CONTRIBUTE MODE ════ */}
          {mode === 'contribute' && (
            <motion.div key="contribute" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}
              className="max-w-lg mx-auto px-5 pt-12">
              <button onClick={() => setMode('search')}
                className="flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors"
                style={{ color: 'var(--brand-subtext, #71717a)' }}>
                <ArrowLeft size={13} /> Back to Search
              </button>

              <div className="text-center mb-8">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  style={{
                    background: `${brandingConfig.brand_primary_color}15`,
                    border: `1px solid ${brandingConfig.brand_primary_color}25`,
                  }}>
                  <CloudUpload size={26} style={{ color: brandingConfig.brand_primary_color }} />
                </div>
                <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                  Share Your Photos
                </h1>
                <p className="text-sm" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                  Contribute your event photos. Owner will review before publishing.
                </p>
              </div>

              <AnimatePresence mode="wait">
                {uploadStep === 'drop' && (
                  <motion.div key="drop" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <div
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); addContribFiles(e.dataTransfer.files); }}
                      onClick={() => contribInputRef.current?.click()}
                      className="border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors"
                      style={{
                        borderColor: dragOver ? `${brandingConfig.brand_primary_color}60` : 'var(--brand-border, #27272a)',
                        background: dragOver ? `${brandingConfig.brand_primary_color}08` : 'var(--brand-surface, #18181b)',
                      }}>
                      <Upload size={32} className="mx-auto mb-4" style={{ color: 'var(--brand-subtext, #71717a)' }} />
                      <p className="text-sm font-medium mb-1" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                        Drop photos here or click to browse
                      </p>
                      <p className="text-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                        JPG, PNG, WebP, HEIC • Max 20MB each
                      </p>
                    </div>
                    <input ref={contribInputRef} type="file" multiple accept="image/*" className="hidden"
                      onChange={e => addContribFiles(e.target.files)} />
                  </motion.div>
                )}

                {uploadStep === 'preview' && (
                  <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    {/* Preview grid */}
                    <div className="grid grid-cols-3 gap-2 mb-6">
                      {contribFiles.map(f => (
                        <div key={f.id} className="relative aspect-square rounded-xl overflow-hidden"
                          style={{ background: 'var(--brand-surface, #18181b)' }}>
                          <img src={f.preview} alt="" className="w-full h-full object-cover" />
                          <button onClick={() => setContribFiles(prev => prev.filter(x => x.id !== f.id))}
                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center"
                            style={{ background: 'rgba(0,0,0,0.6)' }}>
                            <X size={12} className="text-white" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Optional fields */}
                    <div className="space-y-3 mb-6">
                      <input type="text" value={contribName} onChange={e => setContribName(e.target.value)}
                        placeholder="Your name (optional)"
                        className="w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors"
                        style={{
                          background: 'var(--brand-surface, #18181b)',
                          borderColor: 'var(--brand-border, #27272a)',
                          color: 'var(--brand-text, #f4f4f5)',
                        }} />
                      <textarea value={contribMsg} onChange={e => setContribMsg(e.target.value)}
                        placeholder="Message for the host (optional)"
                        rows={2}
                        className="w-full px-4 py-3 rounded-xl border text-sm outline-none resize-none transition-colors"
                        style={{
                          background: 'var(--brand-surface, #18181b)',
                          borderColor: 'var(--brand-border, #27272a)',
                          color: 'var(--brand-text, #f4f4f5)',
                        }} />
                    </div>

                    {contribError && (
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4"
                        style={{ background: '#ef444410', border: '1px solid #ef444430' }}>
                        <AlertCircle size={14} className="text-red-400" />
                        <span className="text-red-400 text-xs">{contribError}</span>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={resetContrib}
                        className="flex-1 py-3 rounded-xl border text-sm font-semibold transition-colors"
                        style={{
                          background: 'var(--brand-surface, #18181b)',
                          borderColor: 'var(--brand-border, #27272a)',
                          color: 'var(--brand-text, #f4f4f5)',
                        }}>
                        Cancel
                      </button>
                      <button onClick={submitContrib}
                        className="flex-1 py-3 rounded-xl text-white text-sm font-semibold transition-colors"
                        style={{ background: 'var(--brand-primary, #3b82f6)' }}>
                        Submit {contribFiles.length} Photo{contribFiles.length !== 1 ? 's' : ''}
                      </button>
                    </div>
                  </motion.div>
                )}

                {uploadStep === 'submitting' && (
                  <motion.div key="submitting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="border rounded-2xl py-14 px-6 text-center"
                    style={{
                      background: 'var(--brand-surface, #18181b)',
                      borderColor: 'var(--brand-border, #27272a)',
                    }}>
                    <div className="relative w-16 h-16 mx-auto mb-6">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                        className="absolute inset-0 rounded-full border-2 border-transparent"
                        style={{
                          borderTopColor: brandingConfig.brand_primary_color,
                          borderRightColor: `${brandingConfig.brand_primary_color}30`,
                        }} />
                    </div>
                    <p className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                      Uploading your photos…
                    </p>
                    <p className="text-sm" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                      Please wait while we process your contribution
                    </p>
                  </motion.div>
                )}

                {uploadStep === 'success' && (
                  <motion.div key="success" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="border rounded-2xl py-14 px-6 text-center"
                    style={{
                      background: '#10b98110',
                      borderColor: '#10b98125',
                    }}>
                    <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center mx-auto mb-6"
                      style={{ background: '#10b98120', border: '1px solid #10b98130' }}>
                      <Check size={34} className="text-emerald-400" />
                    </div>
                    <p className="text-xl font-bold mb-2" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                      Thank you for sharing!
                    </p>
                    <p className="text-sm mb-8" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                      {uploadCount} photo{uploadCount !== 1 ? 's' : ''} uploaded successfully
                    </p>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => { setMode('search'); resetContrib(); }}
                      className="px-7 py-3 rounded-xl text-white text-sm font-semibold transition-colors"
                      style={{ background: 'var(--brand-primary, #3b82f6)' }}>
                      Find Your Photos
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 🎨 Footer with branding */}
      {(brandingConfig.brand_footer_text || brandingConfig.brand_show_powered_by) && (
        <footer className="py-6 px-5 border-t text-center"
          style={{
            borderColor: 'var(--brand-border, #27272a)',
            background: 'var(--brand-surface, #0d0d10)',
          }}>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            {brandingConfig.brand_footer_text && (
              <span className="text-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                {brandingConfig.brand_footer_text}
              </span>
            )}
            {brandingConfig.brand_show_powered_by && (
              <span className="text-[10px] tracking-wide" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                Powered by <strong style={{ color: brandingConfig.brand_accent_color }}>SNAPMATCH</strong>
              </span>
            )}
          </div>
        </footer>
      )}

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
              className="border rounded-2xl p-8 w-full max-w-sm"
              style={{
                background: 'var(--brand-surface, #18181b)',
                borderColor: 'var(--brand-border, #27272a)',
              }}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-base font-bold" style={{ color: 'var(--brand-text, #f4f4f5)' }}>How It Works</h3>
                <button onClick={() => setShowInfo(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
                  style={{ background: 'var(--brand-surface, #18181b)', color: 'var(--brand-subtext, #71717a)' }}>
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
                    <span className="text-[10px] font-black tracking-wider mt-0.5 flex-shrink-0"
                      style={{ color: brandingConfig.brand_primary_color }}>{n}</span>
                    <span className="text-sm leading-snug" style={{ color: 'var(--brand-subtext, #71717a)' }}>{text}</span>
                  </li>
                ))}
              </ul>
              
              {/* 🔐 Data Management Section */}
              <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--brand-border, #27272a)' }}>
                <DataManagementSection
                  onClearSelfie={handleClearSelfie}
                  onClearCache={handleClearCache}
                  onClearAll={handleClearAllData}
                  hasSelfie={!!storedSelfie}
                  cachedEventsCount={getCachedEventTokens().length}
                  primaryColor={brandingConfig.brand_primary_color}
                />
              </div>
              
              <button onClick={() => setShowInfo(false)}
                className="w-full mt-7 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors"
                style={{ background: 'var(--brand-primary, #3b82f6)' }}>
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

      {/* ════ TOAST NOTIFICATION ════ */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-6 left-1/2 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg"
            style={{
              background: toast.type === 'success' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)',
              borderColor: toast.type === 'success' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
              color: '#fff',
            }}
          >
            {toast.type === 'success' ? (
              <Check size={16} className="flex-shrink-0" />
            ) : (
              <AlertCircle size={16} className="flex-shrink-0" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}