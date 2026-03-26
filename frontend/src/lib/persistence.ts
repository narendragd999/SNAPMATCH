/**
 * SNAPMATCH Persistence Utilities
 * Handles localStorage caching for search results and selfies
 * 
 * Features:
 * - Search Results Cache (7 days per event)
 * - Cross-Event Selfie Storage (30 days global)
 */

import { compressImage } from './utils';

// ─── Storage Keys ─────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SEARCH_CACHE: 'sm_search_cache',
  STORED_SELFIE: 'sm_stored_selfie',
  PIN_VERIFIED_PREFIX: 'pin_verified_',
} as const;

// ─── Duration Constants ───────────────────────────────────────────────────────

const DURATIONS = {
  SEARCH_CACHE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  SELFIE_STORAGE_MS: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
  THUMBNAIL_SIZE: 100, // 100x100 pixels
  SELFIE_MAX_SIZE: 800, // 800x800 pixels max
  SELFIE_QUALITY: 0.7, // 70% quality for compression
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhotoItemForCache {
  image_name: string;
  scene_label?: string;
  object_label?: string;
  objects?: string[];
  similarity?: number;
}

export interface CachedSearchResult {
  resultId: string;
  token: string;
  items: PhotoItemForCache[];
  total: number;
  hasMore: boolean;
  selfiePreview: string; // Base64 thumbnail
  cachedAt: number;
  expiresAt: number;
  pinVersion?: string;
}

export interface StoredSelfie {
  imageBase64: string; // Compressed selfie (base64)
  thumbnailBase64: string; // Small preview (100x100)
  storedAt: number;
  expiresAt: number;
  hash: string; // Quick hash for comparison
}

export interface SearchCacheStore {
  [token: string]: CachedSearchResult;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Generate a simple hash for image comparison
 */
const generateImageHash = (base64: string): string => {
  let hash = 0;
  const str = base64.slice(0, 1000); // Use first 1000 chars for speed
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
};

/**
 * Convert File to base64 string
 */
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Create a thumbnail from a base64 image
 */
const createThumbnail = async (base64: string, size: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Calculate crop dimensions for square thumbnail
      const minDim = Math.min(img.width, img.height);
      const offsetX = (img.width - minDim) / 2;
      const offsetY = (img.height - minDim) / 2;
      
      ctx.drawImage(img, offsetX, offsetY, minDim, minDim, 0, 0, size, size);
      
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = base64;
  });
};

/**
 * Safe localStorage operations with error handling
 */
const safeGetJson = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    console.warn(`[Persistence] Failed to read from localStorage: ${key}`);
    return defaultValue;
  }
};

const safeSetJson = <T>(key: string, value: T): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[Persistence] Failed to save to localStorage: ${key}`, error);
    // Try to clear old caches if storage is full
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      clearOldCaches();
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
};

const safeRemove = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore errors on remove
  }
};

/**
 * Clear old caches to free up space
 */
const clearOldCaches = (): void => {
  try {
    // Clear expired search caches
    const cache = safeGetJson<SearchCacheStore>(STORAGE_KEYS.SEARCH_CACHE, {});
    const now = Date.now();
    const filtered: SearchCacheStore = {};
    
    for (const [token, result] of Object.entries(cache)) {
      if (result.expiresAt > now) {
        filtered[token] = result;
      }
    }
    
    safeSetJson(STORAGE_KEYS.SEARCH_CACHE, filtered);
    console.log('[Persistence] Cleared old caches to free up space');
  } catch {
    // Ignore errors
  }
};

// ─── Selfie Storage Functions ─────────────────────────────────────────────────

/**
 * Save a selfie for cross-event use
 */
export const saveSelfie = async (file: File): Promise<boolean> => {
  try {
    // Compress the selfie
    const compressed = await compressImage(file, {
      maxWidth: DURATIONS.SELFIE_MAX_SIZE,
      maxHeight: DURATIONS.SELFIE_MAX_SIZE,
      quality: DURATIONS.SELFIE_QUALITY,
    });
    
    // Convert to base64
    const base64 = await fileToBase64(compressed);
    
    // Create thumbnail
    const thumbnail = await createThumbnail(base64, DURATIONS.THUMBNAIL_SIZE);
    
    // Create storage object
    const now = Date.now();
    const selfie: StoredSelfie = {
      imageBase64: base64,
      thumbnailBase64: thumbnail,
      storedAt: now,
      expiresAt: now + DURATIONS.SELFIE_STORAGE_MS,
      hash: generateImageHash(base64),
    };
    
    // Save to localStorage
    const success = safeSetJson(STORAGE_KEYS.STORED_SELFIE, selfie);
    
    if (success) {
      console.log('[Persistence] Selfie saved for', Math.round(DURATIONS.SELFIE_STORAGE_MS / (24 * 60 * 60 * 1000)), 'days');
    }
    
    return success;
  } catch (error) {
    console.error('[Persistence] Failed to save selfie:', error);
    return false;
  }
};

/**
 * Get stored selfie if valid (not expired)
 */
export const getStoredSelfie = (): StoredSelfie | null => {
  const selfie = safeGetJson<StoredSelfie | null>(STORAGE_KEYS.STORED_SELFIE, null);
  
  if (!selfie) return null;
  
  // Check expiration
  if (Date.now() >= selfie.expiresAt) {
    console.log('[Persistence] Stored selfie expired, removing');
    clearStoredSelfie();
    return null;
  }
  
  return selfie;
};

/**
 * Check if a valid stored selfie exists
 */
export const hasStoredSelfie = (): boolean => {
  return getStoredSelfie() !== null;
};

/**
 * Get remaining days until selfie expires
 */
export const getSelfieDaysRemaining = (): number => {
  const selfie = getStoredSelfie();
  if (!selfie) return 0;
  
  const remaining = selfie.expiresAt - Date.now();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
};

/**
 * Clear stored selfie
 */
export const clearStoredSelfie = (): void => {
  safeRemove(STORAGE_KEYS.STORED_SELFIE);
  console.log('[Persistence] Stored selfie cleared');
};

/**
 * Convert stored selfie back to File object for upload
 */
export const storedSelfieToFile = async (selfie: StoredSelfie): Promise<File> => {
  // Convert base64 to blob via fetch
  const response = await fetch(selfie.imageBase64);
  const blob = await response.blob();
  
  // Create File object
  return new File([blob], 'stored-selfie.jpg', { type: 'image/jpeg' });
};

// ─── Search Cache Functions ───────────────────────────────────────────────────

/**
 * Save search results to cache
 */
export const saveSearchCache = (
  token: string,
  resultId: string,
  items: PhotoItemForCache[],
  total: number,
  hasMore: boolean,
  selfiePreview: string,
  pinVersion?: string
): boolean => {
  const now = Date.now();
  const cacheEntry: CachedSearchResult = {
    resultId,
    token,
    items,
    total,
    hasMore,
    selfiePreview,
    cachedAt: now,
    expiresAt: now + DURATIONS.SEARCH_CACHE_MS,
    pinVersion,
  };
  
  // Get existing cache and update
  const cache = safeGetJson<SearchCacheStore>(STORAGE_KEYS.SEARCH_CACHE, {});
  cache[token] = cacheEntry;
  
  const success = safeSetJson(STORAGE_KEYS.SEARCH_CACHE, cache);
  
  if (success) {
    console.log('[Persistence] Search results cached for event:', token);
  }
  
  return success;
};

/**
 * Get cached search results for an event
 */
export const getSearchCache = (token: string, pinVersion?: string): CachedSearchResult | null => {
  const cache = safeGetJson<SearchCacheStore>(STORAGE_KEYS.SEARCH_CACHE, {});
  const entry = cache[token];
  
  if (!entry) return null;
  
  // Check expiration
  if (Date.now() >= entry.expiresAt) {
    console.log('[Persistence] Search cache expired for event:', token);
    clearSearchCache(token);
    return null;
  }
  
  // Check PIN version (invalidate if changed)
  if (pinVersion && entry.pinVersion && entry.pinVersion !== pinVersion) {
    console.log('[Persistence] PIN version changed, invalidating cache');
    clearSearchCache(token);
    return null;
  }
  
  return entry;
};

/**
 * Check if valid cache exists for an event
 */
export const hasSearchCache = (token: string, pinVersion?: string): boolean => {
  return getSearchCache(token, pinVersion) !== null;
};

/**
 * Get time since cache was created (in milliseconds)
 */
export const getCacheAge = (token: string): number | null => {
  const cache = getSearchCache(token);
  if (!cache) return null;
  return Date.now() - cache.cachedAt;
};

/**
 * Format cache age for display
 */
export const formatCacheAge = (ageMs: number): string => {
  const minutes = Math.floor(ageMs / (60 * 1000));
  const hours = Math.floor(ageMs / (60 * 60 * 1000));
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  
  if (days > 0) {
    const remainingHours = Math.floor((ageMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    return remainingHours > 0 ? `${days}d ${remainingHours}h ago` : `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return 'just now';
};

/**
 * Clear search cache for a specific event
 */
export const clearSearchCache = (token: string): void => {
  const cache = safeGetJson<SearchCacheStore>(STORAGE_KEYS.SEARCH_CACHE, {});
  if (cache[token]) {
    delete cache[token];
    safeSetJson(STORAGE_KEYS.SEARCH_CACHE, cache);
    console.log('[Persistence] Search cache cleared for event:', token);
  }
};

/**
 * Clear all search caches
 */
export const clearAllSearchCache = (): void => {
  safeRemove(STORAGE_KEYS.SEARCH_CACHE);
  console.log('[Persistence] All search caches cleared');
};

/**
 * Get all cached event tokens
 */
export const getCachedEventTokens = (): string[] => {
  const cache = safeGetJson<SearchCacheStore>(STORAGE_KEYS.SEARCH_CACHE, {});
  return Object.keys(cache).filter(token => {
    const entry = cache[token];
    return entry && entry.expiresAt > Date.now();
  });
};

/**
 * Get storage usage info
 */
export const getStorageUsage = (): { used: number; available: number; percentage: number } => {
  if (typeof window === 'undefined') {
    return { used: 0, available: 0, percentage: 0 };
  }
  
  try {
    // Estimate used space
    let used = 0;
    for (const key of [STORAGE_KEYS.SEARCH_CACHE, STORAGE_KEYS.STORED_SELFIE]) {
      const item = localStorage.getItem(key);
      if (item) {
        used += item.length * 2; // UTF-16 characters = 2 bytes each
      }
    }
    
    // localStorage typically has 5MB limit
    const available = 5 * 1024 * 1024;
    const percentage = (used / available) * 100;
    
    return { used, available, percentage };
  } catch {
    return { used: 0, available: 0, percentage: 0 };
  }
};

// ─── Clear All Data ───────────────────────────────────────────────────────────

/**
 * Clear all SNAPMATCH persistence data
 */
export const clearAllPersistenceData = (): void => {
  clearStoredSelfie();
  clearAllSearchCache();
  console.log('[Persistence] All persistence data cleared');
};

// ─── Export Constants ─────────────────────────────────────────────────────────

export const PERSISTENCE_DURATIONS = DURATIONS;
export const PERSISTENCE_KEYS = STORAGE_KEYS;
