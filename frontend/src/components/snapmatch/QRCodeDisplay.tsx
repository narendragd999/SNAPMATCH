/**
 * QRCodeDisplay Component
 * Generate, display, and download QR codes for event sharing
 */

'use client';

import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import {
  QrCode, Download, Printer, Copy, Check, Share2,
  X, FileImage, FileCode, Info
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QRCodeDisplayProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  eventName?: string;
  eventDate?: string;
}

type DownloadFormat = 'png' | 'svg' | 'print';
type QRSize = 'small' | 'medium' | 'large';

// ─── Size Configuration ───────────────────────────────────────────────────────

const QR_SIZES: Record<QRSize, { display: number; download: number }> = {
  small: { display: 180, download: 256 },
  medium: { display: 240, download: 512 },
  large: { display: 300, download: 1024 },
};

// ─── Utility Functions ────────────────────────────────────────────────────────

const getEventUrl = (token: string): string => {
  if (typeof window === 'undefined') return '';
  const baseUrl = window.location.origin;
  return `${baseUrl}/public/${token}`;
};

const downloadQRCodeAsPng = async (canvas: HTMLCanvasElement, filename: string): Promise<boolean> => {
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch {
    return false;
  }
};

const downloadQRCodeAsSvg = (svg: SVGSVGElement, filename: string): boolean => {
  try {
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
};

const printQRCodeSheet = (qrCodeDataUrl: string, eventName: string, eventUrl: string): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const instructions = [
    'Scan this QR code with your phone camera',
    'Upload a selfie to find your photos',
    'Download and share your memories!'
  ];

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QR Code - ${eventName}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 40px;
          background: white;
          color: #1a1a1a;
        }
        .container {
          max-width: 500px;
          margin: 0 auto;
          text-align: center;
        }
        h1 {
          font-size: 28px;
          margin-bottom: 8px;
          color: #1a1a1a;
        }
        .subtitle {
          color: #666;
          margin-bottom: 32px;
          font-size: 14px;
        }
        .qr-container {
          background: #fff;
          padding: 24px;
          border-radius: 16px;
          display: inline-block;
          margin-bottom: 24px;
          border: 2px solid #eee;
        }
        .qr-container img {
          display: block;
          width: 280px;
          height: 280px;
        }
        .instructions {
          text-align: left;
          background: #f8f8f8;
          padding: 20px 24px;
          border-radius: 12px;
          margin-bottom: 24px;
        }
        .instructions h3 {
          font-size: 14px;
          margin-bottom: 12px;
          color: #333;
        }
        .instructions ol {
          padding-left: 20px;
        }
        .instructions li {
          margin-bottom: 8px;
          font-size: 14px;
          color: #444;
        }
        .url {
          font-family: monospace;
          font-size: 12px;
          color: #666;
          background: #f0f0f0;
          padding: 12px;
          border-radius: 8px;
          word-break: break-all;
        }
        @media print {
          body { padding: 20px; }
          .qr-container { border: 1px solid #ddd; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${eventName}</h1>
        <p class="subtitle">Find Your Event Photos</p>
        <div class="qr-container">
          <img src="${qrCodeDataUrl}" alt="QR Code" />
        </div>
        <div class="instructions">
          <h3>How to find your photos:</h3>
          <ol>
            ${instructions.map(i => `<li>${i}</li>`).join('')}
          </ol>
        </div>
        <div class="url">${eventUrl}</div>
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
};

const hapticFeedback = (type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light'): void => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    const patterns: Record<string, number | number[]> = {
      light: 10, medium: 20, heavy: 50,
      success: [10, 50, 10], warning: [30, 50, 30], error: [50, 100, 50, 100, 50],
    };
    navigator.vibrate(patterns[type]);
  }
};

// ─── QRCodeDisplay Component ──────────────────────────────────────────────────

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = memo(({
  isOpen,
  onClose,
  token,
  eventName = 'Event Photos',
  eventDate,
}) => {
  const [qrSize, setQrSize] = useState<QRSize>('medium');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<DownloadFormat | null>(null);
  
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const eventUrl = getEventUrl(token);

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  // Copy URL to clipboard
  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      hapticFeedback('success');
    } catch {
      console.error('Failed to copy URL');
    }
  }, [eventUrl]);

  // Handle download
  const handleDownload = useCallback(async (format: DownloadFormat) => {
    setDownloading(format);
    hapticFeedback('medium');

    try {
      if (format === 'png') {
        const canvas = canvasRef.current?.querySelector('canvas');
        if (canvas) {
          await downloadQRCodeAsPng(canvas, `${eventName.replace(/\s+/g, '-').toLowerCase()}-qrcode.png`);
        }
      } else if (format === 'svg') {
        const svg = svgRef.current;
        if (svg) {
          downloadQRCodeAsSvg(svg, `${eventName.replace(/\s+/g, '-').toLowerCase()}-qrcode.svg`);
        }
      } else if (format === 'print') {
        const canvas = canvasRef.current?.querySelector('canvas');
        if (canvas) {
          const dataUrl = canvas.toDataURL('image/png');
          printQRCodeSheet(dataUrl, eventName, eventUrl);
        }
      }
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloading(null);
    }
  }, [eventName, eventUrl]);

  // Share (Web Share API)
  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${eventName} - Find Your Photos`,
          text: 'Scan the QR code or visit the link to find your photos from the event!',
          url: eventUrl,
        });
        hapticFeedback('success');
      } catch {
        // User cancelled or error
      }
    } else {
      handleCopyUrl();
    }
  }, [eventName, eventUrl, handleCopyUrl]);

  if (!isOpen) return null;

  const size = QR_SIZES[qrSize];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 100,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'linear-gradient(180deg, rgba(17,17,27,0.98) 0%, rgba(9,9,15,0.98) 100%)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 24,
            maxWidth: 480,
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(232,201,126,0.2), rgba(200,140,37,0.2))',
                border: '1px solid rgba(232,201,126,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <QrCode size={20} color="#e8c97e" />
              </div>
              <div>
                <h3 style={{ color: '#fff', fontSize: 18, fontWeight: 600, margin: 0 }}>
                  Event QR Code
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
                  Print & share at your event
                </p>
              </div>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onClose}
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              <X size={18} />
            </motion.button>
          </div>

          {/* QR Code Display */}
          <div style={{ padding: '24px' }}>
            {/* Event Info */}
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h4 style={{ color: '#fff', fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
                {eventName}
              </h4>
              {eventDate && (
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>
                  {eventDate}
                </p>
              )}
            </div>

            {/* QR Code */}
            <div
              ref={canvasRef}
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: 24,
                background: '#fff',
                borderRadius: 16,
                marginBottom: 20,
                position: 'relative',
              }}
            >
              {/* Hidden SVG for SVG download */}
              <div style={{ position: 'absolute', left: -9999, top: -9999 }}>
                <QRCodeSVG
                  ref={svgRef as React.RefObject<SVGSVGElement>}
                  value={eventUrl}
                  size={size.download}
                  level="H"
                  bgColor="#ffffff"
                  fgColor="#000000"
                  includeMargin
                />
              </div>
              
              {/* Visible Canvas for display and PNG download */}
              <QRCodeCanvas
                value={eventUrl}
                size={size.display}
                level="H"
                bgColor="#ffffff"
                fgColor="#000000"
                includeMargin
              />
            </div>

            {/* Size Selector */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 8,
              marginBottom: 20,
            }}>
              {(['small', 'medium', 'large'] as QRSize[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setQrSize(s)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: qrSize === s ? '1px solid rgba(232,201,126,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    background: qrSize === s ? 'rgba(232,201,126,0.15)' : 'rgba(255,255,255,0.03)',
                    color: qrSize === s ? '#e8c97e' : 'rgba(255,255,255,0.6)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* URL Display & Copy */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 12,
              marginBottom: 20,
            }}>
              <input
                type="text"
                value={eventUrl}
                readOnly
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 13,
                  outline: 'none',
                  textOverflow: 'ellipsis',
                }}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCopyUrl}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: copied ? 'rgba(74,222,128,0.15)' : 'rgba(232,201,126,0.15)',
                  border: copied ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(232,201,126,0.3)',
                  color: copied ? '#4ade80' : '#e8c97e',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy'}
              </motion.button>
            </div>

            {/* Download Options */}
            <div style={{ marginBottom: 20 }}>
              <p style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 12,
              }}>
                Download Options
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {/* PNG Download */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleDownload('png')}
                  disabled={downloading !== null}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: 16,
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    cursor: downloading ? 'not-allowed' : 'pointer',
                    opacity: downloading && downloading !== 'png' ? 0.5 : 1,
                  }}
                >
                  <FileImage size={22} color="#e8c97e" />
                  <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>PNG</span>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>Image File</span>
                </motion.button>

                {/* SVG Download */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleDownload('svg')}
                  disabled={downloading !== null}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: 16,
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    cursor: downloading ? 'not-allowed' : 'pointer',
                    opacity: downloading && downloading !== 'svg' ? 0.5 : 1,
                  }}
                >
                  <FileCode size={22} color="#e8c97e" />
                  <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>SVG</span>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>Vector File</span>
                </motion.button>

                {/* Print Sheet */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleDownload('print')}
                  disabled={downloading !== null}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    padding: 16,
                    borderRadius: 12,
                    background: 'rgba(232,201,126,0.08)',
                    border: '1px solid rgba(232,201,126,0.2)',
                    cursor: downloading ? 'not-allowed' : 'pointer',
                    opacity: downloading && downloading !== 'print' ? 0.5 : 1,
                  }}
                >
                  <Printer size={22} color="#e8c97e" />
                  <span style={{ color: '#e8c97e', fontSize: 13, fontWeight: 500 }}>Print</span>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>Ready Sheet</span>
                </motion.button>
              </div>
            </div>

            {/* Share Button */}
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleShare}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #e8c97e, #c88c25)',
                border: 'none',
                color: '#0a0808',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: 16,
              }}
            >
              <Share2 size={18} />
              Share Event Link
            </motion.button>

            {/* Help Text */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: 14,
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.15)',
              borderRadius: 12,
            }}>
              <Info size={16} color="#818cf8" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ color: '#fff', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                  How to use this QR code
                </p>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                  Print this QR code and display it at your event. Guests can scan it with their phone camera to instantly access the photo gallery and find their photos.
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

QRCodeDisplay.displayName = 'QRCodeDisplay';

// ─── QRCodeButton Component (for triggering the modal) ──────────────────────────

interface QRCodeButtonProps {
  onClick: () => void;
  variant?: 'default' | 'compact' | 'icon';
}

export const QRCodeButton: React.FC<QRCodeButtonProps> = memo(({
  onClick,
  variant = 'default',
}) => {
  if (variant === 'icon') {
    return (
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className="flex items-center justify-center rounded-lg"
        style={{
          width: 38,
          height: 38,
          cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          color: 'rgba(255,255,255,0.55)',
        }}
        title="Get QR Code"
      >
        <QrCode size={16} />
      </motion.button>
    );
  }

  if (variant === 'compact') {
    return (
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={onClick}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
        style={{
          background: 'rgba(232,201,126,0.1)',
          borderColor: 'rgba(232,201,126,0.2)',
          color: '#e8c97e',
        }}
      >
        <QrCode size={14} /> QR Code
      </motion.button>
    );
  }

  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
      style={{
        background: 'rgba(232,201,126,0.1)',
        borderColor: 'rgba(232,201,126,0.2)',
        color: '#e8c97e',
      }}
    >
      <QrCode size={14} /> Get QR Code
    </motion.button>
  );
});

QRCodeButton.displayName = 'QRCodeButton';

export default QRCodeDisplay;