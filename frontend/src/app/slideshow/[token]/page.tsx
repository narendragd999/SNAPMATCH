'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ImageIcon, Wifi, WifiOff, Play, Pause, Settings,
  ChevronLeft, ChevronRight, Volume2, VolumeX, Maximize,
  Minimize, RefreshCw, QrCode, X, Lock, ShieldCheck, Eye, EyeOff
} from 'lucide-react';
import QRCode from 'qrcode';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlideshowPhoto {
  id: number;
  image_name: string;
  url: string;
  uploaded_at: string | null;
  scene_label: string | null;
}

interface SlideshowConfig {
  enabled: boolean;
  speed: number;
  transition: 'fade' | 'slide' | 'zoom' | 'none';
  show_qr: boolean;
  show_branding: boolean;
  music_url: string;
}

interface BrandingConfig {
  template_id: string;
  brand_logo_url: string;
  brand_primary_color: string;
  brand_accent_color: string;
  brand_font: string;
  brand_footer_text: string;
  brand_show_powered_by: boolean;
}

interface SlideshowData {
  event_id: number;
  event_name: string;
  event_token: string;
  slideshow: SlideshowConfig;
  branding: BrandingConfig;
  total_photos: number;
  photos: SlideshowPhoto[];
  has_more: boolean;
  // PIN protection
  pin_enabled: boolean;
  pin_version: string | null;
  expires_at: string | null;
  owner_id: number;
}

// ─── Transition Animations ─────────────────────────────────────────────────────

const transitions = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  slide: {
    initial: { opacity: 0, x: 100 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -100 },
  },
  zoom: {
    initial: { opacity: 0, scale: 1.1 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },
  none: {
    initial: { opacity: 1 },
    animate: { opacity: 1 },
    exit: { opacity: 1 },
  },
};

// ─── PIN Helpers ───────────────────────────────────────────────────────────────

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

// ─── Main Component ────────────────────────────────────────────────────────────

export default function SlideshowPage() {
  const params = useParams();
  const token = params?.token as string;
  const API = process.env.NEXT_PUBLIC_API_URL || '';

  // ── State ──
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SlideshowData | null>(null);
  const [photos, setPhotos] = useState<SlideshowPhoto[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [lastPhotoId, setLastPhotoId] = useState(0);

  // ── PIN State ──
  const [pinVerified, setPinVerified] = useState(false);
  const [pinInput, setPinInput] = useState(['', '', '', '']);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [showPin, setShowPin] = useState(false);
  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const slideIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const preloadedImagesRef = useRef<Set<string>>(new Set());

  // ── Current photo ──
  const currentPhoto = photos[currentIndex];

  // ── Verify PIN ──
  const verifyPin = useCallback(async () => {
    const pin = pinInput.join('');
    if (pin.length < 4) return;
    setPinLoading(true);
    setPinError(null);
    try {
      const res = await fetch(`${API}/public/events/${token}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        writePinSession(token, data?.pin_version ?? '', data?.expires_at);
        setPinVerified(true);
      } else {
        const attempts = pinAttempts + 1;
        setPinAttempts(attempts);
        setPinError(attempts >= 5 ? 'Too many attempts. Please try again later.' : 'Incorrect PIN. Please try again.');
        setPinInput(['', '', '', '']);
        pinRefs[0].current?.focus();
      }
    } catch {
      setPinError('Connection error. Please try again.');
    } finally {
      setPinLoading(false);
    }
  }, [pinInput, token, API, pinAttempts, data]);

  // ── Auto-submit PIN when all 4 digits filled ──
  useEffect(() => {
    if (pinInput.join('').length === 4 && !pinLoading && !pinError) verifyPin();
  }, [pinInput]);

  // ── Handle PIN input change ──
  const handlePinChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pinInput];
    newPin[index] = value.slice(-1);
    setPinInput(newPin);
    setPinError(null);
    if (value && index < 3) {
      pinRefs[index + 1].current?.focus();
    }
  }, [pinInput]);

  // ── Handle PIN keydown ──
  const handlePinKeydown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pinInput[index] && index > 0) {
      pinRefs[index - 1].current?.focus();
    }
  }, [pinInput]);

  // ── Load slideshow data ──
  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API}/slideshow/${token}`);
        if (!res.ok) {
          if (res.status === 403) throw new Error('Slideshow is not enabled for this event');
          if (res.status === 404) throw new Error('Event not found');
          throw new Error('Failed to load slideshow');
        }
        const slideshowData: SlideshowData = await res.json();
        setData(slideshowData);

        // Check PIN verification
        if (!slideshowData.pin_enabled) {
          setPinVerified(true);
        } else {
          // Check if owner
          try {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            if (user?.id && slideshowData?.owner_id && user.id === slideshowData.owner_id) {
              setPinVerified(true);
            } else if (readPinSession(token, slideshowData.pin_version)) {
              setPinVerified(true);
            }
          } catch {
            if (readPinSession(token, slideshowData.pin_version)) {
              setPinVerified(true);
            }
          }
        }

        // Only load photos if PIN verified (or no PIN required)
        if (pinVerified || !slideshowData.pin_enabled) {
          setPhotos(slideshowData.photos);
          if (slideshowData.photos.length > 0) {
            const maxId = Math.max(...slideshowData.photos.map(p => p.id));
            setLastPhotoId(maxId);
          }
        }

        // Generate QR code - Dark QR on white background for better visibility
        if (slideshowData.slideshow.show_qr) {
          const qrUrl = `${window.location.origin}/public/${token}`;
          const qr = await QRCode.toDataURL(qrUrl, {
            width: 200,
            margin: 2,
            color: {
              dark: '#1a1a2e',   // Dark blue/black QR code
              light: '#ffffff'   // White background
            }
          });
          setQrCodeUrl(qr);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load slideshow');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token, API, pinVerified]);

  // ── Auto-focus PIN input ──
  useEffect(() => {
    if (data?.pin_enabled && !pinVerified) {
      setTimeout(() => pinRefs[0].current?.focus(), 200);
    }
  }, [data?.pin_enabled, pinVerified]);

  // ── WebSocket connection for real-time updates ──
  useEffect(() => {
    if (!token || !data?.slideshow.enabled || !pinVerified) return;

    const connectWebSocket = () => {
      const wsUrl = API.replace('http', 'ws').replace('https', 'wss');
      const ws = new WebSocket(`${wsUrl}/ws/slideshow/${token}?last_id=${lastPhotoId}`);

      ws.onopen = () => {
        setIsConnected(true);
        console.log('[Slideshow] WebSocket connected');
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log('[Slideshow] WebSocket disconnected');
        // Reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (err) => {
        console.error('[Slideshow] WebSocket error:', err);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'new_photo' && message.data) {
            // Add new photo to the beginning of the list
            setPhotos(prev => {
              // Avoid duplicates
              if (prev.find(p => p.id === message.data.id)) return prev;
              return [message.data, ...prev];
            });
            setLastPhotoId(message.data.id);
          }
        } catch (err) {
          console.error('[Slideshow] Failed to parse message:', err);
        }
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token, API, data?.slideshow.enabled, lastPhotoId, pinVerified]);

  // ── Auto-advance slideshow ──
  useEffect(() => {
    if (!isPlaying || photos.length === 0 || !pinVerified) {
      if (slideIntervalRef.current) {
        clearInterval(slideIntervalRef.current);
        slideIntervalRef.current = null;
      }
      return;
    }

    const speed = data?.slideshow.speed || 5;
    slideIntervalRef.current = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % photos.length);
    }, speed * 1000);

    return () => {
      if (slideIntervalRef.current) {
        clearInterval(slideIntervalRef.current);
      }
    };
  }, [isPlaying, photos.length, data?.slideshow.speed, pinVerified]);

  // ── Preload images ──
  useEffect(() => {
    if (photos.length === 0) return;

    // Preload current and next few images
    const toPreload = [
      currentIndex,
      (currentIndex + 1) % photos.length,
      (currentIndex + 2) % photos.length,
    ];

    toPreload.forEach(idx => {
      const photo = photos[idx];
      if (photo && !preloadedImagesRef.current.has(photo.url)) {
        const img = new Image();
        img.src = photo.url;
        preloadedImagesRef.current.add(photo.url);
      }
    });
  }, [currentIndex, photos]);

  // ── Hide controls after inactivity ──
  useEffect(() => {
    const resetTimeout = () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      setShowControls(true);
      controlsTimeoutRef.current = setTimeout(() => {
        if (isPlaying) {
          setShowControls(false);
        }
      }, 3000);
    };

    resetTimeout();

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying, currentIndex]);

  // ── Fullscreen ──
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  // ── Navigation ──
  const goToNext = useCallback(() => {
    setCurrentIndex(prev => (prev + 1) % photos.length);
  }, [photos.length]);

  const goToPrev = useCallback(() => {
    setCurrentIndex(prev => (prev - 1 + photos.length) % photos.length);
  }, [photos.length]);

  // ── Keyboard controls ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
          goToNext();
          break;
        case 'ArrowLeft':
          goToPrev();
          break;
        case ' ':
          setIsPlaying(prev => !prev);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'q':
        case 'Q':
          setShowQR(prev => !prev);
          break;
        case 'Escape':
          if (showQR) setShowQR(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrev, toggleFullscreen, showQR]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-white/50 animate-spin mx-auto mb-4" />
          <p className="text-white/70">Loading slideshow...</p>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <ImageIcon className="w-16 h-16 text-red-400/50 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">Unable to Load Slideshow</h1>
          <p className="text-white/60 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── PIN Required Screen ──
  if (data?.pin_enabled && !pinVerified) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-sm"
        >
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/20">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">PIN Required</h1>
            <p className="text-slate-400 text-sm">
              Enter the 4-digit PIN to access the slideshow
            </p>
          </div>

          {/* PIN Input */}
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700/50">
            <div className="flex justify-center gap-3 mb-4">
              {pinInput.map((digit, i) => (
                <div key={i} className="relative">
                  <input
                    ref={pinRefs[i]}
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeydown(i, e)}
                    className="w-14 h-16 text-center text-2xl font-bold bg-slate-700/50 border-2 border-slate-600 rounded-xl text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                </div>
              ))}
            </div>

            {/* Show/Hide PIN */}
            <button
              onClick={() => setShowPin(!showPin)}
              className="flex items-center justify-center gap-2 text-slate-400 hover:text-white text-sm mx-auto mb-4 transition-colors"
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showPin ? 'Hide' : 'Show'} PIN
            </button>

            {/* Error */}
            {pinError && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-red-400 text-sm text-center mb-4"
              >
                {pinError}
              </motion.p>
            )}

            {/* Loading */}
            {pinLoading && (
              <div className="flex items-center justify-center gap-2 text-violet-400 text-sm">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Verifying...
              </div>
            )}
          </div>

          {/* Event name */}
          <p className="text-center text-slate-500 text-sm mt-6">
            {data.event_name}
          </p>
        </motion.div>
      </div>
    );
  }

  // ── No photos state ──
  if (photos.length === 0) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <ImageIcon className="w-16 h-16 text-white/30 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-white mb-2">No Photos Yet</h1>
          <p className="text-white/60">Photos will appear here once they're uploaded.</p>
          {isConnected && (
            <div className="flex items-center justify-center gap-2 mt-4 text-emerald-400">
              <Wifi className="w-4 h-4" />
              <span className="text-sm">Waiting for photos...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Get transition config ──
  const transition = transitions[data?.slideshow.transition || 'fade'];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black overflow-hidden cursor-none"
      onMouseMove={() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
        }
        controlsTimeoutRef.current = setTimeout(() => {
          if (isPlaying) setShowControls(false);
        }, 3000);
      }}
      style={{ cursor: showControls ? 'default' : 'none' }}
    >
      {/* ── Main Photo ── */}
      <AnimatePresence mode="wait">
        {currentPhoto && (
          <motion.div
            key={currentPhoto.id}
            initial={transition.initial}
            animate={transition.animate}
            exit={transition.exit}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <img
              src={currentPhoto.url}
              alt=""
              className="w-full h-full object-contain"
              draggable={false}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Branding Overlay ── */}
      {data?.slideshow.show_branding && data.branding && (
        <div className="absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none z-10">
          <div className="flex items-center gap-4">
            {data.branding.brand_logo_url && (
              <img
                src={data.branding.brand_logo_url}
                alt="Logo"
                className="h-12 w-auto object-contain"
              />
            )}
            <div>
              <h1 className="text-xl font-semibold text-white">{data.event_name}</h1>
              <p className="text-sm text-white/60">{data.total_photos} photos</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Connection Status ── */}
      <div className="absolute top-4 right-4 z-30">
        {isConnected ? (
          <div className="flex items-center gap-1.5 text-emerald-400 text-xs bg-black/40 px-2 py-1 rounded-full">
            <Wifi className="w-3.5 h-3.5" />
            <span>Live</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-white/40 text-xs bg-black/40 px-2 py-1 rounded-full">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline</span>
          </div>
        )}
      </div>

      {/* ── QR Code - Right Side Overlay (Touching right border) ── */}
      <AnimatePresence>
        {showQR && qrCodeUrl && (
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="absolute top-1/2 right-0 -translate-y-1/2 z-40 flex flex-col items-end"
          >
            {/* QR Code Container - Right aligned */}
            <div className="bg-white/95 backdrop-blur-sm rounded-l-2xl shadow-2xl p-4 pr-0 border-l border-t border-b border-white/20">
              {/* Close button */}
              <button
                onClick={() => setShowQR(false)}
                className="absolute -top-2 -left-2 w-8 h-8 flex items-center justify-center rounded-full bg-black/80 hover:bg-black text-white transition-colors shadow-lg"
              >
                <X className="w-4 h-4" />
              </button>

              {/* QR Code */}
              <div className="rounded-xl overflow-hidden shadow-lg mb-3">
                <img
                  src={qrCodeUrl}
                  alt="QR Code"
                  className="w-40 h-40"
                />
              </div>

              {/* Text */}
              <div className="text-center pr-4">
                <p className="text-slate-800 font-semibold text-sm">Scan to Find Your Photos</p>
                <p className="text-slate-500 text-xs mt-1">
                  Point your camera at the code
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Controls ── */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/60 to-transparent z-20"
          >
            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex gap-1">
                {photos.slice(0, 50).map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      idx === currentIndex ? 'bg-white' : 'bg-white/20 hover:bg-white/40'
                    }`}
                  />
                ))}
                {photos.length > 50 && (
                  <span className="text-white/40 text-xs ml-2">+{photos.length - 50} more</span>
                )}
              </div>
            </div>

            {/* Controls row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* Previous */}
                <button
                  onClick={goToPrev}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Play/Pause */}
                <button
                  onClick={() => setIsPlaying(prev => !prev)}
                  className="w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                </button>

                {/* Next */}
                <button
                  onClick={goToNext}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Photo counter */}
              <div className="text-white/60 text-sm">
                {currentIndex + 1} / {photos.length}
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-2">
                {/* QR Code */}
                {data?.slideshow.show_qr && (
                  <button
                    onClick={() => setShowQR(true)}
                    className={`w-10 h-10 flex items-center justify-center rounded-full text-white transition-colors ${
                      showQR
                        ? 'bg-violet-500 hover:bg-violet-400'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                    title="Show QR Code (Q)"
                  >
                    <QrCode className="w-5 h-5" />
                  </button>
                )}

                {/* Fullscreen */}
                <button
                  onClick={toggleFullscreen}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                  title="Fullscreen (F)"
                >
                  {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Keyboard shortcuts hint */}
            <div className="text-center mt-4 text-white/40 text-xs">
              ← → Navigate • Space Play/Pause • F Fullscreen • Q QR Code
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Powered by (if enabled) ── */}
      {data?.branding.brand_show_powered_by && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <span className="text-white/30 text-xs">Powered by SNAPMATCH</span>
        </div>
      )}
    </div>
  );
}