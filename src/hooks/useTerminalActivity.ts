/**
 * useTerminalActivity Hook
 *
 * Tracks terminal output activity and detects when a terminal becomes "finished"
 * (no output for a configurable threshold duration).
 *
 * Features:
 * - Ignores output that occurs immediately after user input (prevents false positives from shell echo)
 * - Two-phase confirmation: cooldown period + confirmation period before triggering
 * - Any output during either phase resets the entire cycle
 *
 * Unlike useIdleMode which tracks USER activity, this tracks PTY OUTPUT activity.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/** Time window after user input during which output is ignored (ms) */
const USER_INPUT_GRACE_PERIOD = 1000;

/** Confirmation period after initial cooldown (ms) */
const CONFIRMATION_PERIOD = 1500;

interface UseTerminalActivityOptions {
  /** Terminal ID for tracking */
  terminalId: string;
  /** Time in ms before terminal enters confirmation phase (default: 3000) */
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
  /** Signal that user provided input (call from terminal onData) */
  signalUserInput: () => void;
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

  // Phase 1: Cooldown timer
  const cooldownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 2: Confirmation timer
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFinishedRef = useRef(false);
  const hasHadOutputRef = useRef(false);
  const lastUserInputAtRef = useRef(0);
  const onFinishedRef = useRef(onFinished);

  // Keep callback ref updated
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  // Clear all timeouts
  const clearAllTimeouts = useCallback(() => {
    if (cooldownTimeoutRef.current) {
      clearTimeout(cooldownTimeoutRef.current);
      cooldownTimeoutRef.current = null;
    }
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
  }, []);

  // Clear timeouts on unmount
  useEffect(() => {
    return () => clearAllTimeouts();
  }, [clearAllTimeouts]);

  // Reset when terminal ID changes
  useEffect(() => {
    setIsFinished(false);
    setLastOutputAt(0);
    isFinishedRef.current = false;
    hasHadOutputRef.current = false;
    lastUserInputAtRef.current = 0;
    clearAllTimeouts();
  }, [terminalId, clearAllTimeouts]);

  // Signal user input - prevents output from triggering timer for a grace period
  const signalUserInput = useCallback(() => {
    lastUserInputAtRef.current = Date.now();
    // User is actively typing - cancel any pending notifications
    clearAllTimeouts();
  }, [clearAllTimeouts]);

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

    // Ignore output if user just typed (within grace period)
    // This prevents shell echo/autocomplete from triggering the timer
    const timeSinceUserInput = now - lastUserInputAtRef.current;
    if (timeSinceUserInput < USER_INPUT_GRACE_PERIOD) {
      // User is actively typing, don't start timer
      clearAllTimeouts();
      return;
    }

    // Clear existing timeouts - any output resets the cycle
    clearAllTimeouts();

    // Phase 1: Cooldown period
    cooldownTimeoutRef.current = setTimeout(() => {
      // Check again if user typed during cooldown
      const currentTimeSinceInput = Date.now() - lastUserInputAtRef.current;
      if (currentTimeSinceInput < USER_INPUT_GRACE_PERIOD) {
        // User started typing during cooldown, abort
        return;
      }

      // Phase 2: Confirmation period
      confirmTimeoutRef.current = setTimeout(() => {
        // Final check: user didn't type during confirmation
        const finalTimeSinceInput = Date.now() - lastUserInputAtRef.current;
        if (finalTimeSinceInput < USER_INPUT_GRACE_PERIOD) {
          return;
        }

        // All conditions met - terminal is finished
        if (hasHadOutputRef.current && !isFinishedRef.current) {
          isFinishedRef.current = true;
          setIsFinished(true);
          onFinishedRef.current?.();
        }
      }, CONFIRMATION_PERIOD);
    }, threshold);
  }, [enabled, threshold, clearAllTimeouts]);

  // Manual reset
  const reset = useCallback(() => {
    clearAllTimeouts();
    isFinishedRef.current = false;
    setIsFinished(false);
    hasHadOutputRef.current = false;
    lastUserInputAtRef.current = 0;
    setLastOutputAt(0);
  }, [clearAllTimeouts]);

  return {
    isFinished,
    lastOutputAt,
    signalOutput,
    signalUserInput,
    reset,
  };
}
