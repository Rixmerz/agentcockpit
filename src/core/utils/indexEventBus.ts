/**
 * Event Bus for Index Events (DeltaCodeCube)
 *
 * Simple CustomEvent-based pub/sub for synchronizing
 * indexing state between components.
 */

import { useEffect } from 'react';

// Event data types
export interface IndexingEvent {
  projectPath: string;
  timestamp: number;
}

export interface IndexedEvent {
  projectPath: string;
  totalFiles: number;
  grade: string;
  score: number;
  timestamp: number;
}

export interface IndexErrorEvent {
  projectPath: string;
  error: string;
  timestamp: number;
}

export interface TensionsDetectedEvent {
  projectPath: string;
  count: number;
  timestamp: number;
}

export interface FileChangeEvent {
  projectPath: string;
  files: string[];
  timestamp: number;
}

export interface MidPhaseResult {
  projectPath: string;
  smellsSummary: string | null;
  tensionsSummary: string | null;
  filesChecked: number;
  timestamp: number;
}

// Event types
type IndexEventType = 'indexing' | 'indexed' | 'error' | 'tensions_detected' | 'file_change' | 'mid_phase_result';

// Combined event data type
type IndexEventData<T extends IndexEventType> = T extends 'indexing'
  ? IndexingEvent
  : T extends 'indexed'
  ? IndexedEvent
  : T extends 'error'
  ? IndexErrorEvent
  : T extends 'tensions_detected'
  ? TensionsDetectedEvent
  : T extends 'file_change'
  ? FileChangeEvent
  : MidPhaseResult;

// Type-safe event handlers
type IndexEventHandler<T extends IndexEventType> = (data: IndexEventData<T>) => void;

/**
 * Emit an index event
 */
function emitIndexEvent<T extends IndexEventType>(
  event: T,
  data: IndexEventData<T>
): void {
  const customEvent = new CustomEvent(`index:${event}`, {
    detail: data,
    bubbles: false,
    cancelable: false,
  });
  window.dispatchEvent(customEvent);
}

/**
 * Subscribe to an index event
 * Returns cleanup function for useEffect
 */
function onIndexEvent<T extends IndexEventType>(
  event: T,
  handler: IndexEventHandler<T>
): () => void {
  const listener = (e: Event) => {
    const customEvent = e as CustomEvent<IndexEventData<T>>;
    handler(customEvent.detail);
  };

  window.addEventListener(`index:${event}`, listener);

  return () => {
    window.removeEventListener(`index:${event}`, listener);
  };
}

/**
 * Subscribe once to an index event
 * Automatically unsubscribes after first emission
 */
function onceIndexEvent<T extends IndexEventType>(
  event: T,
  handler: IndexEventHandler<T>
): () => void {
  const listener = (e: Event) => {
    const customEvent = e as CustomEvent<IndexEventData<T>>;
    handler(customEvent.detail);
    window.removeEventListener(`index:${event}`, listener);
  };

  window.addEventListener(`index:${event}`, listener);

  return () => {
    window.removeEventListener(`index:${event}`, listener);
  };
}

/**
 * Index Events API
 */
export const indexEvents = {
  emit: emitIndexEvent,
  on: onIndexEvent,
  once: onceIndexEvent,
};

/**
 * Hook-friendly subscription for React components
 */
export function useIndexEvent<T extends IndexEventType>(
  event: T,
  handler: IndexEventHandler<T>,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    return indexEvents.on(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
