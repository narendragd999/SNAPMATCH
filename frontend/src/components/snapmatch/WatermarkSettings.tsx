/**
 * WatermarkSettings Component
 * Configure and preview custom watermarks for photos (Pro feature)
 */

'use client';

import React, { memo, useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Droplet, X, Upload, Type, Image as ImageIcon, 
  Settings, RotateCcw, Check, Eye,
  ChevronDown, Info, Sparkles
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
    ['top-left', 'top-center', 'top-right'],
    ['center-left', 'center', 'center-right'],
    ['bottom-left', 'bottom-center', 'bottom-right'],
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 4,
      padding: 4,
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 12,
    }}>
      {positions.flat().map((pos) => (
        <button
          key={pos}
          onClick={() => onChange(pos)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            border: value === pos ? '2px solid rgba(232,201,126,0.8)' : '2px solid transparent',
            background: value === pos ? 'rgba(232,201,126,0.2)' : 'rgba(255,255,255,0.05)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
          }}
          title={WATERMARK_POSITIONS.find(p => p.value === pos)?.label}
        >
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: value === pos ? '#e8c97e' : 'rgba(255,255,255,0.3)',
          }} />
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
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500 }}>{label}</span>
        <span style={{ color: '#e8c97e', fontSize: 12, fontWeight: 600 }}>{value}{suffix}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '100%',
            height: 6,
            appearance: 'none',
            background: `linear-gradient(to right, rgba(232,201,126,0.6) ${percentage}%, rgba(255,255,255,0.1) ${percentage}%)`,
            borderRadius: 3,
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
});

Slider.displayName = 'Slider';

// ─── Main WatermarkSettings Component ─────────────────────────────────────────

export const WatermarkSettings: React.FC<WatermarkSettingsProps> = memo(({
  isOpen,
  onClose,
  onSave,
  previewImageUrl,
}) => {
  const [config, setConfig] = useState<WatermarkConfig>(DEFAULT_WATERMARK_CONFIG);
  const [activeTab, setActiveTab] = useState<'text' | 'logo'>('text');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saved config on mount
  useEffect(() => {
    if (isOpen) {
      const saved = loadWatermarkConfig();
      setConfig(saved);
      setActiveTab(saved.type);
    }
  }, [isOpen]);

  // Generate preview when config changes
  useEffect(() => {
    if (!isOpen || !previewImageUrl || !config.enabled) {
      setPreviewUrl(null);
      return;
    }

    const debounceTimer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const url = await generateWatermarkPreview(previewImageUrl, config);
        setPreviewUrl(url);
      } catch (error) {
        console.error('Preview generation failed:', error);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [isOpen, previewImageUrl, config]);

  // Update config helper
  const updateConfig = useCallback(<K extends keyof WatermarkConfig>(key: K, value: WatermarkConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  // Handle logo upload
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

  // Handle save
  const handleSave = useCallback(() => {
    saveWatermarkConfig(config);
    onSave(config);
    onClose();
  }, [config, onSave, onClose]);

  // Reset to defaults
  const handleReset = useCallback(() => {
    setConfig(DEFAULT_WATERMARK_CONFIG);
    setActiveTab('text');
  }, []);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'linear-gradient(180deg, rgba(17,17,27,0.98) 0%, rgba(9,9,15,0.98) 100%)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 24,
            maxWidth: 560,
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))',
                border: '1px solid rgba(139,92,246,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Droplet size={20} color="#a78bfa" />
              </div>
              <div>
                <h3 style={{ color: '#fff', fontSize: 18, fontWeight: 600, margin: 0 }}>
                  Custom Watermark
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
                  Pro Feature - Add your branding
                </p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onClose}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              <X size={18} />
            </motion.button>
          </div>

          {/* Content */}
          <div style={{ padding: '24px' }}>
            {/* Enable Toggle */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 20,
              padding: '12px 16px',
              background: config.enabled ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.03)',
              border: config.enabled ? '1px solid rgba(74,222,128,0.2)' : '1px solid rgba(255,255,255,0.07)',
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Sparkles size={18} color={config.enabled ? '#4ade80' : 'rgba(255,255,255,0.4)'} />
                <span style={{ color: config.enabled ? '#fff' : 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
                  Enable Watermark
                </span>
              </div>
              <button
                onClick={() => updateConfig('enabled', !config.enabled)}
                style={{
                  width: 48,
                  height: 26,
                  borderRadius: 13,
                  background: config.enabled ? '#4ade80' : 'rgba(255,255,255,0.1)',
                  border: 'none',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: config.enabled ? 24 : 2,
                  transition: 'left 0.2s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>

            {/* Tab Selector */}
            <div style={{
              display: 'flex',
              gap: 8,
              marginBottom: 20,
            }}>
              <button
                onClick={() => { setActiveTab('text'); updateConfig('type', 'text'); }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px',
                  borderRadius: 12,
                  background: activeTab === 'text' ? 'rgba(232,201,126,0.15)' : 'rgba(255,255,255,0.03)',
                  border: activeTab === 'text' ? '1px solid rgba(232,201,126,0.3)' : '1px solid rgba(255,255,255,0.07)',
                  color: activeTab === 'text' ? '#e8c97e' : 'rgba(255,255,255,0.6)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <Type size={16} /> Text Watermark
              </button>
              <button
                onClick={() => { setActiveTab('logo'); updateConfig('type', 'logo'); }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px',
                  borderRadius: 12,
                  background: activeTab === 'logo' ? 'rgba(232,201,126,0.15)' : 'rgba(255,255,255,0.03)',
                  border: activeTab === 'logo' ? '1px solid rgba(232,201,126,0.3)' : '1px solid rgba(255,255,255,0.07)',
                  color: activeTab === 'logo' ? '#e8c97e' : 'rgba(255,255,255,0.6)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <ImageIcon size={16} /> Logo Watermark
              </button>
            </div>

            {/* Text Watermark Settings */}
            {activeTab === 'text' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  padding: '16px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 16,
                  marginBottom: 20,
                }}
              >
                {/* Text Input */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                    Watermark Text
                  </label>
                  <input
                    type="text"
                    value={config.text || ''}
                    onChange={(e) => updateConfig('text', e.target.value)}
                    placeholder="© Your Brand Name"
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#fff',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Text Size */}
                <Slider
                  label="Text Size"
                  value={config.textSize}
                  onChange={(v) => updateConfig('textSize', v)}
                  min={1}
                  max={8}
                  step={0.5}
                  suffix="%"
                />

                {/* Text Opacity */}
                <Slider
                  label="Opacity"
                  value={config.textOpacity}
                  onChange={(v) => updateConfig('textOpacity', v)}
                  min={20}
                  max={100}
                  suffix="%"
                />

                {/* Position */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
                    Position
                  </label>
                  <PositionSelector
                    value={config.textPosition}
                    onChange={(pos) => updateConfig('textPosition', pos)}
                  />
                </div>
              </motion.div>
            )}

            {/* Logo Watermark Settings */}
            {activeTab === 'logo' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  padding: '16px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 16,
                  marginBottom: 20,
                }}
              >
                {/* Logo Upload */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                    Logo Image
                  </label>
                  
                  {config.logoUrl ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        background: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}>
                        <img 
                          src={config.logoUrl} 
                          alt="Logo" 
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} 
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ color: '#fff', fontSize: 13, fontWeight: 500, margin: 0 }}>Logo uploaded</p>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: 0 }}>PNG with transparency recommended</p>
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                          padding: '6px 12px',
                          borderRadius: 6,
                          background: 'rgba(232,201,126,0.15)',
                          border: '1px solid rgba(232,201,126,0.3)',
                          color: '#e8c97e',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        padding: '32px',
                        border: '2px dashed rgba(255,255,255,0.15)',
                        borderRadius: 12,
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      <Upload size={32} color="rgba(255,255,255,0.3)" style={{ margin: '0 auto 12px' }} />
                      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                        Click to upload logo
                      </p>
                      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: 0 }}>
                        PNG with transparency recommended
                      </p>
                    </div>
                  )}
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleLogoUpload}
                  />
                </div>

                {/* Logo Size */}
                <Slider
                  label="Logo Size"
                  value={config.logoSize}
                  onChange={(v) => updateConfig('logoSize', v)}
                  min={5}
                  max={40}
                  suffix="%"
                />

                {/* Logo Opacity */}
                <Slider
                  label="Opacity"
                  value={config.logoOpacity}
                  onChange={(v) => updateConfig('logoOpacity', v)}
                  min={20}
                  max={100}
                  suffix="%"
                />

                {/* Position */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
                    Position
                  </label>
                  <PositionSelector
                    value={config.logoPosition}
                    onChange={(pos) => updateConfig('logoPosition', pos)}
                  />
                </div>
              </motion.div>
            )}

            {/* Advanced Settings */}
            <div style={{ marginBottom: 20 }}>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 10,
                  cursor: 'pointer',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Settings size={16} /> Advanced Settings
                </span>
                <ChevronDown 
                  size={16} 
                  style={{ 
                    transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0)',
                    transition: 'transform 0.2s',
                  }} 
                />
              </button>
              
              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{
                      padding: '16px',
                      background: 'rgba(255,255,255,0.02)',
                      borderRadius: '0 0 10px 10px',
                      marginTop: -1,
                    }}
                  >
                    {/* Padding */}
                    <Slider
                      label="Padding"
                      value={config.padding}
                      onChange={(v) => updateConfig('padding', v)}
                      min={0}
                      max={100}
                      suffix="px"
                    />

                    {/* Rotation */}
                    <Slider
                      label="Rotation"
                      value={config.rotation}
                      onChange={(v) => updateConfig('rotation', v)}
                      min={-180}
                      max={180}
                      suffix="°"
                    />

                    {/* Tile Mode */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 8,
                    }}>
                      <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>Tile watermark across image</span>
                      <button
                        onClick={() => updateConfig('tile', !config.tile)}
                        style={{
                          width: 44,
                          height: 24,
                          borderRadius: 12,
                          background: config.tile ? '#e8c97e' : 'rgba(255,255,255,0.1)',
                          border: 'none',
                          cursor: 'pointer',
                          position: 'relative',
                        }}
                      >
                        <div style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: '#fff',
                          position: 'absolute',
                          top: 2,
                          left: config.tile ? 22 : 2,
                          transition: 'left 0.2s',
                        }} />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Preview */}
            {previewImageUrl && config.enabled && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
                  <Eye size={14} /> Preview
                </label>
                <div style={{
                  aspectRatio: '4/3',
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: 'rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                }}>
                  {previewLoading ? (
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Generating preview...</div>
                  ) : previewUrl ? (
                    <img 
                      src={previewUrl} 
                      alt="Watermark Preview" 
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                    />
                  ) : (
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                      Configure watermark to see preview
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Help Text */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: 14,
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 12,
              marginBottom: 20,
            }}>
              <Info size={16} color="#818cf8" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ color: '#fff', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  Watermark Tips
                </p>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                  Use PNG logos with transparency for best results. Keep opacity between 40-70% for subtle branding. Position in corners to avoid obscuring subjects.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleReset}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '14px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={16} /> Reset
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSave}
                style={{
                  flex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '14px',
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #e8c97e, #c88c25)',
                  border: 'none',
                  color: '#0a0808',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <Check size={18} /> Save Watermark
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

WatermarkSettings.displayName = 'WatermarkSettings';

export default WatermarkSettings;