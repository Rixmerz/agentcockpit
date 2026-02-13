import { useState, useRef, useEffect, useCallback } from 'react';
import { onPtyOutput, onPtyClose } from '../services/tauriService';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { ClaudeStreamEvent, ResultEvent } from '../types/claude-events';

// ============================================
// Session status
// ============================================

export type SessionStatus = 'idle' | 'running' | 'complete' | 'error';

// ============================================
// Pure NDJSON parsing logic (testable, no React)
// ============================================

export interface LineParserState {
  buffer: string;
}

export function createLineParserState(): LineParserState {
  return { buffer: '' };
}

/**
 * Feed a raw string chunk into the line parser.
 * Returns [parsed events, updated state].
 * Buffers partial lines until a newline arrives.
 */
export function feedChunk(
  state: LineParserState,
  chunk: string
): [ClaudeStreamEvent[], LineParserState] {
  const data = state.buffer + chunk;
  const lines = data.split('\n');

  // Last element is either empty (if chunk ended with \n) or a partial line
  const remainder = lines.pop() ?? '';
  const newState: LineParserState = { buffer: remainder };

  const events: ClaudeStreamEvent[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue; // skip empty lines

    try {
      const parsed = JSON.parse(trimmed) as ClaudeStreamEvent;
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        events.push(parsed);
      } else {
        console.warn('[useClaudeStream] Skipping non-event JSON line:', trimmed.slice(0, 100));
      }
    } catch {
      console.warn('[useClaudeStream] Skipping malformed JSON line:', trimmed.slice(0, 100));
    }
  }

  return [events, newState];
}

// ============================================
// Cost accumulator
// ============================================

export interface CostInfo {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

function extractCost(event: ResultEvent): CostInfo {
  return {
    totalCostUsd: event.total_cost_usd ?? 0,
    inputTokens: event.usage?.input_tokens ?? 0,
    outputTokens: event.usage?.output_tokens ?? 0,
    durationMs: event.duration_ms ?? 0,
  };
}

// ============================================
// React Hook
// ============================================

export interface UseClaudeStreamReturn {
  events: ClaudeStreamEvent[];
  status: SessionStatus;
  cost: CostInfo;
  error: string | null;
  reset: () => void;
}

const INITIAL_COST: CostInfo = {
  totalCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  durationMs: 0,
};

export function useClaudeStream(ptyId: number | null): UseClaudeStreamReturn {
  const [events, setEvents] = useState<ClaudeStreamEvent[]>([]);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [cost, setCost] = useState<CostInfo>(INITIAL_COST);
  const [error, setError] = useState<string | null>(null);

  const parserStateRef = useRef<LineParserState>(createLineParserState());
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenCloseRef = useRef<UnlistenFn | null>(null);

  const reset = useCallback(() => {
    setEvents([]);
    setStatus('idle');
    setCost(INITIAL_COST);
    setError(null);
    parserStateRef.current = createLineParserState();
  }, []);

  useEffect(() => {
    if (ptyId === null) return;

    // Mark as running when we start listening
    setStatus('running');
    parserStateRef.current = createLineParserState();

    let cancelled = false;

    const setup = async () => {
      unlistenOutputRef.current = await onPtyOutput(ptyId, (chunk) => {
        if (cancelled) return;

        const [parsed, newState] = feedChunk(parserStateRef.current, chunk);
        parserStateRef.current = newState;

        if (parsed.length === 0) return;

        setEvents((prev) => [...prev, ...parsed]);

        // Process status-changing events
        for (const event of parsed) {
          if (event.type === 'result') {
            setCost(extractCost(event));
            if (event.subtype === 'error') {
              setStatus('error');
              setError(event.error ?? 'Unknown error');
            } else {
              setStatus('complete');
            }
          }
        }
      });

      unlistenCloseRef.current = await onPtyClose(ptyId, () => {
        if (cancelled) return;
        // If PTY closes without a result event, mark as error
        setStatus((prev) => (prev === 'running' ? 'error' : prev));
      });
    };

    setup();

    return () => {
      cancelled = true;
      unlistenOutputRef.current?.();
      unlistenCloseRef.current?.();
    };
  }, [ptyId]);

  return { events, status, cost, error, reset };
}
