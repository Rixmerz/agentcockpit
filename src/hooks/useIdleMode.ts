/**
 * useIdleMode Hook
 *
 * Tracks user activity and triggers idle mode after inactivity.
 * - 10 seconds of inactivity → start fade to transparent
 * - Any activity → immediately restore opacity
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

interface UseIdleModeOptions {
  /** Time in ms before entering idle mode (default: 10000) */
  idleTimeout?: number;
  /** Events to track for activity */
  trackEvents?: string[];
}

interface UseIdleModeReturn {
  /** Whether the app is in idle mode */
  isIdle: boolean;
  /** Manually signal activity (e.g., from terminal input) */
  signalActivity: () => void;
}

// Default events to track - defined outside to maintain stable reference
const DEFAULT_TRACK_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

export function useIdleMode(options: UseIdleModeOptions = {}): UseIdleModeReturn {
  const { idleTimeout = 10000 } = options;

  // If idleTimeout is 0, feature is disabled
  const isDisabled = idleTimeout === 0;

  // Memoize trackEvents to prevent useEffect from re-running
  const trackEvents = useMemo(
    () => options.trackEvents || DEFAULT_TRACK_EVENTS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.trackEvents?.join(',')]
  );

  const [isIdle, setIsIdle] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIdleRef = useRef(false); // For immediate access in callbacks
  const initializedRef = useRef(false); // Prevent double initialization

  // Reset the idle timer
  const resetTimer = useCallback(() => {
    // If disabled, do nothing
    if (isDisabled) return;

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // If currently idle, immediately exit idle mode
    if (isIdleRef.current) {
      isIdleRef.current = false;
      setIsIdle(false);
      console.log('[IdleMode] Activity detected, exiting idle mode');
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      isIdleRef.current = true;
      setIsIdle(true);
      console.log('[IdleMode] Entering idle mode');
    }, idleTimeout);
  }, [idleTimeout, isDisabled]);

  // Manual activity signal (for terminal input, etc.)
  const signalActivity = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  // Set up event listeners
  useEffect(() => {
    // If disabled, ensure we're not idle and skip setup
    if (isDisabled) {
      if (isIdleRef.current) {
        isIdleRef.current = false;
        setIsIdle(false);
      }
      return;
    }

    // Throttle function to avoid excessive calls
    let lastCall = 0;
    const throttleMs = 100;

    const createHandler = (eventType: string) => () => {
      const now = Date.now();
      if (now - lastCall >= throttleMs) {
        lastCall = now;
        // Only log if we're actually in idle mode (to avoid spam)
        if (isIdleRef.current) {
          console.log(`[IdleMode] Activity from: ${eventType}`);
        }
        resetTimer();
      }
    };

    // Create handlers for each event type
    const handlers = new Map<string, () => void>();
    trackEvents.forEach(event => {
      const handler = createHandler(event);
      handlers.set(event, handler);
      window.addEventListener(event, handler, { passive: true });
    });

    // Initialize timer only once
    if (!initializedRef.current) {
      initializedRef.current = true;
      resetTimer();
    }

    // Cleanup
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      handlers.forEach((handler, event) => {
        window.removeEventListener(event, handler);
      });
    };
  }, [trackEvents, resetTimer, isDisabled]);

  return { isIdle, signalActivity };
}
