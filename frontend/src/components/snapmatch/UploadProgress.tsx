/**
 * UploadProgress Component
 * Shows upload progress with compression indicator
 */

'use client';

import React, { memo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, CheckCircle2, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import { formatFileSize } from '@/lib/snapmatch/utils';
import { ProgressIndicator } from './UIComponents';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadProgressProps {
  file: File | null;
  status: 'idle' | 'compressing' | 'uploading' | 'success' | 'error';
  progress: number;
  compressedSize?: number;
  error?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

// ─── UploadProgressCard ────────────────────────────────────────────────────────

export const UploadProgressCard: React.FC<UploadProgressProps> = memo(({
  file,
  status,
  progress,
  compressedSize,
  error,
  onRetry,
  onDismiss,
}) => {
  // Auto-dismiss on success
  useEffect(() => {
    if (status === 'success' && onDismiss) {
      const timer = setTimeout(onDismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, onDismiss]);

  if (!file && status === 'idle') return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '16px 20px',
        borderRadius: 16,
        background: 'rgba(17,17,27,0.95)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        zIndex: 1000,
        minWidth: 280,
        maxWidth: 380,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        {/* Status icon / progress */}
        <div style={{ flexShrink: 0 }}>
          <AnimatePresence mode="wait">
            {status === 'compressing' && (
              <motion.div
                key="compressing"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                style={{ position: 'relative' }}
              >
                <ProgressIndicator percentage={progress} status="uploading" size="medium" />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <ImageIcon size={14} color="#e8c97e" />
                </div>
              </motion.div>
            )}
            {status === 'uploading' && (
              <motion.div
                key="uploading"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
              >
                <ProgressIndicator percentage={progress} status="uploading" size="medium" />
              </motion.div>
            )}
            {status === 'success' && (
              <motion.div
                key="success"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
              >
                <ProgressIndicator percentage={100} status="complete" size="medium" />
              </motion.div>
            )}
            {status === 'error' && (
              <motion.div
                key="error"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
              >
                <ProgressIndicator percentage={0} status="error" size="medium" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Status text */}
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: status === 'error' ? '#f87171' : '#fff',
            marginBottom: 4,
          }}>
            {status === 'compressing' && 'Optimizing image...'}
            {status === 'uploading' && 'Searching for matches...'}
            {status === 'success' && 'Search complete!'}
            {status === 'error' && 'Upload failed'}
          </div>

          {/* File info */}
          {file && (
            <div style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.5)',
              marginBottom: 8,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {file.name} • {formatFileSize(file.size)}
              {compressedSize && status !== 'compressing' && (
                <span style={{ color: '#4ade80' }}>
                  {' '}(compressed to {formatFileSize(compressedSize)})
                </span>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div style={{
              fontSize: 12,
              color: '#f87171',
              marginBottom: 8,
            }}>
              {error}
            </div>
          )}

          {/* Progress bar */}
          {(status === 'uploading' || status === 'compressing') && (
            <div style={{
              height: 4,
              borderRadius: 4,
              background: 'rgba(255,255,255,0.1)',
              overflow: 'hidden',
            }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #e8c97e, #c88c25)',
                  borderRadius: 4,
                }}
              />
            </div>
          )}

          {/* Action buttons */}
          {status === 'error' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onRetry}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: '#e8c97e',
                  border: 'none',
                  color: '#0a0808',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Try Again
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onDismiss}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </motion.button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

UploadProgressCard.displayName = 'UploadProgressCard';

// ─── MiniUploadProgress ─────────────────────────────────────────────────────────
// Inline progress indicator for hero section

interface MiniUploadProgressProps {
  progress: number;
  status: 'compressing' | 'uploading';
}

export const MiniUploadProgress: React.FC<MiniUploadProgressProps> = memo(({
  progress,
  status,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      style={{
        marginTop: 12,
        padding: '12px 16px',
        borderRadius: 10,
        background: 'rgba(232,201,126,0.1)',
        border: '1px solid rgba(232,201,126,0.2)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        >
          {status === 'compressing' ? (
            <ImageIcon size={16} color="#e8c97e" />
          ) : (
            <Upload size={16} color="#e8c97e" />
          )}
        </motion.div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#e8c97e',
            marginBottom: 6,
          }}>
            {status === 'compressing' 
              ? `Optimizing image... ${progress}%`
              : `Searching for your photos... ${progress}%`
            }
          </div>
          <div style={{
            height: 4,
            borderRadius: 4,
            background: 'rgba(255,255,255,0.1)',
            overflow: 'hidden',
          }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #e8c97e, #c88c25)',
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
});

MiniUploadProgress.displayName = 'MiniUploadProgress';

// ─── useUploadWithProgress Hook ────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { compressImage } from '@/lib/snapmatch/utils';

interface UploadState {
  status: 'idle' | 'compressing' | 'uploading' | 'success' | 'error';
  progress: number;
  file: File | null;
  compressedFile: File | null;
  error: string | null;
}

export const useUploadWithProgress = () => {
  const [state, setState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    file: null,
    compressedFile: null,
    error: null,
  });

  const startUpload = useCallback(async (
    file: File,
    uploadFn: (file: File, onProgress: (loaded: number, total: number) => void) => Promise<void>
  ) => {
    setState({
      status: 'compressing',
      progress: 0,
      file,
      compressedFile: null,
      error: null,
    });

    try {
      // Compress image
      setState(prev => ({ ...prev, progress: 0 }));
      
      let processedFile = file;
      
      // Only compress if > 1MB
      if (file.size > 1024 * 1024) {
        for (let i = 0; i <= 100; i += 10) {
          await new Promise(resolve => setTimeout(resolve, 50));
          setState(prev => ({ ...prev, progress: i }));
        }
        processedFile = await compressImage(file, { maxWidth: 1920, quality: 0.85 });
      }
      
      setState({
        status: 'uploading',
        progress: 0,
        file,
        compressedFile: processedFile,
        error: null,
      });

      // Upload with progress
      await uploadFn(
        processedFile,
        (loaded, total) => {
          const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
          setState(prev => ({ ...prev, progress }));
        }
      );

      setState(prev => ({ ...prev, status: 'success', progress: 100 }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      progress: 0,
      file: null,
      compressedFile: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    startUpload,
    reset,
  };
};

export default {
  UploadProgressCard,
  MiniUploadProgress,
  useUploadWithProgress,
};
