/**
 * MultiSelect — fixed to remove all amber/golden colors.
 * All accents now use blue (matching the zinc dark theme).
 */

'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, Square, Download, X, Check } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhotoItem {
  image_name?: string;
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
}: MultiSelectToolbarProps) {
  const count = selectedIds.size;
  const allSelected = count === items.length && items.length > 0;

  /* ── Inactive trigger button ── */
  if (!isActive) {
    return (
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={onActivate}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-zinc-300 text-xs font-medium transition-colors"
      >
        <CheckSquare size={13} className="text-zinc-400" />
        Select
      </motion.button>
    );
  }

  /* ── Active toolbar ── */
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800"
    >
      {/* Selected count indicator — BLUE (was amber) */}
      <div className="flex items-center gap-1.5">
        <div className="w-5 h-5 rounded-full bg-blue-500/15 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
        </div>
        <span className="text-xs font-semibold text-zinc-200 tabular-nums">
          {count} selected
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-zinc-700" />

      {/* Select all / Clear */}
      {!allSelected ? (
        <button
          onClick={onSelectAll}
          className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap"
        >
          Select all
        </button>
      ) : (
        <button
          onClick={onClearSelection}
          className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap"
        >
          Clear
        </button>
      )}

      {/* Download selected — BLUE (was amber/gold) */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={onBatchDownload}
        disabled={count === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
      >
        <Download size={12} />
        Download ({count})
      </motion.button>

      {/* Exit select mode */}
      <button
        onClick={onDeactivate}
        className="w-6 h-6 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
      >
        <X size={13} />
      </button>
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
}

export function SelectablePhotoCard({
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
}: SelectablePhotoCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

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
      {showConfidence && confidence !== undefined && !isSelectMode && (
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