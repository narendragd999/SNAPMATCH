/**
 * WatermarkedPhoto Component
 * Displays photos with optional watermark applied
 * Uses canvas-based watermark application for display
 */

'use client';

import React, { memo, useState, useEffect, useRef, useCallback } from 'react';
import { applyWatermarkToCanvas, WatermarkConfig } from '@/lib/snapmatch/watermark';

interface WatermarkedPhotoProps {
  src: string;                    // Original image URL
  alt?: string;
  watermarkConfig?: WatermarkConfig | null;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
  onLoad?: () => void;
  onError?: () => void;
  loading?: 'lazy' | 'eager';
  crossOrigin?: string;
}

/**
 * Component that renders an image with optional watermark overlay
 */
export const WatermarkedPhoto: React.FC<WatermarkedPhotoProps> = memo(({
  src,
  alt = '',
  watermarkConfig,
  style,
  className,
  onClick,
  onLoad,
  onError,
  loading = 'lazy',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [processed, setProcessed] = useState(false);
  const [error, setError] = useState(false);
  const [loadingState, setLoadingState] = useState(true);

  // Apply watermark when image loads
  const processImage = useCallback(async (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Apply watermark if enabled
    if (watermarkConfig?.enabled) {
      await applyWatermarkToCanvas(canvas, watermarkConfig);
    }

    setProcessed(true);
    setLoadingState(false);
    onLoad?.();
  }, [watermarkConfig, onLoad]);

  useEffect(() => {
    if (!src) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      processImage(img);
    };

    img.onerror = () => {
      setError(true);
      setLoadingState(false);
      onError?.();
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, processImage, onError]);

  // If no watermark or watermark disabled, just show original image
  if (!watermarkConfig?.enabled) {
    return (
      <img
        src={src}
        alt={alt}
        style={style}
        className={className}
        onClick={onClick}
        onLoad={onLoad}
        onError={onError}
        loading={loading}
      />
    );
  }

  // Show loading state
  if (loadingState && !processed) {
    return (
      <div 
        style={{ 
          ...style, 
          background: 'rgba(0,0,0,0.05)', 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className={className}
      >
        <div style={{
          width: 24,
          height: 24,
          border: '2px solid rgba(255,255,255,0.1)',
          borderTopColor: '#e8c97e',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div 
        style={{ 
          ...style, 
          background: 'rgba(248,113,113,0.1)', 
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.4)',
          fontSize: 12,
        }}
        className={className}
      >
        Failed to load
      </div>
    );
  }

  // Render watermarked canvas
  return (
    <canvas
      ref={canvasRef}
      style={style}
      className={className}
      onClick={onClick}
    />
  );
});

WatermarkedPhoto.displayName = 'WatermarkedPhoto';

// ─── Watermarked Thumbnail Component ────────────────────────────────────────

interface WatermarkedThumbnailProps {
  src: string;
  alt?: string;
  watermarkConfig?: WatermarkConfig | null;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}

/**
 * Optimized thumbnail component with watermark
 * Uses lower quality for faster processing
 */
export const WatermarkedThumbnail: React.FC<WatermarkedThumbnailProps> = memo(({
  src,
  alt = '',
  watermarkConfig,
  style,
  className,
  onClick,
}) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = async () => {
      try {
        // Create thumbnail-sized canvas (max 400px)
        const maxSize = 400;
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas context not available');
        }

        // Draw scaled image
        ctx.drawImage(img, 0, 0, width, height);

        // Apply watermark if enabled
        if (watermarkConfig?.enabled) {
          await applyWatermarkToCanvas(canvas, {
            ...watermarkConfig,
            // Scale padding for thumbnail
            padding: Math.round((watermarkConfig.padding / img.naturalWidth) * width),
          });
        }

        // Convert to data URL
        setThumbnailUrl(canvas.toDataURL('image/jpeg', 0.85));
        setLoading(false);
      } catch (err) {
        console.error('Thumbnail generation failed:', err);
        setError(true);
        setLoading(false);
      }
    };

    img.onerror = () => {
      setError(true);
      setLoading(false);
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, watermarkConfig]);

  // Show loading state
  if (loading) {
    return (
      <div 
        style={{ 
          ...style, 
          background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className={className}
      >
        <div style={{
          width: 20,
          height: 20,
          border: '2px solid rgba(255,255,255,0.1)',
          borderTopColor: '#e8c97e',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div 
        style={{ 
          ...style, 
          background: 'rgba(255,255,255,0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.3)',
        }}
        className={className}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21,15 16,10 5,21"/>
        </svg>
      </div>
    );
  }

  // Render thumbnail
  return (
    <img
      src={thumbnailUrl!}
      alt={alt}
      style={style}
      className={className}
      onClick={onClick}
      loading="lazy"
    />
  );
});

WatermarkedThumbnail.displayName = 'WatermarkedThumbnail';

// ─── Download Helper ────────────────────────────────────────────────────────

/**
 * Download an image with watermark applied
 */
export async function downloadWithWatermark(
  imageUrl: string,
  watermarkConfig: WatermarkConfig | null | undefined,
  filename: string
): Promise<boolean> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageUrl;
    });

    // Create canvas at full resolution
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context not available');
    }

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Apply watermark if enabled
    if (watermarkConfig?.enabled) {
      await applyWatermarkToCanvas(canvas, watermarkConfig);
    }

    // Convert to blob and download
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Failed to create blob')),
        'image/jpeg',
        0.95
      );
    });

    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  } catch (error) {
    console.error('Download with watermark failed:', error);
    return false;
  }
}

/**
 * Batch download images with watermarks
 */
export async function batchDownloadWithWatermark(
  imageUrls: string[],
  watermarkConfig: WatermarkConfig | null | undefined,
  onProgress?: (current: number, total: number) => void
): Promise<number> {
  let successCount = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const filename = url.split('/').pop() || `photo-${i + 1}.jpg`;

    const success = await downloadWithWatermark(url, watermarkConfig, filename);
    if (success) successCount++;

    onProgress?.(i + 1, imageUrls.length);

    // Small delay between downloads to prevent browser blocking
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return successCount;
}

export default WatermarkedPhoto;