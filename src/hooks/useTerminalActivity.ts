/**
 * useTerminalActivity Hook
 *
 * Tracks terminal output activity and detects when a terminal becomes "finished"
 * (no output for a configurable threshold duration).
 *
 * Unlike useIdleMode which tracks USER activity, this tracks PTY OUTPUT activity.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseTerminalActivityOptions {
  /** Terminal ID for tracking */
  terminalId: string;
  /** Time in ms before terminal is considered "finished" (default: 3000) */
  threshold?: number;
  /** Callback when terminal transitions to "finished" state */
  onFinished?: () => void;
  /** Whether the feature is enabled (default: true) */
  enabled?: boolean;
}

interface UseTerminalActivityReturn {
  /** Whether the terminal has finished (no output for threshold duration) */
  isFinished: boolean;
  /** Timestamp of last output */
  lastOutputAt: number;
  /** Signal that terminal received output (call from PTY onData) */
  signalOutput: () => void;
  /** Manually reset the finished state */
  reset: () => void;
}

export function useTerminalActivity(options: UseTerminalActivityOptions): UseTerminalActivityReturn {
  const {
    terminalId,
    threshold = 3000,
    onFinished,
    enabled = true,
  } = options;

  const [isFinished, setIsFinished] = useState(false);
  const [lastOutputAt, setLastOutputAt] = useState(0);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFinishedRef = useRef(false);
  const hasHadOutputRef = useRef(false); // Track if terminal ever had output
  const onFinishedRef = useRef(onFinished);

  // Keep callback ref updated
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  // Clear timeout on unmount or when disabled
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Reset when terminal ID changes
  useEffect(() => {
    setIsFinished(false);
    setLastOutputAt(0);
    isFinishedRef.current = false;
    hasHadOutputRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [terminalId]);

  // Signal output activity - call this when PTY receives data
  const signalOutput = useCallback(() => {
    if (!enabled) return;

    const now = Date.now();
    setLastOutputAt(now);
    hasHadOutputRef.current = true;

    // If was finished, reset to active
    if (isFinishedRef.current) {
      isFinishedRef.current = false;
      setIsFinished(false);
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      // Only transition to finished if we've had output before
      // (don't fire for brand new terminals)
      if (hasHadOutputRef.current && !isFinishedRef.current) {
        isFinishedRef.current = true;
        setIsFinished(true);
        onFinishedRef.current?.();
      }
    }, threshold);
  }, [enabled, threshold]);

  // Manual reset
  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    isFinishedRef.current = false;
    setIsFinished(false);
    hasHadOutputRef.current = false;
    setLastOutputAt(0);
  }, []);

  return {
    isFinished,
    lastOutputAt,
    signalOutput,
    reset,
  };
}
