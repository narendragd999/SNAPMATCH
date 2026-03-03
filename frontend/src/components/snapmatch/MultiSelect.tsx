/**
 * MultiSelectMode Component
 * Batch selection, download, and sharing functionality
 */

'use client';

import React, { memo, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, X, Download, Share2, Trash2, 
  CheckCircle2, Package, Loader2 
} from 'lucide-react';
import { hapticFeedback, downloadBlob } from '@/lib/snapmatch/utils';
import { SelectionCheckbox, SelectionOverlay } from './UIComponents';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MultiSelectManagerProps {
  items: unknown[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchDownload: () => Promise<void>;
  onBatchShare?: () => void;
  onBatchDelete?: () => void;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}

// ─── MultiSelectToolbar ────────────────────────────────────────────────────────

export const MultiSelectToolbar: React.FC<MultiSelectManagerProps> = memo(({
  selectedIds,
  onSelectAll,
  onClearSelection,
  onBatchDownload,
  onBatchShare,
  isActive,
  onActivate,
  onDeactivate,
}) => {
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const count = selectedIds.size;

  const handleBatchDownload = async () => {
    setDownloadStatus('loading');
    hapticFeedback('medium');
    try {
      await onBatchDownload();
      setDownloadStatus('success');
      hapticFeedback('success');
      setTimeout(() => setDownloadStatus('idle'), 2000);
    } catch (error) {
      console.error('Batch download failed:', error);
      setDownloadStatus('idle');
    }
  };

  if (!isActive) {
    return (
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onActivate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 10,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          color: 'rgba(255,255,255,0.55)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        aria-label="Enter selection mode"
      >
        <Check size={14} />
        Select
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        borderRadius: 14,
        background: 'rgba(232,201,126,0.1)',
        border: '1px solid rgba(232,201,126,0.2)',
        backdropFilter: 'blur(10px)',
      }}
    >
      {/* Selection count */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 12px',
        borderRadius: 8,
        background: 'rgba(232,201,126,0.15)',
      }}>
        <CheckCircle2 size={14} color="#e8c97e" />
        <span style={{
          fontSize: 13,
          fontWeight: 700,
          color: '#e8c97e',
        }}>
          {count} selected
        </span>
      </div>

      {/* Select All / Clear */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={count > 0 ? onClearSelection : onSelectAll}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.05)',
          border: 'none',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {count > 0 ? 'Clear' : 'Select all'}
      </motion.button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Download */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleBatchDownload}
          disabled={count === 0 || downloadStatus === 'loading'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 10,
            background: count > 0 
              ? 'linear-gradient(135deg, #e8c97e, #c88c25)' 
              : 'rgba(255,255,255,0.05)',
            border: 'none',
            color: count > 0 ? '#0a0808' : 'rgba(255,255,255,0.3)',
            fontSize: 13,
            fontWeight: 600,
            cursor: count > 0 && downloadStatus !== 'loading' ? 'pointer' : 'not-allowed',
            opacity: count === 0 ? 0.6 : 1,
            boxShadow: count > 0 ? '0 4px 20px rgba(232,201,126,0.3)' : 'none',
          }}
          aria-label={`Download ${count} photos`}
        >
          <AnimatePresence mode="wait">
            {downloadStatus === 'loading' ? (
              <motion.div
                key="loading"
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: 360 }}
                transition={{ rotate: { repeat: Infinity, duration: 1, ease: 'linear' } }}
              >
                <Loader2 size={14} color="#0a0808" />
              </motion.div>
            ) : downloadStatus === 'success' ? (
              <motion.div
                key="success"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
              >
                <Check size={14} color="#0a0808" />
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
              >
                <Package size={14} />
              </motion.div>
            )}
          </AnimatePresence>
          {downloadStatus === 'loading' ? 'Preparing...' : downloadStatus === 'success' ? 'Done!' : `Download (${count})`}
        </motion.button>

        {/* Share */}
        {onBatchShare && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onBatchShare}
            disabled={count === 0}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.05)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: count > 0 ? 'pointer' : 'not-allowed',
              opacity: count === 0 ? 0.4 : 1,
            }}
            aria-label="Share selected photos"
          >
            <Share2 size={14} color="rgba(255,255,255,0.7)" />
          </motion.button>
        )}

        {/* Close selection mode */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onDeactivate}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.05)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label="Exit selection mode"
        >
          <X size={14} color="rgba(255,255,255,0.7)" />
        </motion.button>
      </div>
    </motion.div>
  );
});

MultiSelectToolbar.displayName = 'MultiSelectToolbar';

// ─── SelectablePhotoCard ───────────────────────────────────────────────────────

interface SelectablePhotoCardProps {
  item: unknown;
  imageId: string;
  imageUrl: string;
  thumbnailUrl: string;
  isSelected: boolean;
  selectionIndex: number;
  isSelectMode: boolean;
  onToggle: () => void;
  onClick: () => void;
  scene?: string;
  confidence?: number;
  showConfidence?: boolean;
  children?: React.ReactNode;
}

export const SelectablePhotoCard: React.FC<SelectablePhotoCardProps> = memo(({
  imageId,
  thumbnailUrl,
  isSelected,
  selectionIndex,
  isSelectMode,
  onToggle,
  onClick,
  scene,
  confidence,
  showConfidence = false,
  children,
}) => {
  const handleClick = useCallback(() => {
    if (isSelectMode) {
      hapticFeedback('light');
      onToggle();
    } else {
      onClick();
    }
  }, [isSelectMode, onToggle, onClick]);

  return (
    <motion.div
      className="photo-card"
      onClick={handleClick}
      whileHover={{ scale: isSelectMode ? 1.01 : 1.028 }}
      whileTap={{ scale: 0.98 }}
      style={{
        aspectRatio: '1',
        cursor: 'pointer',
        overflow: 'hidden',
        borderRadius: 12,
        position: 'relative',
        background: '#111',
        border: isSelected 
          ? '2px solid #e8c97e' 
          : '1px solid rgba(255,255,255,0.07)',
        transition: 'transform 0.22s ease, box-shadow 0.22s ease',
        boxShadow: isSelected 
          ? '0 0 0 2px rgba(232,201,126,0.3), 0 8px 32px rgba(0,0,0,0.4)' 
          : 'none',
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${isSelected ? 'Deselect' : 'Select'} photo`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {/* Image */}
      <img
        src={thumbnailUrl}
        alt=""
        loading="lazy"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          opacity: isSelectMode && !isSelected ? 0.7 : 1,
          transition: 'opacity 0.2s',
        }}
      />

      {/* Selection overlay */}
      <AnimatePresence>
        {isSelected && (
          <SelectionOverlay selected={isSelected} index={selectionIndex} />
        )}
      </AnimatePresence>

      {/* Selection checkbox */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          opacity: isSelectMode || isSelected ? 1 : 0,
          transition: 'opacity 0.2s',
        }}
      >
        <SelectionCheckbox selected={isSelected} onToggle={onToggle} />
      </div>

      {/* Scene badge */}
      {scene && !isSelectMode && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '3px 8px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.62)',
            backdropFilter: 'blur(8px)',
            fontSize: 10,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.85)',
            textTransform: 'capitalize',
            letterSpacing: '0.04em',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {scene}
        </div>
      )}

      {/* Confidence badge */}
      {showConfidence && confidence && !isSelectMode && (
        <div style={{ position: 'absolute', bottom: 8, left: 8 }}>
          {/* ConfidenceBadge would go here */}
        </div>
      )}

      {/* Hover overlay (non-select mode) */}
      {!isSelectMode && (
        <div
          className="photo-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 55%)',
            opacity: 0,
            transition: 'opacity 0.2s',
          }}
        >
          {children}
        </div>
      )}
    </motion.div>
  );
});

SelectablePhotoCard.displayName = 'SelectablePhotoCard';

// ─── useMultiSelect Hook ──────────────────────────────────────────────────────

export const useMultiSelect = <T extends { id?: string; image_name?: string }>(
  items: T[]
) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);

  const getId = useCallback((item: T): string => {
    return item.id ?? item.image_name ?? '';
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map(getId)));
    hapticFeedback('medium');
  }, [items, getId]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    hapticFeedback('light');
  }, []);

  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true);
    hapticFeedback('light');
  }, []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const selectionOrder = useMemo(() => {
    return Array.from(selectedIds);
  }, [selectedIds]);

  const getSelectionIndex = useCallback((id: string): number => {
    return selectionOrder.indexOf(id);
  }, [selectionOrder]);

  return {
    selectedIds,
    isSelectMode,
    toggle,
    selectAll,
    clearSelection,
    enterSelectMode,
    exitSelectMode,
    getSelectionIndex,
    selectionOrder,
    getId,
    count: selectedIds.size,
  };
};

export default {
  MultiSelectToolbar,
  SelectablePhotoCard,
  useMultiSelect,
};
