/**
 * CameraEnhancements Component
 * Camera selfie capture with flip, timer, face guide
 */

'use client';

import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Camera, X, FlipHorizontal, Timer, Sparkles, Focus
} from 'lucide-react';
import { hapticFeedback } from '@/lib/snapmatch/utils';
import { FaceGuideOverlay, TimerOverlay } from './UIComponents';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CameraWithEnhancementsProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  showFaceGuide?: boolean;
  defaultTimer?: number;
}

// ─── CameraWithEnhancements ────────────────────────────────────────────────────

export const CameraWithEnhancements: React.FC<CameraWithEnhancementsProps> = memo(({
  isOpen,
  onClose,
  onCapture,
  showFaceGuide: initialShowFaceGuide = true,
  defaultTimer = 0,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [timerSeconds, setTimerSeconds] = useState(defaultTimer);
  const [activeTimer, setActiveTimer] = useState(0);
  const [showFaceGuide, setShowFaceGuide] = useState(initialShowFaceGuide);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Toggle camera
  const handleFlip = useCallback(() => {
    hapticFeedback('medium');
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  }, []);

  // Cycle timer
  const handleTimerCycle = useCallback(() => {
    hapticFeedback('light');
    setTimerSeconds(prev => {
      if (prev === 0) return 3;
      if (prev === 3) return 5;
      if (prev === 5) return 10;
      return 0;
    });
  }, []);

  // Toggle face guide
  const handleToggleFaceGuide = useCallback(() => {
    hapticFeedback('light');
    setShowFaceGuide(prev => !prev);
  }, []);

  // Capture photo
  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;

    // Flash effect
    setFlash(true);
    hapticFeedback('heavy');
    setTimeout(() => setFlash(false), 150);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // ✅ DO NOT flip/mirror the image.
    // The video preview appears mirrored on screen (CSS transform) so the user
    // sees a natural mirror-selfie UX — but the actual pixel data must be
    // unflipped so InsightFace receives the correct face orientation.
    // A horizontally flipped face produces a measurably different embedding
    // and will miss matches in the FAISS index.
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `selfie-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        onCapture(file);
        onClose();
      }
    }, 'image/jpeg', 0.92);
  }, [onCapture, onClose]);

  // Handle capture with timer
  const handleCapture = useCallback(() => {
    if (timerSeconds > 0 && activeTimer === 0) {
      setActiveTimer(timerSeconds);
      
      const interval = setInterval(() => {
        setActiveTimer(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            capturePhoto();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else if (activeTimer === 0) {
      capturePhoto();
    }
  }, [timerSeconds, activeTimer, capturePhoto]);

  // Camera lifecycle management
  useEffect(() => {
    if (!isOpen) {
      // Stop camera when closing
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      return;
    }

    // Start camera when opening
    let mounted = true;
    
    const startCamera = async () => {
      // Set loading state at the start of async operation
      if (mounted) {
        setIsLoading(true);
        setError(null);
      }
      
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (mounted) setIsLoading(false);
          };
        }
      } catch {
        if (mounted) {
          setError('Camera access denied or not available');
          setIsLoading(false);
        }
      }
    };

    startCamera();

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0a0808',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Video element */}
      // AFTER — add the scaleX(-1) transform for front camera only:
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          // Mirror the PREVIEW only so user sees a natural selfie reflection.
          // The captured pixels are NOT flipped (capturePhoto draws without transform).
          transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
        }}
      />

      {/* Flash effect */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              inset: 0,
              background: '#fff',
              pointerEvents: 'none',
            }}
          />
        )}
      </AnimatePresence>

      {/* Loading overlay */}
      <AnimatePresence>
        {isLoading && (
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
              background: 'rgba(10,8,8,0.9)',
            }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            >
              <Camera size={48} color="#e8c97e" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error state */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10,8,8,0.95)',
              padding: 40,
            }}
          >
            <Camera size={48} color="#f87171" style={{ marginBottom: 16 }} />
            <p style={{ color: '#f87171', fontSize: 16, fontWeight: 600, textAlign: 'center' }}>
              {error}
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              style={{
                marginTop: 24,
                padding: '12px 24px',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Go Back
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Face guide overlay */}
      {showFaceGuide && facingMode === 'user' && !isLoading && (
        <FaceGuideOverlay visible={showFaceGuide} />
      )}

      {/* Timer overlay */}
      <AnimatePresence>
        <TimerOverlay seconds={activeTimer} isActive={activeTimer > 0} />
      </AnimatePresence>

      {/* Top controls */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '16px 20px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {/* Close button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onClose}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(10px)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label="Close camera"
        >
          <X size={20} color="#fff" />
        </motion.button>

        {/* Right controls */}
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Face guide toggle */}
          {facingMode === 'user' && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleToggleFaceGuide}
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: showFaceGuide ? 'rgba(232,201,126,0.3)' : 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(10px)',
                border: showFaceGuide ? '1px solid rgba(232,201,126,0.5)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label={showFaceGuide ? 'Hide face guide' : 'Show face guide'}
            >
              <Focus size={18} color={showFaceGuide ? '#e8c97e' : '#fff'} />
            </motion.button>
          )}
        </div>
      </div>

      {/* Bottom controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '24px 20px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.5), transparent)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* Flip camera */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleFlip}
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(10px)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label="Flip camera"
        >
          <FlipHorizontal size={22} color="#fff" />
        </motion.button>

        {/* Capture button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleCapture}
          disabled={activeTimer > 0}
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #e8c97e, #c88c25)',
            border: '4px solid rgba(255,255,255,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: activeTimer > 0 ? 'not-allowed' : 'pointer',
            opacity: activeTimer > 0 ? 0.6 : 1,
            boxShadow: '0 4px 30px rgba(232,201,126,0.4)',
          }}
          aria-label="Take photo"
        >
          <Camera size={32} color="#0a0808" />
        </motion.button>

        {/* Timer */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleTimerCycle}
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: timerSeconds > 0 ? 'rgba(232,201,126,0.3)' : 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(10px)',
            border: timerSeconds > 0 ? '1px solid rgba(232,201,126,0.5)' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            position: 'relative',
          }}
          aria-label={`Timer: ${timerSeconds > 0 ? `${timerSeconds} seconds` : 'Off'}`}
        >
          <Timer size={20} color={timerSeconds > 0 ? '#e8c97e' : '#fff'} />
          {timerSeconds > 0 && (
            <span
              style={{
                position: 'absolute',
                fontSize: 10,
                fontWeight: 700,
                color: '#e8c97e',
                marginTop: 28,
              }}
            >
              {timerSeconds}s
            </span>
          )}
        </motion.button>
      </div>
    </motion.div>
  );
});

CameraWithEnhancements.displayName = 'CameraWithEnhancements';

// ─── ConfidenceSlider ──────────────────────────────────────────────────────────

interface ConfidenceSliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export const ConfidenceSlider: React.FC<ConfidenceSliderProps> = memo(({
  value,
  onChange,
  min = 50,
  max = 95,
  step = 5,
}) => {
  const marks = [
    { value: 50, label: 'More Results' },
    { value: 75, label: 'Balanced' },
    { value: 95, label: 'Best Match' },
  ];

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>
          Match Sensitivity
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e8c97e' }}>
          {value}%
        </span>
      </div>

      {/* Custom slider track */}
      <div
        style={{
          position: 'relative',
          height: 8,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const percentage = Math.round(((e.clientX - rect.left) / rect.width) * 100);
          const clamped = Math.min(max, Math.max(min, Math.round(percentage / step) * step));
          onChange(clamped);
        }}
      >
        {/* Fill */}
        <motion.div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            background: 'linear-gradient(90deg, #e8c97e, #c88c25)',
            borderRadius: 4,
          }}
          animate={{ width: `${((value - min) / (max - min)) * 100}%` }}
        />

        {/* Thumb */}
        <motion.div
          style={{
            position: 'absolute',
            top: '50%',
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#e8c97e',
            border: '3px solid #fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            cursor: 'grab',
            transform: 'translate(-50%, -50%)',
          }}
          animate={{ left: `${((value - min) / (max - min)) * 100}%` }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95, cursor: 'grabbing' }}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0}
          onDrag={(e, info) => {
            const rect = (e.target as HTMLElement).parentElement?.getBoundingClientRect();
            if (rect) {
              const percentage = Math.round(((info.point.x - rect.left) / rect.width) * 100);
              const clamped = Math.min(max, Math.max(min, Math.round(percentage / step) * step));
              onChange(clamped);
            }
          }}
        />
      </div>

      {/* Marks */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 8,
      }}>
        {marks.map((mark) => (
          <button
            key={mark.value}
            onClick={() => onChange(mark.value)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 10,
              fontWeight: value === mark.value ? 600 : 400,
              color: value === mark.value ? '#e8c97e' : 'rgba(255,255,255,0.35)',
              cursor: 'pointer',
              transition: 'color 0.2s',
            }}
          >
            {mark.label}
          </button>
        ))}
      </div>
    </div>
  );
});

ConfidenceSlider.displayName = 'ConfidenceSlider';

// ─── Exports ──────────────────────────────────────────────────────────────────

const CameraEnhancementsExports = {
  CameraWithEnhancements,
  ConfidenceSlider,
};

export default CameraEnhancementsExports;
