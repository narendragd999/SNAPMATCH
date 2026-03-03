/**
 * SNAPMATCH Utility Functions
 * Image compression, haptic feedback, analytics, and helper functions
 */

// ─── Image Compression ───────────────────────────────────────────────────────

export interface CompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
}

export const compressImage = async (
  file: File,
  options: CompressionOptions = {}
): Promise<File> => {
  const { maxWidth = 1920, maxHeight = 1920, quality = 0.85, mimeType = 'image/jpeg' } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      // Calculate new dimensions while maintaining aspect ratio
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image'));
            return;
          }
          const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
            type: mimeType,
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        },
        mimeType,
        quality
      );
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

export const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

// ─── Haptic Feedback ─────────────────────────────────────────────────────────

export type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export const hapticFeedback = (type: HapticType = 'light'): void => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    const patterns: Record<HapticType, number | number[]> = {
      light: 10,
      medium: 20,
      heavy: 50,
      success: [10, 50, 10],
      warning: [30, 50, 30],
      error: [50, 100, 50, 100, 50],
    };
    navigator.vibrate(patterns[type]);
  }
};

// ─── Analytics Tracking ───────────────────────────────────────────────────────

export const trackEvent = (eventName: string, data?: Record<string, unknown>): void => {
  // Console logging for development
  if (process.env.NODE_ENV === 'development') {
    console.log('[Analytics]', eventName, data);
  }

  // Google Analytics 4 integration
  if (typeof window !== 'undefined') {
    const win = window as unknown as { gtag?: (...args: unknown[]) => void };
    if (win.gtag) {
      win.gtag('event', eventName, data);
    }
  }
};

// Predefined analytics events
export const Analytics = {
  selfieUploaded: (method: 'camera' | 'upload' | 'drag') =>
    trackEvent('selfie_uploaded', { method }),

  searchCompleted: (resultCount: number, avgConfidence?: number) =>
    trackEvent('search_completed', { result_count: resultCount, avg_confidence: avgConfidence }),

  photoDownloaded: (photoId: string, isBatch: boolean) =>
    trackEvent('photo_downloaded', { photo_id: photoId, is_batch: isBatch }),

  sceneFiltered: (scene: string) =>
    trackEvent('scene_filtered', { scene }),

  layoutChanged: (layout: string) =>
    trackEvent('layout_changed', { layout }),

  contributeStarted: () =>
    trackEvent('contribute_started'),

  contributeCompleted: (photoCount: number) =>
    trackEvent('contribute_completed', { photo_count: photoCount }),
};

// ─── File Helpers ─────────────────────────────────────────────────────────────

export const uid = (): string => Math.random().toString(36).slice(2);

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export const nameOf = (item: unknown): string => {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    return (item as { image_name?: string }).image_name ?? '';
  }
  return '';
};

export const sceneOf = (item: unknown): string => {
  if (typeof item === 'object' && item !== null) {
    return (item as { scene_label?: string }).scene_label ?? '';
  }
  return '';
};

export const objectOf = (item: unknown): string => {
  if (typeof item === 'object' && item !== null) {
    return (item as { object_label?: string }).object_label ?? '';
  }
  return '';
};

export const confidenceOf = (item: unknown): number => {
  if (typeof item === 'object' && item !== null) {
    const sim = (item as { similarity?: number }).similarity;
    if (sim !== undefined) return Math.round(sim * 100);
  }
  return 85; // Default confidence
};

// ─── Download Helpers ─────────────────────────────────────────────────────────

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ─── Validation Helpers ───────────────────────────────────────────────────────

export const isValidImageFile = (file: File): boolean => {
  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  return validTypes.includes(file.type);
};

export const validateFileSize = (file: File, maxSizeMB: number = 50): boolean => {
  return file.size <= maxSizeMB * 1024 * 1024;
};

// ─── Color Helpers ────────────────────────────────────────────────────────────

export const getConfidenceColor = (score: number): string => {
  if (score >= 90) return '#4ade80'; // jade
  if (score >= 70) return '#e8c97e'; // gold
  if (score >= 50) return '#fb923c'; // orange
  return '#f87171'; // rose
};

export const getConfidenceLabel = (score: number): string => {
  if (score >= 90) return 'Excellent Match';
  if (score >= 70) return 'Good Match';
  if (score >= 50) return 'Possible Match';
  return 'Low Match';
};

// ─── Local Storage Helpers ────────────────────────────────────────────────────

export const storage = {
  get: <T>(key: string, defaultValue: T): T => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set: <T>(key: string, value: T): void => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      console.warn('Failed to save to localStorage');
    }
  },

  remove: (key: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  },
};

// ─── Array Helpers ────────────────────────────────────────────────────────────

export const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

// ─── Debounce ─────────────────────────────────────────────────────────────────

export const debounce = <T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

// ─── QR Code Utilities ────────────────────────────────────────────────────────

export interface QRCodeOptions {
  size?: number;
  errorLevel?: 'L' | 'M' | 'Q' | 'H';
  bgColor?: string;
  fgColor?: string;
  includeMargin?: boolean;
  eventName?: string;
  eventDate?: string;
}

/**
 * Generate event URL from token
 */
export const getEventUrl = (token: string): string => {
  if (typeof window === 'undefined') return '';
  const baseUrl = window.location.origin;
  return `${baseUrl}/public/${token}`;
};

/**
 * Download QR code as PNG image
 */
export const downloadQRCodeAsPng = async (
  canvasRef: HTMLCanvasElement | null,
  filename: string = 'qrcode.png'
): Promise<boolean> => {
  if (!canvasRef) return false;

  try {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvasRef.toBlob(resolve, 'image/png', 1.0);
    });

    if (blob) {
      downloadBlob(blob, filename);
      return true;
    }
    return false;
  } catch {
    console.error('Failed to download QR code');
    return false;
  }
};

/**
 * Download QR code as SVG
 */
export const downloadQRCodeAsSvg = (
  svgElement: SVGSVGElement | null,
  filename: string = 'qrcode.svg'
): boolean => {
  if (!svgElement) return false;

  try {
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(svgBlob, filename);
    return true;
  } catch {
    console.error('Failed to download QR code as SVG');
    return false;
  }
};

/**
 * Generate print-ready QR code sheet HTML
 */
export const generateQRCodePrintSheet = (
  qrCodeDataUrl: string,
  eventName: string,
  eventUrl: string,
  instructions?: string
): string => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QR Code - ${eventName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 40px;
      background: #fff;
    }
    .sheet {
      max-width: 800px;
      margin: 0 auto;
      text-align: center;
    }
    .qr-container {
      padding: 40px;
      border: 2px solid #e5e7eb;
      border-radius: 16px;
      margin-bottom: 24px;
      background: #fafafa;
    }
    .qr-code {
      width: 300px;
      height: 300px;
      margin: 0 auto 24px;
    }
    .event-name {
      font-size: 28px;
      font-weight: 700;
      color: #111;
      margin-bottom: 12px;
    }
    .instructions {
      font-size: 16px;
      color: #666;
      margin-bottom: 16px;
      line-height: 1.6;
    }
    .url {
      font-size: 14px;
      color: #888;
      word-break: break-all;
      padding: 12px 16px;
      background: #f0f0f0;
      border-radius: 8px;
    }
    .divider {
      border: none;
      border-top: 1px dashed #ccc;
      margin: 32px 0;
    }
    .small-cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    .small-card {
      padding: 16px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      text-align: center;
    }
    .small-qr {
      width: 100px;
      height: 100px;
      margin: 0 auto 8px;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="qr-container">
      <img src="${qrCodeDataUrl}" alt="Event QR Code" class="qr-code" />
      <h1 class="event-name">${eventName}</h1>
      ${instructions ? `<p class="instructions">${instructions}</p>` : ''}
      <p class="url">${eventUrl}</p>
    </div>
    
    <hr class="divider" />
    
    <h3 style="margin-bottom: 16px; color: #666;">Pocket Size Cards (cut along lines)</h3>
    <div class="small-cards">
      ${Array(4).fill(`
        <div class="small-card">
          <img src="${qrCodeDataUrl}" alt="QR" class="small-qr" />
          <p style="font-size: 10px; color: #888;">Scan to find your photos</p>
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Open print dialog for QR code sheet
 */
export const printQRCodeSheet = (
  qrCodeDataUrl: string,
  eventName: string,
  eventUrl: string
): void => {
  const html = generateQRCodePrintSheet(qrCodeDataUrl, eventName, eventUrl, 
    'Scan this QR code with your phone camera to find your photos from the event!');
  
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 500);
  }
};

/**
 * Track QR code scan analytics
 */
export const trackQRCodeScan = (token: string): void => {
  trackEvent('qr_code_scanned', { token });
};

/**
 * Track QR code download analytics
 */
export const trackQRCodeDownload = (token: string, format: 'png' | 'svg' | 'print'): void => {
  trackEvent('qr_code_downloaded', { token, format });
};