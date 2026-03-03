/**
 * SNAPMATCH UI Components
 * Reusable components with inline styles following project patterns
 */

'use client';

import React, { memo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Download, Check, X, ZoomIn, ChevronLeft, ChevronRight, 
  Camera, RefreshCw, FlipHorizontal, Timer, Sparkles,
  CheckCircle2, Loader2, AlertCircle
} from 'lucide-react';
import { getConfidenceColor, getConfidenceLabel, hapticFeedback } from '@/lib/snapmatch/utils';
import { useReducedMotion } from '@/hooks/snapmatch/useSnapmatch';

// ─── Animation Variants ───────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.055, duration: 0.48, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const } 
  },
};

const pulse = {
  animate: {
    scale: [1, 1.05, 1],
    opacity: [0.7, 0.4, 0.7],
  },
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: 'easeInOut',
  },
};

// ─── SkeletonCard ─────────────────────────────────────────────────────────────
// Loading placeholder for photo cards

interface SkeletonCardProps {
  style?: React.CSSProperties;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = memo(({ style }) => {
  const prefersReducedMotion = useReducedMotion();
  
  return (
    <div
      style={{
        aspectRatio: '1',
        borderRadius: 12,
        overflow: 'hidden',
        position: 'relative',
        background: '#111',
        border: '1px solid rgba(255,255,255,0.07)',
        ...style,
      }}
    >
      <motion.div
        animate={prefersReducedMotion ? {} : pulse.animate}
        transition={prefersReducedMotion ? {} : pulse.transition}
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
        }}
      />
    </div>
  );
});

SkeletonCard.displayName = 'SkeletonCard';

// ─── SkeletonGrid ─────────────────────────────────────────────────────────────
// Multiple skeleton cards in a grid

interface SkeletonGridProps {
  count: number;
  columns?: string;
  gap?: number;
}

export const SkeletonGrid: React.FC<SkeletonGridProps> = memo(({ 
  count, 
  columns = 'repeat(auto-fill, minmax(220px, 1fr))',
  gap = 8 
}) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: columns,
        gap,
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
});

SkeletonGrid.displayName = 'SkeletonGrid';

// ─── ConfidenceBadge ──────────────────────────────────────────────────────────
// Shows match confidence percentage with color coding

interface ConfidenceBadgeProps {
  score: number;
  showLabel?: boolean;
  style?: React.CSSProperties;
}

export const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = memo(({ 
  score, 
  showLabel = false,
  style 
}) => {
  const color = getConfidenceColor(score);
  const label = getConfidenceLabel(score);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 6,
        background: `${color}22`,
        border: `1px solid ${color}44`,
        fontSize: 10,
        fontWeight: 600,
        color,
        ...style,
      }}
    >
      {showLabel && <Sparkles size={10} />}
      {showLabel ? label : `${score}%`}
    </motion.div>
  );
});

ConfidenceBadge.displayName = 'ConfidenceBadge';

// ─── FaceGuideOverlay ─────────────────────────────────────────────────────────
// Face positioning guide for camera selfie

interface FaceGuideOverlayProps {
  visible: boolean;
}

export const FaceGuideOverlay: React.FC<FaceGuideOverlayProps> = memo(({ visible }) => {
  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* Face oval guide */}
      <svg
        viewBox="0 0 200 280"
        style={{
          width: '55%',
          height: 'auto',
          maxWidth: 200,
        }}
      >
        {/* Outer glow */}
        <ellipse
          cx="100"
          cy="140"
          rx="70"
          ry="100"
          fill="none"
          stroke="rgba(232,201,126,0.3)"
          strokeWidth="4"
          style={{ filter: 'blur(4px)' }}
        />
        {/* Main oval */}
        <ellipse
          cx="100"
          cy="140"
          rx="65"
          ry="95"
          fill="none"
          stroke="#e8c97e"
          strokeWidth="2"
          strokeDasharray="8 6"
          opacity={0.7}
        />
        {/* Corner markers */}
        <path d="M 40 80 L 40 60 L 60 60" fill="none" stroke="#e8c97e" strokeWidth="2" />
        <path d="M 160 80 L 160 60 L 140 60" fill="none" stroke="#e8c97e" strokeWidth="2" />
        <path d="M 40 200 L 40 220 L 60 220" fill="none" stroke="#e8c97e" strokeWidth="2" />
        <path d="M 160 200 L 160 220 L 140 220" fill="none" stroke="#e8c97e" strokeWidth="2" />
      </svg>

      {/* Instructions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        style={{
          position: 'absolute',
          bottom: '15%',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '8px 16px',
          borderRadius: 20,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(10px)',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 12,
          fontWeight: 500,
          textAlign: 'center',
        }}
      >
        Position your face in the oval
      </motion.div>
    </div>
  );
});

FaceGuideOverlay.displayName = 'FaceGuideOverlay';

// ─── ProgressIndicator ────────────────────────────────────────────────────────
// Upload progress with percentage

interface ProgressIndicatorProps {
  percentage: number;
  status: 'idle' | 'uploading' | 'complete' | 'error';
  size?: 'small' | 'medium' | 'large';
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = memo(({ 
  percentage, 
  status,
  size = 'medium' 
}) => {
  const sizes = {
    small: { width: 32, height: 32, strokeWidth: 2, textSize: 8 },
    medium: { width: 48, height: 48, strokeWidth: 3, textSize: 10 },
    large: { width: 64, height: 64, strokeWidth: 4, textSize: 12 },
  };

  const { width, height, strokeWidth, textSize } = sizes[size];
  const radius = (width - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  const colors = {
    idle: 'rgba(255,255,255,0.2)',
    uploading: '#e8c97e',
    complete: '#4ade80',
    error: '#f87171',
  };

  return (
    <div style={{ position: 'relative', width, height }}>
      <svg width={width} height={height} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background circle */}
        <circle
          cx={width / 2}
          cy={height / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <motion.circle
          cx={width / 2}
          cy={height / 2}
          r={radius}
          fill="none"
          stroke={colors[status]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{
            strokeDasharray: circumference,
          }}
        />
      </svg>
      
      {/* Center content */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {status === 'uploading' && (
          <span style={{ fontSize: textSize, fontWeight: 700, color: colors[status] }}>
            {percentage}%
          </span>
        )}
        {status === 'complete' && <Check size={width * 0.4} color={colors.complete} />}
        {status === 'error' && <X size={width * 0.4} color={colors.error} />}
      </div>
    </div>
  );
});

ProgressIndicator.displayName = 'ProgressIndicator';

// ─── SelectionCheckbox ────────────────────────────────────────────────────────
// Checkbox for multi-select mode

interface SelectionCheckboxProps {
  selected: boolean;
  onToggle: () => void;
  size?: number;
}

export const SelectionCheckbox: React.FC<SelectionCheckboxProps> = memo(({ 
  selected, 
  onToggle,
  size = 24 
}) => {
  return (
    <motion.button
      onClick={(e) => {
        e.stopPropagation();
        hapticFeedback('light');
        onToggle();
      }}
      whileTap={{ scale: 0.9 }}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        border: selected ? 'none' : '2px solid rgba(255,255,255,0.4)',
        background: selected ? '#e8c97e' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
      }}
      aria-label={selected ? 'Deselect photo' : 'Select photo'}
      aria-pressed={selected}
    >
      <AnimatePresence mode="wait">
        {selected && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Check size={size * 0.6} color="#0a0808" strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
});

SelectionCheckbox.displayName = 'SelectionCheckbox';

// ─── SelectionOverlay ─────────────────────────────────────────────────────────
// Overlay shown when a photo is selected in multi-select mode

interface SelectionOverlayProps {
  selected: boolean;
  index: number;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = memo(({ selected, index }) => {
  if (!selected) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(232,201,126,0.15)',
        borderRadius: 12,
        border: '2px solid #e8c97e',
        pointerEvents: 'none',
      }}
    >
      {/* Selection number badge */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: '#e8c97e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          color: '#0a0808',
        }}
      >
        {index + 1}
      </div>
    </motion.div>
  );
});

SelectionOverlay.displayName = 'SelectionOverlay';

// ─── AnimatedSuccess ──────────────────────────────────────────────────────────
// Success animation with confetti-like effect

interface AnimatedSuccessProps {
  message: string;
  subMessage?: string;
  onComplete?: () => void;
}

export const AnimatedSuccess: React.FC<AnimatedSuccessProps> = memo(({ 
  message, 
  subMessage,
  onComplete 
}) => {
  useEffect(() => {
    if (onComplete) {
      const timer = setTimeout(onComplete, 3000);
      return () => clearTimeout(timer);
    }
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        textAlign: 'center',
      }}
    >
      {/* Animated checkmark */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
        style={{
          width: 96,
          height: 96,
          borderRadius: 32,
          background: 'rgba(74,222,128,0.12)',
          border: '1px solid rgba(74,222,128,0.22)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 28,
        }}
      >
        <motion.div
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <CheckCircle2 size={46} color="#4ade80" />
        </motion.div>
      </motion.div>

      {/* Message */}
      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontSize: 36,
          color: '#fff',
          marginBottom: 10,
        }}
      >
        {message}
      </motion.h2>

      {subMessage && (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 15,
            lineHeight: 1.7,
            maxWidth: 400,
          }}
        >
          {subMessage}
        </motion.p>
      )}

      {/* Decorative particles */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ 
            opacity: [0, 1, 0], 
            scale: [0, 1, 0],
            y: [0, -50 - i * 20],
            x: [(i - 2.5) * 20, (i - 2.5) * 40],
          }}
          transition={{ duration: 1, delay: 0.2 + i * 0.1 }}
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#e8c97e',
          }}
        />
      ))}
    </motion.div>
  );
});

AnimatedSuccess.displayName = 'AnimatedSuccess';

// ─── DownloadButton ───────────────────────────────────────────────────────────
// Download button with success animation

interface DownloadButtonProps {
  onDownload: () => Promise<void>;
  size?: number;
  style?: React.CSSProperties;
}

export const DownloadButton: React.FC<DownloadButtonProps> = memo(({ 
  onDownload, 
  size = 14,
  style 
}) => {
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleClick = async () => {
    setStatus('loading');
    hapticFeedback('medium');
    try {
      await onDownload();
      setStatus('success');
      hapticFeedback('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      hapticFeedback('error');
      setTimeout(() => setStatus('idle'), 2000);
    }
  };

  return (
    <motion.button
      onClick={(e) => {
        e.stopPropagation();
        handleClick();
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      disabled={status === 'loading'}
      style={{
        width: 34,
        height: 34,
        borderRadius: 9,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: status === 'loading' ? 'not-allowed' : 'pointer',
        ...style,
      }}
      aria-label="Download photo"
    >
      <AnimatePresence mode="wait">
        {status === 'idle' && (
          <motion.div key="idle" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            <Download size={size} color="#fff" />
          </motion.div>
        )}
        {status === 'loading' && (
          <motion.div 
            key="loading" 
            initial={{ scale: 0, rotate: 0 }} 
            animate={{ scale: 1, rotate: 360 }} 
            exit={{ scale: 0 }}
            transition={{ rotate: { repeat: Infinity, duration: 1, ease: 'linear' } }}
          >
            <Loader2 size={size} color="#e8c97e" />
          </motion.div>
        )}
        {status === 'success' && (
          <motion.div key="success" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            <Check size={size} color="#4ade80" />
          </motion.div>
        )}
        {status === 'error' && (
          <motion.div key="error" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            <AlertCircle size={size} color="#f87171" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
});

DownloadButton.displayName = 'DownloadButton';

// ─── TimerOverlay ─────────────────────────────────────────────────────────────
// Countdown timer overlay for camera

interface TimerOverlayProps {
  seconds: number;
  isActive: boolean;
}

export const TimerOverlay: React.FC<TimerOverlayProps> = memo(({ seconds, isActive }) => {
  if (!isActive || seconds <= 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <motion.div
        key={seconds}
        initial={{ scale: 1.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          fontSize: 80,
          fontWeight: 800,
          color: '#e8c97e',
          textShadow: '0 4px 20px rgba(232,201,126,0.5)',
        }}
      >
        {seconds}
      </motion.div>
    </motion.div>
  );
});

TimerOverlay.displayName = 'TimerOverlay';

// ─── CameraControls ───────────────────────────────────────────────────────────
// Camera control buttons

interface CameraControlsProps {
  onCapture: () => void;
  onFlip: () => void;
  onTimer: () => void;
  onClose: () => void;
  timerActive: boolean;
  timerSeconds: number;
}

export const CameraControls: React.FC<CameraControlsProps> = memo(({
  onCapture,
  onFlip,
  onTimer,
  onClose,
  timerActive,
  timerSeconds,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: '0 20px',
      }}
    >
      {/* Close button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClose}
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
        aria-label="Close camera"
      >
        <X size={20} color="#fff" />
      </motion.button>

      {/* Capture button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onCapture}
        disabled={timerActive}
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #e8c97e, #c88c25)',
          border: '4px solid rgba(255,255,255,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: timerActive ? 'not-allowed' : 'pointer',
          opacity: timerActive ? 0.6 : 1,
          boxShadow: '0 4px 20px rgba(232,201,126,0.4)',
        }}
        aria-label="Take photo"
      >
        <Camera size={28} color="#0a0808" />
      </motion.button>

      {/* Right controls */}
      <div style={{ display: 'flex', gap: 12 }}>
        {/* Flip camera */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onFlip}
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label="Flip camera"
        >
          <FlipHorizontal size={20} color="#fff" />
        </motion.button>

        {/* Timer */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onTimer}
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: timerSeconds > 0 ? 'rgba(232,201,126,0.2)' : 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(10px)',
            border: timerSeconds > 0 ? '1px solid rgba(232,201,126,0.4)' : '1px solid rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label={`Timer: ${timerSeconds} seconds`}
        >
          <Timer size={20} color={timerSeconds > 0 ? '#e8c97e' : '#fff'} />
          {timerSeconds > 0 && (
            <span
              style={{
                position: 'absolute',
                fontSize: 10,
                fontWeight: 700,
                color: '#e8c97e',
                marginTop: 2,
              }}
            >
              {timerSeconds}
            </span>
          )}
        </motion.button>
      </div>
    </div>
  );
});

CameraControls.displayName = 'CameraControls';

// ─── SceneIcon ────────────────────────────────────────────────────────────────
// Icon mapping for scene labels

import { MapPin, Sunset, Music, Utensils, Star } from 'lucide-react';

const SCENE_ICONS: Record<string, React.ReactNode> = {
  ceremony: <Sparkles size={11} />,
  reception: <Star size={11} />,
  dinner: <Utensils size={11} />,
  party: <Music size={11} />,
  outdoor: <Sunset size={11} />,
  venue: <MapPin size={11} />,
};

export const sceneIcon = (label: string): React.ReactNode => 
  SCENE_ICONS[label.toLowerCase()] ?? <MapPin size={11} />;

// ─── Export all ───────────────────────────────────────────────────────────────

export default {
  SkeletonCard,
  SkeletonGrid,
  ConfidenceBadge,
  FaceGuideOverlay,
  ProgressIndicator,
  SelectionCheckbox,
  SelectionOverlay,
  AnimatedSuccess,
  DownloadButton,
  TimerOverlay,
  CameraControls,
  sceneIcon,
};
