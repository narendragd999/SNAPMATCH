/**
 * SNAPMATCH Custom Hooks
 * Reusable hooks for keyboard navigation, accessibility, and more
 */

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';

// ─── useReducedMotion ────────────────────────────────────────────────────────
// Respect user's reduced motion preference

export const useReducedMotion = (): boolean => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handler = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return prefersReducedMotion;
};

// ─── useMediaQuery ────────────────────────────────────────────────────────────
// Responsive breakpoint detection

export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
};

// ─── useKeyboardNavigation ────────────────────────────────────────────────────
// Keyboard navigation for photo galleries

export interface KeyboardNavOptions {
  onNext?: () => void;
  onPrev?: () => void;
  onClose?: () => void;
  onSelect?: () => void;
  enabled?: boolean;
}

export const useKeyboardNavigation = (options: KeyboardNavOptions) => {
  const { onNext, onPrev, onClose, onSelect, enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onPrev?.();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onNext?.();
          break;
        case 'Escape':
          e.preventDefault();
          onClose?.();
          break;
        case 'Enter':
        case ' ':
          if (e.target instanceof HTMLElement && e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            onSelect?.();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext, onPrev, onClose, onSelect, enabled]);

  return null;
};

// ─── useProgress ──────────────────────────────────────────────────────────────
// Upload progress tracking

export interface ProgressState {
  loaded: number;
  total: number;
  percentage: number;
  status: 'idle' | 'uploading' | 'complete' | 'error';
}

export const useProgress = () => {
  const [state, setState] = useState<ProgressState>({
    loaded: 0,
    total: 0,
    percentage: 0,
    status: 'idle',
  });

  const start = useCallback(() => {
    setState({ loaded: 0, total: 0, percentage: 0, status: 'uploading' });
  }, []);

  const update = useCallback((loaded: number, total: number) => {
    setState({
      loaded,
      total,
      percentage: total > 0 ? Math.round((loaded / total) * 100) : 0,
      status: 'uploading',
    });
  }, []);

  const complete = useCallback(() => {
    setState((prev) => ({ ...prev, percentage: 100, status: 'complete' }));
  }, []);

  const error = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'error' }));
  }, []);

  const reset = useCallback(() => {
    setState({ loaded: 0, total: 0, percentage: 0, status: 'idle' });
  }, []);

  return { state, start, update, complete, error, reset };
};

// ─── useInView ────────────────────────────────────────────────────────────────
// Intersection Observer for infinite scroll

export const useInView = (
  options: IntersectionObserverInit = {}
): [React.RefCallback<HTMLDivElement>, boolean] => {
  const { threshold = 0, root = null, rootMargin = '0px' } = options;
  const [isInView, setIsInView] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const setRef: React.RefCallback<HTMLDivElement> = useCallback((node) => {
    if (ref.current) {
      // Cleanup previous observer
    }
    ref.current = node;
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting);
      },
      { threshold, root, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, root, rootMargin]);

  return [setRef, isInView];
};

// ─── useSwipeGesture ──────────────────────────────────────────────────────────
// Touch swipe detection for mobile

export interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

export const useSwipeGesture = (handlers: SwipeHandlers, threshold: number = 50) => {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStart.current) return;

      const deltaX = e.changedTouches[0].clientX - touchStart.current.x;
      const deltaY = e.changedTouches[0].clientY - touchStart.current.y;

      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX > absY && absX > threshold) {
        if (deltaX > 0) {
          handlers.onSwipeRight?.();
        } else {
          handlers.onSwipeLeft?.();
        }
      } else if (absY > absX && absY > threshold) {
        if (deltaY > 0) {
          handlers.onSwipeDown?.();
        } else {
          handlers.onSwipeUp?.();
        }
      }

      touchStart.current = null;
    },
    [handlers, threshold]
  );

  return { onTouchStart, onTouchEnd };
};

// ─── useFocusTrap ─────────────────────────────────────────────────────────────
// Focus trap for modals

export const useFocusTrap = (isActive: boolean) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  return containerRef;
};

// ─── useCamera ────────────────────────────────────────────────────────────────
// Camera access and capture

export const useCamera = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsOpen(true);
    } catch (err) {
      setError('Camera access denied or not available');
      setIsOpen(false);
    }
  }, [facingMode]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsOpen(false);
  }, []);

  const toggleCamera = useCallback(() => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  }, []);

  const capturePhoto = useCallback((): File | null => {
    const video = videoRef.current;
    if (!video) return null;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `selfie-${Date.now()}.jpg`, {
            type: 'image/jpeg',
          });
          resolve(file);
        } else {
          resolve(null);
        }
      }, 'image/jpeg', 0.92);
    }) as unknown as File | null;
  }, []);

  // Note: Caller should manually stop and restart camera when facingMode changes
  // to avoid calling setState during effect

  return {
    videoRef,
    isOpen,
    facingMode,
    error,
    startCamera,
    stopCamera,
    toggleCamera,
    capturePhoto,
  };
};

// ─── useTimer ─────────────────────────────────────────────────────────────────
// Countdown timer for camera

export const useTimer = (initialSeconds: number = 3) => {
  const [seconds, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    setSeconds(initialSeconds);
    setIsActive(true);
  }, [initialSeconds]);

  useEffect(() => {
    if (!isActive) return;

    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          setIsActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive]);

  const reset = useCallback(() => {
    setIsActive(false);
    setSeconds(0);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  }, []);

  return { seconds, isActive, start, reset };
};

// ─── useLocalStorage ──────────────────────────────────────────────────────────
// Persistent state with localStorage

export const useLocalStorage = <T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        console.warn('Failed to save to localStorage:', error);
      }
    },
    [key, storedValue]
  );

  return [storedValue, setValue];
};

// ─── useMemoizedScenes ────────────────────────────────────────────────────────
// Efficient scene counting with memoization

export const useMemoizedScenes = <T extends { scene_label?: string }>(
  items: T[]
): Record<string, number> => {
  return useMemo(() => {
    return items.reduce((acc, item) => {
      const scene = item.scene_label;
      if (scene) {
        acc[scene] = (acc[scene] ?? 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
  }, [items]);
};
