'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, Square, Download, X, Check, Users, Loader2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhotoItem {
  image_name?: string;
  total_faces?: number;   // Total faces detected in photo
  other_faces?: number;  // Faces other than the matched user
  [key: string]: unknown;
}

interface MultiSelectState {
  isSelectMode: boolean;
  selectedIds: Set<string>;
  selectionOrder: string[];
  count: number;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  toggle: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  getSelectionIndex: (id: string) => number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMultiSelect(items: PhotoItem[]): MultiSelectState {
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);

  const enterSelectMode = useCallback(() => setIsSelectMode(true), []);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
    setSelectionOrder([]);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectionOrder(o => o.filter(x => x !== id));
      } else {
        next.add(id);
        setSelectionOrder(o => [...o, id]);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const ids = items.map(i => i.image_name ?? '').filter(Boolean);
    setSelectedIds(new Set(ids));
    setSelectionOrder(ids);
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionOrder([]);
  }, []);

  const getSelectionIndex = useCallback(
    (id: string) => selectionOrder.indexOf(id) + 1,
    [selectionOrder]
  );

  return {
    isSelectMode,
    selectedIds,
    selectionOrder,
    count: selectedIds.size,
    enterSelectMode,
    exitSelectMode,
    toggle,
    selectAll,
    clearSelection,
    getSelectionIndex,
  };
}

// ─── MultiSelectToolbar ───────────────────────────────────────────────────────

interface MultiSelectToolbarProps {
  items: PhotoItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBatchDownload: () => void;
  isActive: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  isDownloading?: boolean;  // Loading state for download
  totalCount?: number;      // Total items count for "Download All"
  onDownloadAll?: () => void; // Download all items
  primaryColor?: string;    // Brand primary color
}

export function MultiSelectToolbar({
  items,
  selectedIds,
  onSelectAll,
  onClearSelection,
  onBatchDownload,
  isActive,
  onActivate,
  onDeactivate,
  isDownloading = false,
  totalCount,
  onDownloadAll,
  primaryColor = '#3b82f6',
}: MultiSelectToolbarProps) {
  const count = selectedIds.size;
  const total = totalCount ?? items.length;
  const allSelected = count === total && total > 0;

  /* ── Inactive: Default mode with Select + Download All buttons ── */
  if (!isActive) {
    return (
      <div className="flex items-center gap-2">
        {/* Select Mode button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onActivate}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors"
          style={{
            background: 'var(--brand-surface, #18181b)',
            borderColor: 'var(--brand-border, #27272a)',
            color: 'var(--brand-text, #f4f4f5)',
          }}
        >
          <CheckSquare size={13} style={{ color: primaryColor }} />
          Select
        </motion.button>
        
        {/* Download All button */}
        {onDownloadAll && total > 0 && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={onDownloadAll}
            disabled={isDownloading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50"
            style={{ background: primaryColor }}
          >
            {isDownloading ? (
              <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={13} /></motion.div> Preparing…</>
            ) : (
              <><Download size={13} /> Download All ({total})</>
            )}
          </motion.button>
        )}
      </div>
    );
  }

  /* ── Active: Select mode toolbar ── */
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl border flex-wrap"
      style={{
        background: 'var(--brand-surface, #0d0d10)',
        borderColor: 'var(--brand-border, #27272a)',
      }}
    >
      {/* Cancel button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={onDeactivate}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: 'var(--brand-border, #27272a)',
          color: 'var(--brand-subtext, #71717a)',
        }}
      >
        <X size={12} />
        Cancel
      </motion.button>

      {/* Divider */}
      <div className="w-px h-5 bg-zinc-700" />

      {/* Selected count indicator */}
      <div className="flex items-center gap-1.5">
        <div 
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ 
            background: `${primaryColor}20`,
            border: `1px solid ${primaryColor}40`,
          }}
        >
          <div className="w-2 h-2 rounded-full" style={{ background: primaryColor }} />
        </div>
        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--brand-text, #f4f4f5)' }}>
          {count} selected
        </span>
      </div>

      {/* Select all / Deselect all */}
      <button
        onClick={allSelected ? onClearSelection : onSelectAll}
        className="text-xs font-medium transition-colors whitespace-nowrap"
        style={{ color: 'var(--brand-subtext, #71717a)' }}
        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--brand-text, #f4f4f5)'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--brand-subtext, #71717a)'}
      >
        {allSelected ? 'Deselect all' : `Select all (${total})`}
      </button>

      {/* Clear selection (only when some selected) */}
      {count > 0 && !allSelected && (
        <button
          onClick={onClearSelection}
          className="text-xs font-medium transition-colors whitespace-nowrap"
          style={{ color: 'var(--brand-subtext, #71717a)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--brand-text, #f4f4f5)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--brand-subtext, #71717a)'}
        >
          Clear
        </button>
      )}

      {/* Download selected button */}
      <motion.button
        whileHover={{ scale: 1.02, opacity: count === 0 ? 1 : 1 }}
        whileTap={{ scale: count === 0 ? 1 : 0.97 }}
        onClick={onBatchDownload}
        disabled={count === 0 || isDownloading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
        style={{ background: primaryColor }}
      >
        {isDownloading ? (
          <><motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2 size={12} /></motion.div> Downloading…</>
        ) : (
          <><Download size={12} /> Download ({count})</>
        )}
      </motion.button>
    </motion.div>
  );
}

// ─── SelectablePhotoCard ──────────────────────────────────────────────────────

interface SelectablePhotoCardProps {
  item: PhotoItem;
  imageId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  isSelected: boolean;
  selectionIndex: number;
  isSelectMode: boolean;
  onToggle: () => void;
  onClick: () => void;
  scene?: string;
  confidence?: number;
  showConfidence?: boolean;
  watermarkConfig?: unknown;
  showGroupBadge?: boolean;  // Show "+N" badge for group photos
}

export function SelectablePhotoCard({
  item,
  imageId,
  imageUrl,
  thumbnailUrl,
  isSelected,
  selectionIndex,
  isSelectMode,
  onToggle,
  onClick,
  scene,
  confidence,
  showConfidence,
  showGroupBadge = false,
}: SelectablePhotoCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  
  // Group photo info
  const totalFaces = item.total_faces ?? 1;
  const otherFaces = item.other_faces ?? (totalFaces > 1 ? totalFaces - 1 : 0);
  const isGroupPhoto = otherFaces > 0;

  const handleClick = () => {
    if (isSelectMode) {
      onToggle();
    } else {
      onClick();
    }
  };

  return (
    <motion.div
      layout
      className={`relative group rounded-xl overflow-hidden cursor-pointer bg-zinc-900 border transition-all ${
        isSelected
          ? 'border-blue-500/60 ring-2 ring-blue-500/20'
          : 'border-zinc-800 hover:border-zinc-700'
      }`}
      onClick={handleClick}
      whileHover={{ scale: isSelectMode ? 1 : 1.01 }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Image */}
      <div className="aspect-square">
        {!loaded && !error && (
          <div className="absolute inset-0 bg-zinc-800 animate-pulse" />
        )}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
            <span className="text-zinc-600 text-xs">Failed to load</span>
          </div>
        ) : (
          <img
            src={thumbnailUrl ?? imageUrl}
            alt={imageId}
            className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        )}
      </div>

      {/* Hover overlay */}
      {!isSelectMode && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-xl" />
      )}

      {/* Select checkbox — top-left — BLUE (was amber) */}
      <AnimatePresence>
        {(isSelectMode || isSelected) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute top-2 left-2"
          >
            <div
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                isSelected
                  ? 'bg-blue-600 border-blue-500 shadow-lg shadow-blue-500/30'
                  : 'bg-black/50 border-white/40 backdrop-blur-sm'
              }`}
            >
              {isSelected && <Check size={13} className="text-white" strokeWidth={3} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Group photo badge — bottom-right (when group photo) - always show in friends tab */}
      {showGroupBadge && isGroupPhoto && (
        <div 
          className={`absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full backdrop-blur-sm border ${isSelected ? 'opacity-50' : ''}`}
          style={{
            background: 'rgba(0,0,0,0.7)',
            borderColor: 'rgba(255,255,255,0.2)',
          }}
        >
          <Users size={11} className="text-white/80" />
          <span className="text-[10px] font-semibold text-white/90">+{otherFaces} {otherFaces === 1 ? 'person' : 'people'}</span>
        </div>
      )}

      {/* Selection order badge — BLUE (was amber) */}
      {isSelected && selectionIndex > 0 && (
        <div className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-blue-600 border border-blue-500/50 flex items-center justify-center">
          <span className="text-white text-[10px] font-bold tabular-nums">{selectionIndex}</span>
        </div>
      )}

      {/* Scene label */}
      {scene && !isSelectMode && (
        <div className="absolute bottom-2 left-2 right-2">
          <span className="text-[10px] text-white/70 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded-md font-medium capitalize">
            {scene}
          </span>
        </div>
      )}

      {/* Confidence badge */}
      {showConfidence && confidence !== undefined && !isSelectMode && !isGroupPhoto && (
        <div className="absolute top-2 right-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md backdrop-blur-sm ${
            confidence >= 0.9
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : confidence >= 0.75
              ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              : 'bg-zinc-700/60 text-zinc-400 border border-zinc-600/30'
          }`}>
            {Math.round(confidence * 100)}%
          </span>
        </div>
      )}
    </motion.div>
  );
}