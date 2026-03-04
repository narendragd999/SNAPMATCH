/**
 * QRCodeDisplay Component
 * Generate, display, and download QR codes for event sharing
 */

'use client';

import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import {
  QrCode, Printer, Copy, Check, Share2,
  X, FileImage, FileCode, KeyRound,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QRCodeDisplayProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  eventName?: string;
  eventDate?: string;
  pin?: string | null;   // 🔒 Current event PIN — shown on card for owner to share
}

type DownloadFormat = 'png' | 'svg' | 'print';
type QRSize = 'S' | 'M' | 'L';

// ─── Size Configuration ───────────────────────────────────────────────────────

const QR_SIZES: Record<QRSize, { display: number; download: number }> = {
  S: { display: 160, download: 256 },
  M: { display: 200, download: 512 },
  L: { display: 240, download: 1024 },
};

// ─── Utility Functions ────────────────────────────────────────────────────────

const getEventUrl = (token: string): string => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/public/${token}`;
};

const downloadQRCodeAsPng = async (canvas: HTMLCanvasElement, filename: string): Promise<boolean> => {
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch { return false; }
};

const downloadQRCodeAsSvg = (svg: SVGSVGElement, filename: string): boolean => {
  try {
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
};

const printQRCodeSheet = (qrCodeDataUrl: string, eventName: string, eventUrl: string, pin?: string | null): void => {
  const printWindow = window.open('_blank');
  if (!printWindow) return;
  const pinHtml = pin ? `
    <div class="pin-box">
      <p class="pin-label">Event PIN</p>
      <div class="pin-digits">
        ${pin.split('').map((d: string) => `<span class="pin-digit">${d}</span>`).join('')}
      </div>
      <p class="pin-hint">Enter this PIN when prompted on the event page</p>
    </div>` : '';
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${eventName} — QR Code</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: system-ui, sans-serif; background: #fff; color: #111; }
        .container { max-width: 400px; margin: 60px auto; text-align: center; padding: 40px; border: 1px solid #e5e7eb; border-radius: 16px; }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
        .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 28px; }
        .qr-container { display: inline-block; padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; margin-bottom: 20px; }
        .qr-container img { display: block; width: 200px; height: 200px; }
        .pin-box { background: #f8faff; border: 2px dashed #93c5fd; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px; }
        .pin-label { font-size: 11px; font-weight: 700; color: #3b82f6; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 10px; }
        .pin-digits { display: flex; justify-content: center; gap: 8px; margin-bottom: 8px; }
        .pin-digit { width: 44px; height: 52px; border: 2px solid #3b82f6; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 800; color: #1d4ed8; background: #fff; }
        .pin-hint { font-size: 11px; color: #6b7280; }
        .instructions { text-align: left; margin-bottom: 20px; }
        .instructions h3 { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 10px; }
        .instructions ol { padding-left: 18px; }
        .instructions li { font-size: 12px; color: #6b7280; margin-bottom: 6px; line-height: 1.5; }
        .url { font-size: 10px; color: #9ca3af; word-break: break-all; font-family: monospace; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${eventName}</h1>
        <p class="subtitle">Find Your Event Photos</p>
        <div class="qr-container"><img src="${qrCodeDataUrl}" alt="QR Code" /></div>
        ${pinHtml}
        <div class="instructions">
          <h3>How to find your photos:</h3>
          <ol>
            <li>Scan this QR code with your phone camera</li>
            ${pin ? '<li>Enter the PIN shown above when prompted</li>' : ''}
            <li>Upload a selfie to find your photos</li>
            <li>Download and share your memories!</li>
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

const hapticFeedback = (type: 'light' | 'success' = 'light'): void => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(type === 'success' ? [10, 50, 10] : 10);
  }
};

// ─── QRCodeDisplay Component ──────────────────────────────────────────────────

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = memo(({
  isOpen,
  onClose,
  token,
  eventName = 'Event Photos',
  eventDate,
  pin,
}) => {
  const [qrSize, setQrSize]       = useState<QRSize>('M');
  const [copied, setCopied]       = useState(false);
  const [downloading, setDownloading] = useState<DownloadFormat | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef    = useRef<SVGSVGElement>(null);
  const eventUrl  = getEventUrl(token);

  // Reset copied after 2s
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleCopyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      hapticFeedback('success');
    } catch { /* noop */ }
  }, [eventUrl]);

  const handleDownload = useCallback(async (format: DownloadFormat) => {
    setDownloading(format);
    hapticFeedback('light');
    try {
      const slug = (eventName || 'event').replace(/\s+/g, '-').toLowerCase();
      if (format === 'png') {
        const canvas = canvasRef.current?.querySelector('canvas');
        if (canvas) await downloadQRCodeAsPng(canvas, `${slug}-qr.png`);
      } else if (format === 'svg') {
        if (svgRef.current) downloadQRCodeAsSvg(svgRef.current, `${slug}-qr.svg`);
      } else if (format === 'print') {
        const canvas = canvasRef.current?.querySelector('canvas');
        if (canvas) printQRCodeSheet(canvas.toDataURL('image/png'), eventName, eventUrl, pin);
      }
    } catch { /* noop */ } finally {
      setDownloading(null);
    }
  }, [eventName, eventUrl]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${eventName} — Find Your Photos`, url: eventUrl });
        hapticFeedback('success');
      } catch { /* cancelled */ }
    } else {
      handleCopyUrl();
    }
  }, [eventName, eventUrl, handleCopyUrl]);

  const size = QR_SIZES[qrSize];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden w-full max-w-sm"
          >

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <QrCode size={13} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-100 leading-none">QR Code</p>
                  {eventName && (
                    <p className="text-[10px] text-zinc-500 mt-0.5 truncate max-w-[180px]">{eventName}</p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <X size={12} />
              </button>
            </div>

            {/* ── QR Display ── */}
            <div className="p-5 space-y-4">

              {/* QR code card */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 flex flex-col items-center gap-3 text-center">
                <div className="bg-white p-3 rounded-xl" ref={canvasRef}>
                  {/* Hidden SVG for SVG download */}
                  <div className="absolute -left-[9999px]">
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
                  {/* Visible canvas */}
                  <QRCodeCanvas
                    value={eventUrl}
                    size={size.display}
                    level="H"
                    bgColor="#ffffff"
                    fgColor="#000000"
                    includeMargin
                  />
                </div>
                <p className="text-[10px] text-zinc-600 break-all font-mono leading-relaxed px-1">
                  {eventUrl}
                </p>

                {/* PIN display */}
                {pin && (
                  <div className="w-full mt-1 pt-3 border-t border-zinc-800">
                    <div className="flex items-center justify-center gap-1.5 mb-2">
                      <KeyRound size={11} className="text-blue-400" />
                      <span className="text-[10px] font-semibold text-blue-400 tracking-widest uppercase">Event PIN</span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      {pin.split('').map((digit, i) => (
                        <div key={i} className="w-9 h-10 rounded-lg bg-zinc-900 border border-blue-500/30 flex items-center justify-center text-lg font-bold text-blue-300">
                          {digit}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-2">Share this PIN with your guests</p>
                  </div>
                )}
              </div>

              {/* Size selector + Copy URL row */}
              <div className="flex items-center justify-between gap-3">
                {/* Size pills */}
                <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-lg p-0.5">
                  {(['S', 'M', 'L'] as QRSize[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setQrSize(s)}
                      className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        qrSize === s
                          ? 'bg-zinc-700 text-zinc-100'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Copy URL */}
                <button
                  onClick={handleCopyUrl}
                  className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                    copied
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                  }`}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied!' : 'Copy URL'}
                </button>
              </div>

              {/* Download buttons */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { fmt: 'png'   as DownloadFormat, icon: FileImage, label: 'PNG',   sub: 'Image'  },
                  { fmt: 'svg'   as DownloadFormat, icon: FileCode,  label: 'SVG',   sub: 'Vector' },
                  { fmt: 'print' as DownloadFormat, icon: Printer,   label: 'Print', sub: 'Sheet'  },
                ]).map(({ fmt, icon: Icon, label, sub }) => (
                  <button
                    key={fmt}
                    onClick={() => handleDownload(fmt)}
                    disabled={downloading !== null}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-center transition-colors disabled:cursor-not-allowed ${
                      downloading === fmt
                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                        : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40'
                    }`}
                  >
                    <Icon size={15} />
                    <span className="text-[11px] font-semibold leading-none">{label}</span>
                    <span className="text-[10px] text-zinc-600 leading-none">{sub}</span>
                  </button>
                ))}
              </div>

              {/* Share button */}
              <button
                onClick={handleShare}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                <Share2 size={13} />
                Share Event Link
              </button>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

QRCodeDisplay.displayName = 'QRCodeDisplay';

// ─── QRCodeButton Component ───────────────────────────────────────────────────

interface QRCodeButtonProps {
  onClick: () => void;
  variant?: 'default' | 'compact' | 'icon';
}

export const QRCodeButton: React.FC<QRCodeButtonProps> = memo(({ onClick, variant = 'default' }) => {
  if (variant === 'icon') {
    return (
      <motion.button
        whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
        onClick={onClick}
        title="Get QR Code"
        className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <QrCode size={15} />
      </motion.button>
    );
  }

  return (
    <motion.button
      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`flex items-center gap-1.5 font-medium rounded-lg border transition-colors bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 ${
        variant === 'compact' ? 'text-[11px] px-2.5 py-1.5' : 'text-xs px-3 py-2'
      }`}
    >
      <QrCode size={variant === 'compact' ? 12 : 13} />
      {variant === 'compact' ? 'QR' : 'QR Code'}
    </motion.button>
  );
});

QRCodeButton.displayName = 'QRCodeButton';

export default QRCodeDisplay;