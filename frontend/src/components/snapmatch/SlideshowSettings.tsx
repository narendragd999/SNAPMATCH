"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Settings, ExternalLink, Copy, Check,
  Monitor, Clock, Sparkles, QrCode, Image, Volume2, Loader2
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlideshowConfig {
  enabled: boolean;
  speed: number;
  transition: 'fade' | 'slide' | 'zoom' | 'none';
  show_qr: boolean;
  show_branding: boolean;
  music_url: string;
}

interface SlideshowSettingsProps {
  eventId: number;
  eventName: string;
  publicToken: string;
  apiUrl: string;
  authToken: string;
  initialConfig?: SlideshowConfig;
  onUpdate?: (config: SlideshowConfig) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [
  { value: 3, label: '3 seconds', description: 'Fast' },
  { value: 5, label: '5 seconds', description: 'Normal' },
  { value: 8, label: '8 seconds', description: 'Relaxed' },
  { value: 10, label: '10 seconds', description: 'Slow' },
  { value: 15, label: '15 seconds', description: 'Very slow' },
];

const TRANSITION_OPTIONS = [
  { value: 'fade', label: 'Fade', icon: '🌅' },
  { value: 'slide', label: 'Slide', icon: '➡️' },
  { value: 'zoom', label: 'Zoom', icon: '🔍' },
  { value: 'none', label: 'None', icon: '⚡' },
];

const DEFAULT_CONFIG: SlideshowConfig = {
  enabled: false,
  speed: 5,
  transition: 'fade',
  show_qr: true,
  show_branding: true,
  music_url: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function SlideshowSettings({
  eventId,
  eventName,
  publicToken,
  apiUrl,
  authToken,
  initialConfig,
  onUpdate,
}: SlideshowSettingsProps) {
  const [config, setConfig] = useState<SlideshowConfig>(initialConfig || DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slideshowUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/slideshow/${publicToken}`
    : '';

  // ── Fetch current config ──
  useEffect(() => {
    const fetchConfig = async () => {
      if (initialConfig) {
        setConfig(initialConfig);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/events/${eventId}/slideshow`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          setConfig(data.slideshow || DEFAULT_CONFIG);
        }
      } catch (err) {
        console.error('Failed to fetch slideshow config:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [eventId, apiUrl, authToken, initialConfig]);

  // ── Save config ──
  const saveConfig = async (newConfig: SlideshowConfig) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/slideshow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(newConfig),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setConfig(data.slideshow);
      onUpdate?.(data.slideshow);
    } catch (err) {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle slideshow ──
  const toggleSlideshow = async () => {
    const newConfig = { ...config, enabled: !config.enabled };
    await saveConfig(newConfig);
  };

  // ── Update setting ──
  const updateSetting = async <K extends keyof SlideshowConfig>(
    key: K,
    value: SlideshowConfig[K]
  ) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    await saveConfig(newConfig);
  };

  // ── Copy URL ──
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(slideshowUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
            <Monitor className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Live Slideshow</h3>
            <p className="text-xs text-zinc-500">Display photos in real-time on big screens</p>
          </div>
        </div>

        {/* Toggle */}
        <button
          onClick={toggleSlideshow}
          disabled={saving}
          className={`relative w-12 h-6 rounded-full transition-colors ${
            config.enabled ? 'bg-violet-500' : 'bg-zinc-700'
          }`}
        >
          <motion.div
            className="absolute top-1 w-4 h-4 bg-white rounded-full shadow"
            animate={{ left: config.enabled ? 28 : 4 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>
      </div>

      {/* ── Slideshow URL (when enabled) ── */}
      <AnimatePresence>
        {config.enabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <label className="text-xs text-zinc-400 mb-2 block">Slideshow URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={slideshowUrl}
                  readOnly
                  className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-zinc-300 font-mono"
                />
                <button
                  onClick={copyUrl}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 transition-colors"
                  title="Copy URL"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-zinc-400" />}
                </button>
                <a
                  href={slideshowUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 bg-violet-500/20 hover:bg-violet-500/30 rounded-lg border border-violet-500/30 transition-colors"
                  title="Open Slideshow"
                >
                  <ExternalLink className="w-4 h-4 text-violet-400" />
                </a>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Settings (when enabled) ── */}
      <AnimatePresence>
        {config.enabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-5 overflow-hidden"
          >
            {/* Speed */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
                <Clock className="w-3.5 h-3.5" />
                Slide Duration
              </label>
              <div className="grid grid-cols-5 gap-2">
                {SPEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateSetting('speed', opt.value)}
                    className={`p-2 rounded-lg text-center transition-all ${
                      config.speed === opt.value
                        ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
                        : 'bg-white/3 border border-white/6 text-zinc-400 hover:bg-white/5'
                    }`}
                  >
                    <div className="text-sm font-medium">{opt.value}s</div>
                    <div className="text-[10px] text-zinc-500">{opt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Transition */}
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
                <Sparkles className="w-3.5 h-3.5" />
                Transition Effect
              </label>
              <div className="grid grid-cols-4 gap-2">
                {TRANSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateSetting('transition', opt.value as SlideshowConfig['transition'])}
                    className={`p-3 rounded-lg text-center transition-all ${
                      config.transition === opt.value
                        ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
                        : 'bg-white/3 border border-white/6 text-zinc-400 hover:bg-white/5'
                    }`}
                  >
                    <div className="text-lg mb-1">{opt.icon}</div>
                    <div className="text-xs">{opt.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-3">
              {/* Show QR Code */}
              <div className="flex items-center justify-between p-3 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-3">
                  <QrCode className="w-4 h-4 text-zinc-400" />
                  <div>
                    <div className="text-sm text-zinc-300">Show QR Code</div>
                    <div className="text-xs text-zinc-500">Guests can scan to find their photos</div>
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('show_qr', !config.show_qr)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    config.show_qr ? 'bg-violet-500' : 'bg-zinc-700'
                  }`}
                >
                  <motion.div
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
                    animate={{ left: config.show_qr ? 22 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>

              {/* Show Branding */}
              <div className="flex items-center justify-between p-3 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-3">
                  <Image className="w-4 h-4 text-zinc-400" />
                  <div>
                    <div className="text-sm text-zinc-300">Show Branding</div>
                    <div className="text-xs text-zinc-500">Display event name and logo</div>
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('show_branding', !config.show_branding)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    config.show_branding ? 'bg-violet-500' : 'bg-zinc-700'
                  }`}
                >
                  <motion.div
                    className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
                    animate={{ left: config.show_branding ? 22 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error ── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Saving indicator ── */}
      <AnimatePresence>
        {saving && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center gap-2 text-xs text-zinc-500"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving...
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Info ── */}
      {config.enabled && (
        <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/15">
          <p className="text-xs text-violet-300/70">
            💡 <strong>Tip:</strong> Open the slideshow URL on a big screen (projector, TV) to display photos during the event. New photos appear automatically in real-time.
          </p>
        </div>
      )}
    </div>
  );
}

export default SlideshowSettings;