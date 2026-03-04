/**
 * WatermarkSettings Component
 * Configure and preview custom watermarks for photos (Pro feature)
 */

'use client';

import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Droplet, X, Upload, Type, Image as ImageIcon,
  Settings, RotateCcw, Check, Eye, ChevronDown, Sparkles,
} from 'lucide-react';
import {
  WatermarkConfig,
  WatermarkPosition,
  DEFAULT_WATERMARK_CONFIG,
  WATERMARK_POSITIONS,
  saveWatermarkConfig,
  loadWatermarkConfig,
  generateWatermarkPreview,
} from '@/lib/snapmatch/watermark';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatermarkSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: WatermarkConfig) => void;
  previewImageUrl?: string;
}

// ─── Position Grid Selector ───────────────────────────────────────────────────

interface PositionSelectorProps {
  value: WatermarkPosition;
  onChange: (position: WatermarkPosition) => void;
}

const PositionSelector: React.FC<PositionSelectorProps> = memo(({ value, onChange }) => {
  const positions: WatermarkPosition[][] = [
    ['top-left',    'top-center',    'top-right'],
    ['center-left', 'center',        'center-right'],
    ['bottom-left', 'bottom-center', 'bottom-right'],
  ];

  return (
    <div className="grid grid-cols-3 gap-1 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
      {positions.flat().map((pos) => (
        <button
          key={pos}
          onClick={() => onChange(pos)}
          title={WATERMARK_POSITIONS.find(p => p.value === pos)?.label}
          className={`h-9 rounded-lg flex items-center justify-center transition-colors ${
            value === pos
              ? 'bg-blue-500/20 border border-blue-500/40'
              : 'hover:bg-zinc-700/60 border border-transparent'
          }`}
        >
          <div className={`w-2 h-2 rounded-full transition-colors ${
            value === pos ? 'bg-blue-400' : 'bg-zinc-600'
          }`} />
        </button>
      ))}
    </div>
  );
});

PositionSelector.displayName = 'PositionSelector';

// ─── Slider Component ─────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}

const Slider: React.FC<SliderProps> = memo(({ label, value, onChange, min, max, step = 1, suffix = '' }) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1.5 mb-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        <span className="text-xs font-semibold text-blue-400 tabular-nums">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, rgb(96 165 250) ${percentage}%, rgb(39 39 42) ${percentage}%)`,
        }}
      />
    </div>
  );
});

Slider.displayName = 'Slider';

// ─── Toggle Switch ────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange }) => (
  <button
    onClick={onChange}
    className={`relative w-10 h-5 rounded-full border transition-colors flex-shrink-0 ${
      checked
        ? 'bg-blue-600 border-blue-500'
        : 'bg-zinc-700 border-zinc-600'
    }`}
  >
    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
      checked ? 'left-[22px]' : 'left-0.5'
    }`} />
  </button>
);

// ─── Main WatermarkSettings Component ─────────────────────────────────────────

export const WatermarkSettings: React.FC<WatermarkSettingsProps> = memo(({
  isOpen,
  onClose,
  onSave,
  previewImageUrl,
}) => {
  const [config, setConfig]           = useState<WatermarkConfig>(DEFAULT_WATERMARK_CONFIG);
  const [activeTab, setActiveTab]     = useState<'text' | 'logo'>('text');
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showAdvanced, setShowAdvanced]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saved config on mount
  useEffect(() => {
    if (isOpen) {
      const saved = loadWatermarkConfig();
      setConfig(saved);
      setActiveTab(saved.type);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Generate preview when config changes
  useEffect(() => {
    if (!isOpen || !previewImageUrl || !config.enabled) {
      setPreviewUrl(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const url = await generateWatermarkPreview(previewImageUrl, config);
        setPreviewUrl(url);
      } catch { /* noop */ } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen, previewImageUrl, config]);

  const updateConfig = useCallback(<K extends keyof WatermarkConfig>(key: K, value: WatermarkConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      updateConfig('logoUrl', dataUrl);
      updateConfig('type', 'logo');
      setActiveTab('logo');
    };
    reader.readAsDataURL(file);
  }, [updateConfig]);

  const handleSave = useCallback(() => {
    saveWatermarkConfig(config);
    onSave(config);
    onClose();
  }, [config, onSave, onClose]);

  const handleReset = useCallback(() => {
    setConfig(DEFAULT_WATERMARK_CONFIG);
    setActiveTab('text');
  }, []);

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
            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden w-full max-w-md max-h-[90vh] flex flex-col"
          >

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                  <Droplet size={13} className="text-violet-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-100 leading-none">Watermark</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Pro feature · Add your branding</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <X size={12} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">

              {/* Enable toggle row */}
              <div className={`flex items-center justify-between px-3.5 py-3 rounded-xl border transition-colors ${
                config.enabled
                  ? 'bg-blue-500/8 border-blue-500/20'
                  : 'bg-zinc-800/50 border-zinc-700/60'
              }`}>
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className={config.enabled ? 'text-blue-400' : 'text-zinc-500'} />
                  <span className={`text-xs font-medium ${config.enabled ? 'text-zinc-100' : 'text-zinc-400'}`}>
                    Enable Watermark
                  </span>
                </div>
                <Toggle checked={config.enabled} onChange={() => updateConfig('enabled', !config.enabled)} />
              </div>

              {/* Type tabs */}
              <div className="flex bg-zinc-950 border border-zinc-800 rounded-xl p-1 gap-1">
                <button
                  onClick={() => { setActiveTab('text'); updateConfig('type', 'text'); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === 'text'
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <Type size={12} /> Text
                </button>
                <button
                  onClick={() => { setActiveTab('logo'); updateConfig('type', 'logo'); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    activeTab === 'logo'
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <ImageIcon size={12} /> Logo
                </button>
              </div>

              {/* ── Text tab ── */}
              {activeTab === 'text' && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 space-y-1"
                >
                  {/* Text input */}
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Watermark Text
                    </label>
                    <input
                      type="text"
                      value={config.text || ''}
                      onChange={(e) => updateConfig('text', e.target.value)}
                      placeholder="© Your Brand Name"
                      className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 text-xs placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                    />
                  </div>

                  <Slider label="Text Size"  value={config.textSize}    onChange={(v) => updateConfig('textSize', v)}    min={1}  max={8}   step={0.5} suffix="%" />
                  <Slider label="Opacity"    value={config.textOpacity} onChange={(v) => updateConfig('textOpacity', v)} min={20} max={100}            suffix="%" />

                  {/* Color + Font row */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Color</label>
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700">
                        <input
                          type="color"
                          value={config.textColor}
                          onChange={(e) => updateConfig('textColor', e.target.value)}
                          className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                        />
                        <span className="text-xs text-zinc-400 font-mono">{config.textColor}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1.5">Font</label>
                      <select
                        value={config.textFont}
                        onChange={(e) => updateConfig('textFont', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs focus:outline-none focus:border-zinc-500 transition-colors"
                      >
                        <option value="Arial, sans-serif">Arial</option>
                        <option value="Georgia, serif">Georgia</option>
                        <option value="'Courier New', monospace">Courier</option>
                        <option value="'Times New Roman', serif">Times</option>
                        <option value="Verdana, sans-serif">Verdana</option>
                      </select>
                    </div>
                  </div>

                  {/* Position */}
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Position</label>
                    <PositionSelector value={config.textPosition} onChange={(pos) => updateConfig('textPosition', pos)} />
                  </div>
                </motion.div>
              )}

              {/* ── Logo tab ── */}
              {activeTab === 'logo' && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 space-y-1"
                >
                  {/* Logo upload */}
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Logo Image</label>
                    {config.logoUrl ? (
                      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700">
                        <img src={config.logoUrl} alt="Logo" className="w-8 h-8 rounded object-contain bg-white/5" />
                        <span className="text-xs text-zinc-400 flex-1 truncate">Logo uploaded</span>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors flex-shrink-0"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex flex-col items-center gap-2 py-6 rounded-xl border-2 border-dashed border-zinc-700 hover:border-zinc-600 transition-colors text-center"
                      >
                        <Upload size={20} className="text-zinc-600" />
                        <div>
                          <p className="text-xs font-medium text-zinc-400">Click to upload logo</p>
                          <p className="text-[10px] text-zinc-600 mt-0.5">PNG with transparency recommended</p>
                        </div>
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                  </div>

                  <Slider label="Logo Size" value={config.logoSize}    onChange={(v) => updateConfig('logoSize', v)}    min={5}  max={40}  suffix="%" />
                  <Slider label="Opacity"   value={config.logoOpacity} onChange={(v) => updateConfig('logoOpacity', v)} min={20} max={100} suffix="%" />

                  {/* Position */}
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Position</label>
                    <PositionSelector value={config.logoPosition} onChange={(pos) => updateConfig('logoPosition', pos)} />
                  </div>
                </motion.div>
              )}

              {/* ── Advanced Settings ── */}
              <div className="border border-zinc-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Settings size={12} />
                    Advanced Settings
                  </span>
                  <ChevronDown
                    size={13}
                    className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  />
                </button>

                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pt-1 pb-4 border-t border-zinc-800 space-y-1">
                        <Slider label="Padding"  value={config.padding}  onChange={(v) => updateConfig('padding', v)}  min={0}    max={100} suffix="px" />
                        <Slider label="Rotation" value={config.rotation} onChange={(v) => updateConfig('rotation', v)} min={-180} max={180} suffix="°" />

                        {/* Tile toggle */}
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xs text-zinc-400">Tile watermark across image</span>
                          <Toggle checked={config.tile} onChange={() => updateConfig('tile', !config.tile)} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Preview ── */}
              {previewImageUrl && config.enabled && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 mb-2">
                    <Eye size={12} /> Preview
                  </label>
                  <div className="aspect-video rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center relative">
                    {previewLoading ? (
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <div className="w-3 h-3 border border-zinc-600 border-t-blue-400 rounded-full animate-spin" />
                        Generating preview…
                      </div>
                    ) : previewUrl ? (
                      <img src={previewUrl} alt="Watermark preview" className="w-full h-full object-contain" />
                    ) : (
                      <p className="text-xs text-zinc-600">No preview available</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Tip ── */}
              <p className="text-[10px] text-zinc-600 leading-relaxed">
                💡 Keep opacity between 40–70% for subtle branding. Position in corners to avoid obscuring subjects.
              </p>

            </div>

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
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                <Check size={13} /> Save Watermark
              </button>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

WatermarkSettings.displayName = 'WatermarkSettings';

export default WatermarkSettings;