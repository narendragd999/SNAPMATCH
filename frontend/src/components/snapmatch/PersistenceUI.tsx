/**
 * SNAPMATCH Persistence UI Components
 * UI components for displaying persistence status and controls
 */

'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Clock, User, RefreshCw, Trash2, CheckCircle,
  Camera, AlertCircle, Info
} from 'lucide-react';
import { StoredSelfie, getSelfieDaysRemaining } from '@/lib/snapmatch/persistence';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedSelfieBannerProps {
  selfie: StoredSelfie | null;
  onUseDifferent: () => void;
  onClear: () => void;
  primaryColor?: string;
}

interface CachedResultsBannerProps {
  cacheAge: number | null;
  totalResults: number;
  onRefresh: () => void;
  primaryColor?: string;
}

interface RememberSelfieCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  primaryColor?: string;
}

interface AutoSearchIndicatorProps {
  primaryColor?: string;
}

interface DataManagementSectionProps {
  onClearSelfie: () => void;
  onClearCache: () => void;
  onClearAll: () => void;
  hasSelfie: boolean;
  cachedEventsCount: number;
  primaryColor?: string;
}

// ─── Saved Selfie Banner ──────────────────────────────────────────────────────

export const SavedSelfieBanner: React.FC<SavedSelfieBannerProps> = ({
  selfie,
  onUseDifferent,
  onClear,
  primaryColor = '#3b82f6',
}) => {
  if (!selfie) return null;

  const daysRemaining = getSelfieDaysRemaining();

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border mb-4"
      style={{
        background: `${primaryColor}08`,
        borderColor: `${primaryColor}25`,
      }}
    >
      {/* Selfie thumbnail */}
      <div
        className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 ring-2"
        style={{ borderColor: `${primaryColor}40` }}
      >
        <img
          src={selfie.thumbnailBase64}
          alt="Your selfie"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
          Using your saved selfie
        </p>
        <p className="text-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
          Valid for {daysRemaining} more {daysRemaining === 1 ? 'day' : 'days'} • Works across all events
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onUseDifferent}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: 'var(--brand-surface, #18181b)',
            border: '1px solid var(--brand-border, #27272a)',
            color: 'var(--brand-text, #f4f4f5)',
          }}
        >
          <Camera size={12} /> Use different
        </button>
        <button
          onClick={onClear}
          className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10"
          title="Remove saved selfie"
          style={{ color: 'var(--brand-subtext, #71717a)' }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
};

// ─── Cached Results Banner ────────────────────────────────────────────────────

export const CachedResultsBanner: React.FC<CachedResultsBannerProps> = ({
  cacheAge,
  totalResults,
  onRefresh,
  primaryColor = '#3b82f6',
}) => {
  if (cacheAge === null) return null;

  const formatAge = (ms: number): string => {
    const minutes = Math.floor(ms / (60 * 1000));
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 px-4 py-2.5 rounded-xl border mb-4"
      style={{
        background: `${primaryColor}08`,
        borderColor: `${primaryColor}20`,
      }}
    >
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${primaryColor}15` }}
      >
        <Clock size={16} style={{ color: primaryColor }} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
          <span className="font-medium">{totalResults} photos</span>
          <span style={{ color: 'var(--brand-subtext, #71717a)' }}> found • from {formatAge(cacheAge)}</span>
        </p>
      </div>

      {/* Refresh button */}
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: primaryColor,
          color: '#fff',
        }}
      >
        <RefreshCw size={12} /> Refresh
      </button>
    </motion.div>
  );
};

// ─── Remember Selfie Checkbox ──────────────────────────────────────────────────

export const RememberSelfieCheckbox: React.FC<RememberSelfieCheckboxProps> = ({
  checked,
  onChange,
  disabled = false,
  primaryColor = '#3b82f6',
}) => {
  return (
    <label
      className={`flex items-center gap-3 cursor-pointer select-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <div
          className={`w-5 h-5 rounded-md border-2 transition-all flex items-center justify-center ${
            checked ? '' : 'bg-transparent'
          }`}
          style={{
            borderColor: checked ? primaryColor : 'var(--brand-border, #27272a)',
            background: checked ? primaryColor : 'transparent',
          }}
        >
          {checked && (
            <CheckCircle size={14} className="text-white" strokeWidth={3} />
          )}
        </div>
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
          Remember my selfie for future events
        </p>
        <p className="text-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
          Stored locally for 30 days across all events
        </p>
      </div>
    </label>
  );
};

// ─── Auto Search Indicator ─────────────────────────────────────────────────────

export const AutoSearchIndicator: React.FC<AutoSearchIndicatorProps> = ({
  primaryColor = '#3b82f6',
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="flex flex-col items-center justify-center py-12 text-center"
    >
      <div className="relative mb-6">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="w-16 h-16 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: primaryColor,
            borderRightColor: `${primaryColor}40`,
          }}
        />
        <div
          className="absolute inset-0 flex items-center justify-center"
        >
          <User size={24} style={{ color: primaryColor }} />
        </div>
      </div>
      <p className="text-lg font-semibold mb-2" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
        Searching with your saved selfie...
      </p>
      <p className="text-sm" style={{ color: 'var(--brand-subtext, #71717a)' }}>
        Finding your photos across the event
      </p>
    </motion.div>
  );
};

// ─── Data Management Section ───────────────────────────────────────────────────

export const DataManagementSection: React.FC<DataManagementSectionProps> = ({
  onClearSelfie,
  onClearCache,
  onClearAll,
  hasSelfie,
  cachedEventsCount,
  primaryColor = '#3b82f6',
}) => {
  const [showConfirm, setShowConfirm] = React.useState<string | null>(null);

  const handleAction = (action: string, callback: () => void) => {
    if (showConfirm === action) {
      callback();
      setShowConfirm(null);
    } else {
      setShowConfirm(action);
    }
  };

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
        <AlertCircle size={14} style={{ color: primaryColor }} />
        Stored Data
      </h4>

      <div className="space-y-2">
        {/* Selfie status */}
        <div
          className="flex items-center justify-between p-3 rounded-xl border"
          style={{
            background: 'var(--brand-surface, #18181b)',
            borderColor: 'var(--brand-border, #27272a)',
          }}
        >
          <div className="flex items-center gap-3">
            <User size={16} style={{ color: 'var(--brand-subtext, #71717a)' }} />
            <div>
              <p className="text-sm" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                Saved Selfie
              </p>
              <p className="text-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                {hasSelfie ? 'Stored locally for cross-event use' : 'Not saved'}
              </p>
            </div>
          </div>
          {hasSelfie && (
            <button
              onClick={() => handleAction('selfie', onClearSelfie)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showConfirm === 'selfie'
                  ? 'bg-red-500 text-white'
                  : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
              }`}
            >
              {showConfirm === 'selfie' ? 'Confirm' : 'Remove'}
            </button>
          )}
        </div>

        {/* Cache status */}
        <div
          className="flex items-center justify-between p-3 rounded-xl border"
          style={{
            background: 'var(--brand-surface, #18181b)',
            borderColor: 'var(--brand-border, #27272a)',
          }}
        >
          <div className="flex items-center gap-3">
            <Clock size={16} style={{ color: 'var(--brand-subtext, #71717a)' }} />
            <div>
              <p className="text-sm" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
                Search Cache
              </p>
              <p className="text-xs" style={{ color: 'var(--brand-subtext, #71717a)' }}>
                {cachedEventsCount > 0
                  ? `${cachedEventsCount} event${cachedEventsCount !== 1 ? 's' : ''} cached`
                  : 'No cached searches'}
              </p>
            </div>
          </div>
          {cachedEventsCount > 0 && (
            <button
              onClick={() => handleAction('cache', onClearCache)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showConfirm === 'cache'
                  ? 'bg-red-500 text-white'
                  : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
              }`}
            >
              {showConfirm === 'cache' ? 'Confirm' : 'Clear'}
            </button>
          )}
        </div>
      </div>

      {/* Clear all button */}
      {(hasSelfie || cachedEventsCount > 0) && (
        <button
          onClick={() => handleAction('all', onClearAll)}
          className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
            showConfirm === 'all'
              ? 'bg-red-500 text-white'
              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
          }`}
        >
          {showConfirm === 'all' ? 'Tap again to clear all data' : 'Clear All Stored Data'}
        </button>
      )}

      {/* Privacy note */}
      <p
        className="text-xs text-center pt-2"
        style={{ color: 'var(--brand-subtext, #71717a)' }}
      >
        <Info size={10} className="inline mr-1" />
        Your data is stored locally on your device only. We do not store your selfie on our servers.
      </p>
    </div>
  );
};

// ─── Persistence Status Pill ───────────────────────────────────────────────────

interface PersistenceStatusPillProps {
  hasSelfie: boolean;
  daysRemaining: number;
  onClick?: () => void;
  primaryColor?: string;
}

export const PersistenceStatusPill: React.FC<PersistenceStatusPillProps> = ({
  hasSelfie,
  daysRemaining,
  onClick,
  primaryColor = '#3b82f6',
}) => {
  if (!hasSelfie) return null;

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
      style={{
        background: `${primaryColor}15`,
        color: primaryColor,
        border: `1px solid ${primaryColor}30`,
      }}
    >
      <User size={11} />
      Selfie saved ({daysRemaining}d)
    </button>
  );
};

// ─── Export All ───────────────────────────────────────────────────────────────

export default {
  SavedSelfieBanner,
  CachedResultsBanner,
  RememberSelfieCheckbox,
  AutoSearchIndicator,
  DataManagementSection,
  PersistenceStatusPill,
};