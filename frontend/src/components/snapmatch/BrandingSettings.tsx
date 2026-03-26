/**
 * BrandingSettings Component
 * Configure brand identity for the public event gallery page.
 * Matches WatermarkSettings code style — same modal pattern, same sub-components,
 * same Tailwind conventions, same memo/useCallback/AnimatePresence structure.
 *
 * Usage in [eventId]/page.tsx:
 *   import { BrandingSettings } from '@/components/snapmatch/BrandingSettings';
 *
 *   <BrandingSettings
 *     isOpen={brandingOpen}
 *     onClose={() => setBrandingOpen(false)}
 *     onSave={(cfg) => setEvent(prev => prev ? { ...prev, ...cfg } : prev)}
 *     eventId={eventId}
 *     initialConfig={brandingConfigFromEvent}
 *   />
 *
 * Add to EventDetail interface in [eventId]/page.tsx:
 *   template_id?: string;
 *   brand_logo_url?: string;
 *   brand_primary_color?: string;
 *   brand_accent_color?: string;
 *   brand_font?: string;
 *   brand_footer_text?: string;
 *   brand_show_powered_by?: boolean;
 */

'use client';

import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, X, Upload, Type, Image as ImageIcon,
  RotateCcw, Check, Eye, Sparkles, Monitor,
  Sun, Moon, Briefcase, Heart, Music,
  ChevronRight, AlertCircle, Loader2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TemplateId = 'classic' | 'minimal' | 'wedding' | 'corporate' | 'dark';

export interface BrandingConfig {
  template_id: TemplateId;
  brand_logo_url: string;        // URL from R2 after upload, or '' if none
  brand_primary_color: string;   // hex e.g. '#3b82f6'
  brand_accent_color: string;    // hex e.g. '#60a5fa'
  brand_font: string;            // font key from FONT_OPTIONS
  brand_footer_text: string;     // e.g. '© Riya Photography 2025'
  brand_show_powered_by: boolean;// show "Powered by SNAPMATCH" footer badge
}

export const DEFAULT_BRANDING_CONFIG: BrandingConfig = {
  template_id: 'classic',
  brand_logo_url: '',
  brand_primary_color: '#3b82f6',
  brand_accent_color: '#60a5fa',
  brand_font: 'system',
  brand_footer_text: '',
  brand_show_powered_by: true,
};

interface BrandingSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with full BrandingConfig on save — update your EventDetail state with this */
  onSave: (config: BrandingConfig) => void;
  /** The numeric event ID, used for logo upload API call */
  eventId: string | number;
  /** Pass event.brand_* fields here — merged over defaults on open */
  initialConfig?: Partial<BrandingConfig> | null;
}

// ─── Template definitions ─────────────────────────────────────────────────────

interface TemplateDef {
  id: TemplateId;
  label: string;
  description: string;
  icon: React.ElementType;
  preview: {
    bg: string;
    accent: string;
    text: string;
    subtext: string;
  };
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Clean, timeless. Works for any event.',
    icon: Monitor,
    preview: { bg: '#09090f', accent: '#3b82f6', text: '#f4f4f5', subtext: '#71717a' },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Maximum whitespace. Photos speak loudest.',
    icon: Sun,
    preview: { bg: '#fafafa', accent: '#18181b', text: '#18181b', subtext: '#a1a1aa' },
  },
  {
    id: 'wedding',
    label: 'Wedding',
    description: 'Soft, romantic. Elegant serif typography.',
    icon: Heart,
    preview: { bg: '#1a0a10', accent: '#e879a0', text: '#fdf2f8', subtext: '#f9a8d4' },
  },
  {
    id: 'corporate',
    label: 'Corporate',
    description: 'Professional, brand-forward layout.',
    icon: Briefcase,
    preview: { bg: '#0a0f1a', accent: '#2563eb', text: '#f8fafc', subtext: '#94a3b8' },
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'High-contrast. Great for concerts & nightlife.',
    icon: Moon,
    preview: { bg: '#000000', accent: '#a855f7', text: '#ffffff', subtext: '#a855f7' },
  },
];

// ─── Font options ─────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  { key: 'system',    label: 'System Default',     sample: 'Aa',  css: 'system-ui, sans-serif' },
  { key: 'playfair',  label: 'Playfair Display',   sample: 'Aa',  css: "'Playfair Display', serif" },
  { key: 'dm-serif',  label: 'DM Serif Display',   sample: 'Aa',  css: "'DM Serif Display', serif" },
  { key: 'cormorant', label: 'Cormorant Garamond',  sample: 'Aa', css: "'Cormorant Garamond', serif" },
  { key: 'syne',      label: 'Syne',               sample: 'Aa',  css: "'Syne', sans-serif" },
  { key: 'outfit',    label: 'Outfit',             sample: 'Aa',  css: "'Outfit', sans-serif" },
  { key: 'josefin',   label: 'Josefin Sans',       sample: 'Aa',  css: "'Josefin Sans', sans-serif" },
  { key: 'mono',      label: 'JetBrains Mono',     sample: 'Aa',  css: "'JetBrains Mono', monospace" },
];

// ─── Reusable sub-components (same style as WatermarkSettings) ────────────────

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange }) => (
  <button
    onClick={onChange}
    className={`relative w-10 h-5 rounded-full border transition-colors flex-shrink-0 ${
      checked ? 'bg-blue-600 border-blue-500' : 'bg-zinc-700 border-zinc-600'
    }`}
  >
    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
      checked ? 'left-[22px]' : 'left-0.5'
    }`} />
  </button>
);

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 space-y-3">
    <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">{title}</p>
    {children}
  </div>
);

// ─── Template Card ────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: TemplateDef;
  selected: boolean;
  onSelect: () => void;
}

const TemplateCard: React.FC<TemplateCardProps> = memo(({ template, selected, onSelect }) => {
  const { preview } = template;
  const Icon = template.icon;

  return (
    <button
      onClick={onSelect}
      className={`relative w-full rounded-xl overflow-hidden border-2 transition-all ${
        selected
          ? 'border-blue-500 ring-2 ring-blue-500/20'
          : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      {/* Mini gallery preview */}
      <div
        className="h-16 flex flex-col justify-between p-2"
        style={{ background: preview.bg }}
      >
        {/* Mock header bar */}
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-md flex-shrink-0" style={{ background: preview.accent, opacity: 0.9 }} />
          <div className="h-1.5 w-10 rounded-full" style={{ background: preview.text, opacity: 0.7 }} />
          <div className="ml-auto h-1.5 w-6 rounded-full" style={{ background: preview.accent, opacity: 0.5 }} />
        </div>
        {/* Mock photo grid */}
        <div className="grid grid-cols-4 gap-0.5">
          {[0.9, 0.6, 0.8, 0.5].map((op, i) => (
            <div key={i} className="h-3 rounded-sm" style={{ background: preview.accent, opacity: op * 0.4 }} />
          ))}
        </div>
        {/* Mock footer */}
        <div className="h-1 w-8 rounded-full mx-auto" style={{ background: preview.subtext, opacity: 0.4 }} />
      </div>

      {/* Label row */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-2 border-t"
        style={{ background: preview.bg, borderColor: selected ? '#3b82f6' : '#27272a' }}
      >
        <Icon size={10} style={{ color: preview.accent }} />
        <span className="text-[10px] font-semibold" style={{ color: preview.text }}>
          {template.label}
        </span>
      </div>

      {/* Selected check */}
      {selected && (
        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
          <Check size={9} className="text-white" />
        </div>
      )}
    </button>
  );
});

TemplateCard.displayName = 'TemplateCard';

// ─── Live Preview Strip ───────────────────────────────────────────────────────

interface PreviewStripProps {
  config: BrandingConfig;
  logoDataUrl: string | null; // local data URL before upload
}

const PreviewStrip: React.FC<PreviewStripProps> = memo(({ config, logoDataUrl }) => {
  const template = TEMPLATES.find(t => t.id === config.template_id) ?? TEMPLATES[0];
  const { preview } = template;
  const logoSrc = logoDataUrl || config.brand_logo_url || null;

  return (
    <div
      className="rounded-xl overflow-hidden border border-zinc-700"
      style={{ background: preview.bg }}
    >
      {/* Mock header */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 border-b"
        style={{ borderColor: `${config.brand_primary_color}22` }}
      >
        {/* Logo or color dot */}
        {logoSrc ? (
          <img src={logoSrc} alt="Logo" className="w-6 h-6 rounded object-contain" style={{ background: 'rgba(255,255,255,0.05)' }} />
        ) : (
          <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `${config.brand_primary_color}25`, border: `1px solid ${config.brand_primary_color}40` }}>
            <Sparkles size={10} style={{ color: config.brand_primary_color }} />
          </div>
        )}
        <div>
          <p className="text-[11px] font-semibold leading-none" style={{ color: preview.text, fontFamily: FONT_OPTIONS.find(f => f.key === config.brand_font)?.css }}>
            My Event
          </p>
          <p className="text-[9px] mt-0.5" style={{ color: preview.subtext }}>AI · Face Recognition</p>
        </div>
        <div className="ml-auto">
          <div className="px-2 py-1 rounded-lg text-[9px] font-semibold" style={{ background: `${config.brand_primary_color}20`, color: config.brand_primary_color }}>
            Share Photos
          </div>
        </div>
      </div>

      {/* Mock hero */}
      <div className="px-3 py-4 text-center">
        <div className="text-[13px] font-bold mb-1" style={{ color: preview.text, fontFamily: FONT_OPTIONS.find(f => f.key === config.brand_font)?.css }}>
          Find Yourself
        </div>
        <div className="text-[9px] mb-3" style={{ color: preview.subtext }}>Upload a selfie — AI finds your photos instantly.</div>
        <div className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[9px] font-semibold"
          style={{ background: config.brand_primary_color, color: '#fff' }}>
          Take Selfie
        </div>
      </div>

      {/* Footer */}
      {(config.brand_footer_text || config.brand_show_powered_by) && (
        <div className="px-3 py-2 border-t flex items-center justify-between"
          style={{ borderColor: `${config.brand_primary_color}15` }}>
          {config.brand_footer_text && (
            <span className="text-[8px]" style={{ color: preview.subtext }}>{config.brand_footer_text}</span>
          )}
          {config.brand_show_powered_by && (
            <span className="text-[8px] ml-auto" style={{ color: preview.subtext }}>Powered by SNAPMATCH</span>
          )}
        </div>
      )}
    </div>
  );
});

PreviewStrip.displayName = 'PreviewStrip';

// ─── Main BrandingSettings Component ─────────────────────────────────────────

export const BrandingSettings: React.FC<BrandingSettingsProps> = memo(({
  isOpen,
  onClose,
  onSave,
  eventId,
  initialConfig,
}) => {
  const API = process.env.NEXT_PUBLIC_API_URL || '';

  const [config, setConfig] = useState<BrandingConfig>(DEFAULT_BRANDING_CONFIG);
  const [activeTab, setActiveTab] = useState<'template' | 'identity' | 'preview'>('template');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null); // local preview before upload
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── Hydrate config from parent (API data) on open ──
  useEffect(() => {
    if (isOpen) {
      setConfig({ ...DEFAULT_BRANDING_CONFIG, ...(initialConfig ?? {}) });
      setLogoDataUrl(null);
      setLogoError(null);
      setSaveError(null);
      setSaved(false);
      setActiveTab('template');
    }
  }, [isOpen, initialConfig]);

  // ── Close on Escape ──
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const updateConfig = useCallback(<K extends keyof BrandingConfig>(key: K, value: BrandingConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  // ── Logo upload — presign → PUT to R2 ──
  // Matches the same presign pattern used in BulkUploadModal.
  // Falls back to base64 data URL storage if presign is unavailable.
  const handleLogoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setLogoDataUrl(ev.target?.result as string);
    reader.readAsDataURL(file);

    setLogoUploading(true);
    setLogoError(null);

    try {
      const token = localStorage.getItem('token') ?? '';

      // Step 1: presign
      const presignRes = await fetch(`${API}/events/${eventId}/branding/logo-presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: file.name, content_type: file.type }),
      });

      if (!presignRes.ok) throw new Error('Presign failed');
      const { upload_url, public_url } = await presignRes.json();

      // Step 2: PUT to R2
      const putRes = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!putRes.ok) throw new Error('Upload failed');

      // Store the permanent public URL in config
      updateConfig('brand_logo_url', public_url);
      setLogoDataUrl(null); // clear local blob — use permanent URL now
    } catch (err) {
      // Fallback: store data URL directly. Works for small logos (<100KB).
      // Not ideal for production but keeps UX smooth during dev.
      console.warn('Logo presign/upload failed, using data URL fallback:', err);
      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = (ev) => resolve(ev.target?.result as string);
        r.readAsDataURL(file);
      });
      updateConfig('brand_logo_url', dataUrl);
      setLogoError('Logo stored locally (upload endpoint not yet configured)');
    } finally {
      setLogoUploading(false);
    }
  }, [API, eventId, updateConfig]);

  // ── Save — PATCH event branding fields ──
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);

    try {
      const token = localStorage.getItem('token') ?? '';
      const res = await fetch(`${API}/events/${eventId}/branding`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }

      onSave(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  }, [API, eventId, config, onSave]);

  const handleReset = useCallback(() => {
    setConfig(DEFAULT_BRANDING_CONFIG);
    setLogoDataUrl(null);
    setLogoError(null);
    setSaveError(null);
    setSaved(false);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden w-full max-w-lg max-h-[92vh] flex flex-col"
          >

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center flex-shrink-0">
                  <Palette size={13} className="text-rose-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-100 leading-none">Branding</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Customize your public gallery appearance</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <X size={12} />
              </button>
            </div>

            {/* ── Tab bar ── */}
            <div className="flex bg-zinc-950/60 border-b border-zinc-800 px-5 gap-1 flex-shrink-0">
              {([
                { key: 'template', label: 'Template', icon: Monitor },
                { key: 'identity', label: 'Identity',  icon: Palette },
                { key: 'preview',  label: 'Preview',   icon: Eye },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === key
                      ? 'border-blue-500 text-zinc-100'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Icon size={11} /> {label}
                </button>
              ))}
            </div>

            {/* ── Scrollable body ── */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">

              {/* ══ TEMPLATE TAB ══ */}
              {activeTab === 'template' && (
                <motion.div
                  key="template"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    Choose the layout style for your public selfie page. You can always change this later.
                  </p>

                  <div className="grid grid-cols-2 gap-2.5">
                    {TEMPLATES.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        selected={config.template_id === t.id}
                        onSelect={() => updateConfig('template_id', t.id)}
                      />
                    ))}
                  </div>

                  {/* Selected template description */}
                  <AnimatePresence mode="wait">
                    {TEMPLATES.filter(t => t.id === config.template_id).map(t => (
                      <motion.div
                        key={t.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-blue-500/8 border border-blue-500/20"
                      >
                        <t.icon size={13} className="text-blue-400 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-zinc-200">{t.label} selected</p>
                          <p className="text-[10px] text-zinc-500">{t.description}</p>
                        </div>
                        <ChevronRight size={12} className="text-zinc-600 ml-auto flex-shrink-0" />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* ══ IDENTITY TAB ══ */}
              {activeTab === 'identity' && (
                <motion.div
                  key="identity"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >

                  {/* Logo upload */}
                  <Section title="Logo">
                    {(logoDataUrl || config.brand_logo_url) ? (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700">
                        <img
                          src={logoDataUrl || config.brand_logo_url}
                          alt="Brand logo"
                          className="w-9 h-9 rounded-lg object-contain bg-white/5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-zinc-200">Logo uploaded</p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            {logoUploading ? 'Uploading to storage…' : 'Showing on public page header'}
                          </p>
                        </div>
                        {logoUploading
                          ? <Loader2 size={13} className="text-blue-400 animate-spin flex-shrink-0" />
                          : (
                            <button
                              onClick={() => logoInputRef.current?.click()}
                              className="text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors flex-shrink-0"
                            >
                              Change
                            </button>
                          )
                        }
                      </div>
                    ) : (
                      <button
                        onClick={() => logoInputRef.current?.click()}
                        className="w-full flex flex-col items-center gap-2 py-5 rounded-xl border-2 border-dashed border-zinc-700 hover:border-zinc-500 transition-colors text-center"
                      >
                        <Upload size={18} className="text-zinc-600" />
                        <div>
                          <p className="text-xs font-medium text-zinc-400">Upload your logo</p>
                          <p className="text-[10px] text-zinc-600 mt-0.5">PNG with transparency · recommended 200×200px</p>
                        </div>
                      </button>
                    )}

                    {/* Remove logo */}
                    {(logoDataUrl || config.brand_logo_url) && (
                      <button
                        onClick={() => { updateConfig('brand_logo_url', ''); setLogoDataUrl(null); }}
                        className="text-[11px] text-zinc-600 hover:text-red-400 transition-colors"
                      >
                        Remove logo
                      </button>
                    )}

                    {logoError && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
                        <AlertCircle size={10} /> {logoError}
                      </div>
                    )}

                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                  </Section>

                  {/* Colors */}
                  <Section title="Colors">
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { key: 'brand_primary_color', label: 'Primary', hint: 'Buttons, active tabs' },
                        { key: 'brand_accent_color',  label: 'Accent',  hint: 'Icons, highlights' },
                      ] as const).map(({ key, label, hint }) => (
                        <div key={key}>
                          <label className="block text-[10px] font-medium text-zinc-400 mb-1">{label}</label>
                          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 cursor-pointer"
                            onClick={() => document.getElementById(`color-${key}`)?.click()}>
                            <input
                              id={`color-${key}`}
                              type="color"
                              value={config[key]}
                              onChange={(e) => updateConfig(key, e.target.value)}
                              className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                            />
                            <div className="flex-1">
                              <p className="text-xs text-zinc-200 font-mono">{config[key]}</p>
                              <p className="text-[9px] text-zinc-600">{hint}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Quick palette presets */}
                    <div>
                      <p className="text-[10px] text-zinc-600 mb-2">Quick presets</p>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { primary: '#3b82f6', accent: '#60a5fa', label: 'Blue' },
                          { primary: '#e879a0', accent: '#f9a8d4', label: 'Rose' },
                          { primary: '#10b981', accent: '#6ee7b7', label: 'Emerald' },
                          { primary: '#f59e0b', accent: '#fcd34d', label: 'Amber' },
                          { primary: '#8b5cf6', accent: '#c4b5fd', label: 'Violet' },
                          { primary: '#ef4444', accent: '#fca5a5', label: 'Red' },
                        ].map(({ primary, accent, label }) => (
                          <button
                            key={label}
                            onClick={() => {
                              updateConfig('brand_primary_color', primary);
                              updateConfig('brand_accent_color', accent);
                            }}
                            title={label}
                            className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${
                              config.brand_primary_color === primary
                                ? 'border-white ring-2 ring-white/20'
                                : 'border-transparent'
                            }`}
                            style={{ background: primary }}
                          />
                        ))}
                      </div>
                    </div>
                  </Section>

                  {/* Font */}
                  <Section title="Typography">
                    <div className="space-y-1.5">
                      {FONT_OPTIONS.map((font) => (
                        <button
                          key={font.key}
                          onClick={() => updateConfig('brand_font', font.key)}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors ${
                            config.brand_font === font.key
                              ? 'bg-blue-500/10 border-blue-500/30 text-zinc-100'
                              : 'bg-zinc-800/50 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                          }`}
                        >
                          <span className="text-xs font-medium">{font.label}</span>
                          <span
                            className="text-sm font-medium"
                            style={{ fontFamily: font.css, color: config.brand_font === font.key ? config.brand_primary_color : undefined }}
                          >
                            {font.sample}
                          </span>
                        </button>
                      ))}
                    </div>
                  </Section>

                  {/* Footer text */}
                  <Section title="Footer">
                    <div>
                      <label className="block text-[10px] font-medium text-zinc-400 mb-1.5">
                        Footer text <span className="text-zinc-600">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={config.brand_footer_text}
                        onChange={(e) => updateConfig('brand_footer_text', e.target.value)}
                        placeholder="© Riya Photography 2025"
                        maxLength={100}
                        className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                      />
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[10px] text-zinc-600">Shown at the bottom of the guest page</p>
                        <p className="text-[10px] text-zinc-600">{config.brand_footer_text.length}/100</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div>
                        <p className="text-xs font-medium text-zinc-300">Show "Powered by SNAPMATCH"</p>
                        <p className="text-[10px] text-zinc-600">Keeps the attribution badge in the footer</p>
                      </div>
                      <Toggle
                        checked={config.brand_show_powered_by}
                        onChange={() => updateConfig('brand_show_powered_by', !config.brand_show_powered_by)}
                      />
                    </div>
                  </Section>

                </motion.div>
              )}

              {/* ══ PREVIEW TAB ══ */}
              {activeTab === 'preview' && (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    This is how the header and hero section will look to your guests.
                  </p>

                  <PreviewStrip config={config} logoDataUrl={logoDataUrl} />

                  {/* Summary of current settings */}
                  <Section title="Current Settings">
                    <div className="space-y-2">
                      {[
                        { label: 'Template',  value: TEMPLATES.find(t => t.id === config.template_id)?.label ?? '—' },
                        { label: 'Font',      value: FONT_OPTIONS.find(f => f.key === config.brand_font)?.label ?? '—' },
                        { label: 'Logo',      value: (logoDataUrl || config.brand_logo_url) ? 'Uploaded' : 'None (default icon)' },
                        { label: 'Footer',    value: config.brand_footer_text || 'None' },
                        { label: 'SNAPMATCH badge', value: config.brand_show_powered_by ? 'Shown' : 'Hidden' },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between">
                          <span className="text-[11px] text-zinc-500">{label}</span>
                          <span className="text-[11px] font-medium text-zinc-300 truncate max-w-[180px] text-right">{value}</span>
                        </div>
                      ))}
                      {/* Color swatches */}
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-zinc-500">Colors</span>
                        <div className="flex gap-1.5">
                          <div className="w-4 h-4 rounded-full border border-zinc-700" style={{ background: config.brand_primary_color }} title="Primary" />
                          <div className="w-4 h-4 rounded-full border border-zinc-700" style={{ background: config.brand_accent_color }} title="Accent" />
                        </div>
                      </div>
                    </div>
                  </Section>

                  <p className="text-[10px] text-zinc-600 leading-relaxed">
                    💡 The full guest experience (selfie upload, search results, photo grid) also inherits these colors and fonts.
                    Click the public link after saving to see the live result.
                  </p>
                </motion.div>
              )}

            </div>

            {/* ── Save error ── */}
            <AnimatePresence>
              {saveError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-5 overflow-hidden"
                >
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/8 border border-red-500/20 text-xs text-red-400">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    {saveError}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Footer actions ── */}
            <div className="flex gap-2 px-5 py-4 border-t border-zinc-800 flex-shrink-0">
              <button
                onClick={handleReset}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
              >
                <RotateCcw size={12} /> Reset
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-semibold transition-colors"
              >
                {saving ? (
                  <><Loader2 size={13} className="animate-spin" /> Saving…</>
                ) : saved ? (
                  <><Check size={13} /> Saved!</>
                ) : (
                  <><Check size={13} /> Save Branding</>
                )}
              </button>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

BrandingSettings.displayName = 'BrandingSettings';
export default BrandingSettings;