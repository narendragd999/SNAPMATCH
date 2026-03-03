/**
 * useWatermark Hook
 * Manages watermark configuration and application for photos
 *
 * Flow:
 * 1. Event owner configures watermark → saved to localStorage + API
 * 2. Public page fetches watermark config from event data
 * 3. When downloading/viewing photos → watermark is applied client-side
 */

import { useState, useCallback, useEffect } from 'react';
import {
  WatermarkConfig,
  DEFAULT_WATERMARK_CONFIG,
  applyWatermarkToImageUrl,
  WATERMARK_STORAGE_KEY,
} from '@/lib/snapmatch/watermark';

// Storage key for per-event watermark config
const EVENT_WATERMARK_KEY = (eventId: string) => `snapmatch_event_${eventId}_watermark`;

export interface UseWatermarkReturn {
  config: WatermarkConfig;
  setConfig: (config: WatermarkConfig) => void;
  applyToImage: (imageUrl: string, filename?: string) => Promise<File | null>;
  applyToBlob: (blob: Blob, filename?: string) => Promise<File | null>;
  isEnabled: boolean;
  enableWatermark: (enabled: boolean) => void;
}

/**
 * Hook for managing and applying watermarks
 */
export function useWatermark(options?: {
  eventId?: string;
  initialConfig?: WatermarkConfig;
}): UseWatermarkReturn {
  const { eventId, initialConfig } = options || {};

  // Helper to load config from storage (used in lazy initializer)
  const loadStoredConfig = useCallback((): WatermarkConfig => {
    if (typeof window === 'undefined') {
      return initialConfig || DEFAULT_WATERMARK_CONFIG;
    }

    try {
      // First, try to load event-specific config
      if (eventId) {
        const eventConfig = localStorage.getItem(EVENT_WATERMARK_KEY(eventId));
        if (eventConfig) {
          return { ...DEFAULT_WATERMARK_CONFIG, ...JSON.parse(eventConfig) };
        }
      }

      // Fall back to global config
      const globalConfig = localStorage.getItem(WATERMARK_STORAGE_KEY);
      if (globalConfig) {
        return { ...DEFAULT_WATERMARK_CONFIG, ...JSON.parse(globalConfig) };
      }
    } catch (error) {
      console.warn('Failed to load watermark config:', error);
    }

    return initialConfig || DEFAULT_WATERMARK_CONFIG;
  }, [eventId, initialConfig]);

  const [config, setConfigState] = useState<WatermarkConfig>(loadStoredConfig);

  // Save config to storage
  const setConfig = useCallback((newConfig: WatermarkConfig) => {
    setConfigState(newConfig);

    if (typeof window === 'undefined') return;

    try {
      // Save to global storage
      localStorage.setItem(WATERMARK_STORAGE_KEY, JSON.stringify(newConfig));

      // Also save to event-specific storage if eventId provided
      if (eventId) {
        localStorage.setItem(EVENT_WATERMARK_KEY(eventId), JSON.stringify(newConfig));
      }
    } catch (error) {
      console.warn('Failed to save watermark config:', error);
    }
  }, [eventId]);

  // Apply watermark to an image URL
  const applyToImage = useCallback(async (
    imageUrl: string,
    filename: string = 'watermarked-photo.jpg'
  ): Promise<File | null> => {
    if (!config.enabled) return null;

    try {
      const watermarkedFile = await applyWatermarkToImageUrl(imageUrl, config, filename);
      return watermarkedFile;
    } catch (error) {
      console.error('Failed to apply watermark:', error);
      return null;
    }
  }, [config]);

  // Apply watermark to a Blob
  const applyToBlob = useCallback(async (
    blob: Blob,
    filename: string = 'watermarked-photo.jpg'
  ): Promise<File | null> => {
    if (!config.enabled) return null;

    try {
      // Convert blob to URL
      const url = URL.createObjectURL(blob);
      const watermarkedFile = await applyWatermarkToImageUrl(url, config, filename);
      URL.revokeObjectURL(url);
      return watermarkedFile;
    } catch (error) {
      console.error('Failed to apply watermark to blob:', error);
      return null;
    }
  }, [config]);

  // Enable/disable watermark
  const enableWatermark = useCallback((enabled: boolean) => {
    setConfig({ ...config, enabled });
  }, [config, setConfig]);

  return {
    config,
    setConfig,
    applyToImage,
    applyToBlob,
    isEnabled: config.enabled,
    enableWatermark,
  };
}

// ─── Watermark Download Helper ────────────────────────────────────────────────

/**
 * Download a photo with optional watermark applied
 */
export async function downloadWithWatermark(
  imageUrl: string,
  watermarkConfig: WatermarkConfig | null,
  filename: string
): Promise<boolean> {
  try {
    let fileToDownload: File;

    if (watermarkConfig?.enabled) {
      // Apply watermark
      const watermarkedFile = await applyWatermarkToImageUrl(imageUrl, watermarkConfig, filename);
      if (!watermarkedFile) {
        throw new Error('Failed to apply watermark');
      }
      fileToDownload = watermarkedFile;
    } else {
      // Download without watermark
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      fileToDownload = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    }

    // Trigger download
    const url = URL.createObjectURL(fileToDownload);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
}

/**
 * Download multiple photos as ZIP with watermarks applied
 */
export async function downloadZipWithWatermark(
  imageUrls: string[],
  watermarkConfig: WatermarkConfig | null,
  zipFilename: string,
  onProgress?: (current: number, total: number) => void
): Promise<boolean> {
  // Note: For ZIP creation, we need JSZip library
  // This is a simplified version that downloads individually
  // In production, use JSZip for batch downloads

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const filename = url.split('/').pop() || `photo-${i}.jpg`;

    await downloadWithWatermark(url, watermarkConfig, filename);

    if (onProgress) {
      onProgress(i + 1, imageUrls.length);
    }

    // Small delay between downloads to prevent browser blocking
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return true;
}

// ─── Watermark Config Fetcher ──────────────────────────────────────────────────

/**
 * Fetch watermark config for an event from API
 */
export async function fetchEventWatermarkConfig(
  eventId: string,
  apiUrl: string
): Promise<WatermarkConfig | null> {
  try {
    const response = await fetch(`${apiUrl}/events/${eventId}/watermark`);
    if (!response.ok) return null;

    const data = await response.json();
    return { ...DEFAULT_WATERMARK_CONFIG, ...data };
  } catch (error) {
    console.warn('Failed to fetch watermark config:', error);
    return null;
  }
}

/**
 * Save watermark config for an event via API
 */
export async function saveEventWatermarkConfig(
  eventId: string,
  config: WatermarkConfig,
  apiUrl: string,
  authToken: string
): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/events/${eventId}/watermark`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(config),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to save watermark config:', error);
    return false;
  }
}

export default useWatermark;