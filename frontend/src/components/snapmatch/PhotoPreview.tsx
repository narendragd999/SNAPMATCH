/**
 * Enhanced PhotoPreview Modal
 * Full-screen preview with zoom, keyboard navigation, swipe gestures
 */

'use client';

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { 
  X, Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, 
  RotateCw, Maximize2, Minimize2, Info, Share2, Heart
} from 'lucide-react';
import { 
  useKeyboardNavigation, 
  useSwipeGesture, 
  useReducedMotion,
  useFocusTrap 
} from '@/hooks/snapmatch/useSnapmatch';
import { nameOf, sceneOf, confidenceOf, hapticFeedback, downloadBlob } from '@/lib/snapmatch/utils';
import { ConfidenceBadge, sceneIcon } from './UIComponents';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhotoPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  items: unknown[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  apiBaseUrl: string;
  token: string;
  showConfidence?: boolean;
  showScene?: boolean;
  onDownload?: (imageName: string) => Promise<void>;
  onFavorite?: (imageName: string) => void;
  favorites?: Set<string>;
}

interface PhotoInfo {
  imageName: string;
  scene?: string;
  confidence?: number;
  index: number;
  total: number;
}

// ─── Animation Variants ───────────────────────────────────────────────────────

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

const imageVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } 
  },
  exit: { 
    opacity: 0, 
    scale: 0.95, 
    transition: { duration: 0.2 } 
  },
  left: { x: '-100%', opacity: 0 },
  right: { x: '100%', opacity: 0 },
};

// ─── PhotoPreview Component ───────────────────────────────────────────────────

export const PhotoPreview: React.FC<PhotoPreviewProps> = memo(({
  isOpen,
  onClose,
  items,
  currentIndex,
  onNavigate,
  apiBaseUrl,
  token,
  showConfidence = true,
  showScene = true,
  onDownload,
  onFavorite,
  favorites = new Set(),
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useFocusTrap(isOpen);
  const imageRef = useRef<HTMLImageElement>(null);

  // Current item data
  const currentItem = items[currentIndex];
  const imageName = nameOf(currentItem);
  const scene = sceneOf(currentItem);
  const confidence = confidenceOf(currentItem);
  const isFavorite = favorites.has(imageName);

  // Keyboard navigation
  useKeyboardNavigation({
    onNext: () => {
      if (currentIndex < items.length - 1) {
        hapticFeedback('light');
        onNavigate(currentIndex + 1);
        resetTransform();
      }
    },
    onPrev: () => {
      if (currentIndex > 0) {
        hapticFeedback('light');
        onNavigate(currentIndex - 1);
        resetTransform();
      }
    },
    onClose,
    enabled: isOpen,
  });

  // Swipe gestures
  const { onTouchStart, onTouchEnd } = useSwipeGesture({
    onSwipeLeft: () => {
      if (currentIndex < items.length - 1) {
        hapticFeedback('light');
        onNavigate(currentIndex + 1);
        resetTransform();
      }
    },
    onSwipeRight: () => {
      if (currentIndex > 0) {
        hapticFeedback('light');
        onNavigate(currentIndex - 1);
        resetTransform();
      }
    },
  });

  // Reset zoom/rotation when image changes
  useEffect(() => {
    resetTransform();
  }, [currentIndex]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handlers
  const resetTransform = useCallback(() => {
    setZoom(1);
    setRotation(0);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.5, 3));
    hapticFeedback('light');
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.5, 0.5));
    hapticFeedback('light');
  }, []);

  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
    hapticFeedback('light');
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
    hapticFeedback('light');
  }, []);

  const handleDownload = useCallback(async () => {
    if (onDownload) {
      await onDownload(imageName);
    } else {
      // Default download behavior
      try {
        const res = await fetch(`${apiBaseUrl}/public/events/${token}/photo/${imageName}`);
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        downloadBlob(blob, imageName);
        hapticFeedback('success');
      } catch (err) {
        console.error('Download failed:', err);
        hapticFeedback('error');
      }
    }
  }, [imageName, apiBaseUrl, token, onDownload]);

  const handleFavorite = useCallback(() => {
    if (onFavorite) {
      onFavorite(imageName);
      hapticFeedback('light');
    }
  }, [imageName, onFavorite]);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const threshold = 100;
    if (info.offset.x > threshold && currentIndex > 0) {
      onNavigate(currentIndex - 1);
      resetTransform();
    } else if (info.offset.x < -threshold && currentIndex < items.length - 1) {
      onNavigate(currentIndex + 1);
      resetTransform();
    }
    setIsDragging(false);
  }, [currentIndex, items.length, onNavigate, resetTransform]);

  // Image URL
  const imageUrl = `${apiBaseUrl}/public/events/${token}/photo/${imageName}`;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        variants={backdropVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-label={`Photo ${currentIndex + 1} of ${items.length}`}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: 'rgba(0,0,0,0.95)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
          }}
        >
          {/* Counter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                padding: '4px 12px',
                borderRadius: 20,
                background: 'rgba(255,255,255,0.1)',
                fontSize: 13,
                fontWeight: 600,
                color: '#fff',
              }}
            >
              {currentIndex + 1} / {items.length}
            </span>
            {showConfidence && confidence > 0 && (
              <ConfidenceBadge score={confidence} showLabel />
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onFavorite && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleFavorite}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart 
                  size={20} 
                  color={isFavorite ? '#f87171' : '#fff'} 
                  fill={isFavorite ? '#f87171' : 'none'} 
                />
              </motion.button>
            )}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowInfo(!showInfo)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: showInfo ? 'rgba(232,201,126,0.2)' : 'rgba(255,255,255,0.1)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Toggle info"
            >
              <Info size={20} color={showInfo ? '#e8c97e' : '#fff'} />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onClose}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Close preview"
            >
              <X size={20} color="#fff" />
            </motion.button>
          </div>
        </motion.header>

        {/* Main Image */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 20px',
            overflow: 'hidden',
          }}
        >
          <motion.div
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragStart={() => setIsDragging(true)}
            onDragEnd={handleDragEnd}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            animate={{ 
              scale: zoom, 
              rotate: rotation,
              x: 0,
              y: 0,
            }}
            transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
            style={{
              cursor: isDragging ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
          >
            <motion.img
              ref={imageRef}
              key={imageName}
              src={imageUrl}
              alt=""
              variants={prefersReducedMotion ? {} : imageVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              draggable={false}
              style={{
                maxWidth: '90vw',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: 8,
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            />
          </motion.div>
        </div>

        {/* Info Panel */}
        <AnimatePresence>
          {showInfo && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              style={{
                position: 'absolute',
                bottom: 80,
                left: 20,
                right: 20,
                padding: 16,
                borderRadius: 16,
                background: 'rgba(0,0,0,0.8)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                {showScene && scene && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: 'rgba(232,201,126,0.15)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#e8c97e',
                      textTransform: 'capitalize',
                    }}
                  >
                    {sceneIcon(scene)}
                    {scene}
                  </div>
                )}
                {showConfidence && confidence > 0 && (
                  <ConfidenceBadge score={confidence} showLabel />
                )}
              </div>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, wordBreak: 'break-all' }}>
                {imageName}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Controls */}
        <motion.footer
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '12px 16px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
          }}
        >
          {/* Navigation */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (currentIndex > 0) {
                onNavigate(currentIndex - 1);
                resetTransform();
              }
            }}
            disabled={currentIndex === 0}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: currentIndex === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
              opacity: currentIndex === 0 ? 0.4 : 1,
            }}
            aria-label="Previous photo"
          >
            <ChevronLeft size={22} color="#fff" />
          </motion.button>

          {/* Zoom controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 4,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.1)',
            }}
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: zoom <= 0.5 ? 'not-allowed' : 'pointer',
                opacity: zoom <= 0.5 ? 0.4 : 1,
              }}
              aria-label="Zoom out"
            >
              <ZoomOut size={18} color="#fff" />
            </motion.button>
            <span
              style={{
                minWidth: 40,
                textAlign: 'center',
                fontSize: 12,
                fontWeight: 600,
                color: '#fff',
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: zoom >= 3 ? 'not-allowed' : 'pointer',
                opacity: zoom >= 3 ? 0.4 : 1,
              }}
              aria-label="Zoom in"
            >
              <ZoomIn size={18} color="#fff" />
            </motion.button>
          </div>

          {/* Rotate */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleRotate}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Rotate photo"
          >
            <RotateCw size={18} color="#fff" />
          </motion.button>

          {/* Fullscreen */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleFullscreen}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 size={18} color="#fff" />
            ) : (
              <Maximize2 size={18} color="#fff" />
            )}
          </motion.button>

          {/* Download */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, #e8c97e, #c88c25)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              color: '#0a0808',
              boxShadow: '0 4px 20px rgba(232,201,126,0.3)',
            }}
            aria-label="Download photo"
          >
            <Download size={16} />
            Download
          </motion.button>

          {/* Navigation */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (currentIndex < items.length - 1) {
                onNavigate(currentIndex + 1);
                resetTransform();
              }
            }}
            disabled={currentIndex === items.length - 1}
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: currentIndex === items.length - 1 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentIndex === items.length - 1 ? 'not-allowed' : 'pointer',
              opacity: currentIndex === items.length - 1 ? 0.4 : 1,
            }}
            aria-label="Next photo"
          >
            <ChevronRight size={22} color="#fff" />
          </motion.button>
        </motion.footer>

        {/* Thumbnail strip for quick navigation */}
        <div
          style={{
            position: 'absolute',
            bottom: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 20,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(10px)',
            maxWidth: '80vw',
            overflowX: 'auto',
          }}
        >
          {items.slice(Math.max(0, currentIndex - 3), currentIndex + 4).map((item, i) => {
            const actualIndex = Math.max(0, currentIndex - 3) + i;
            const thumbName = nameOf(item);
            const isActive = actualIndex === currentIndex;

            return (
              <motion.button
                key={thumbName + actualIndex}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onNavigate(actualIndex)}
                style={{
                  width: isActive ? 48 : 36,
                  height: isActive ? 48 : 36,
                  borderRadius: 6,
                  overflow: 'hidden',
                  border: isActive ? '2px solid #e8c97e' : '2px solid transparent',
                  padding: 0,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
                aria-label={`Go to photo ${actualIndex + 1}`}
                aria-current={isActive ? 'true' : undefined}
              >
                <img
                  src={`${apiBaseUrl}/public/events/${token}/image/${thumbName}`}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
});

PhotoPreview.displayName = 'PhotoPreview';

export default PhotoPreview;
