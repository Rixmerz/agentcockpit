/**
 * Event Bus for Snapshot Events
 *
 * Simple CustomEvent-based pub/sub for synchronizing
 * snapshot creation/restoration between components.
 */

import { useEffect } from 'react';

// Event data types
export interface SnapshotCreatedEvent {
  version: number;
  projectPath: string;
  commitHash: string;
  timestamp: number;
}

export interface SnapshotRestoredEvent {
  version: number;
  projectPath: string;
}

export interface SnapshotCleanupEvent {
  projectPath: string;
  count: number;
}

// Event types
type SnapshotEventType = 'created' | 'restored' | 'cleanup';

// Combined event data type
type SnapshotEventData<T extends SnapshotEventType> = T extends 'created'
  ? SnapshotCreatedEvent
  : T extends 'restored'
  ? SnapshotRestoredEvent
  : SnapshotCleanupEvent;

// Type-safe event handlers
type SnapshotEventHandler<T extends SnapshotEventType> = (data: SnapshotEventData<T>) => void;

/**
 * Emit a snapshot event
 */
function emitSnapshotEvent<T extends SnapshotEventType>(
  event: T,
  data: SnapshotEventData<T>
): void {
  console.log(`[EventBus] Emitting snapshot:${event}`, data);
  const customEvent = new CustomEvent(`snapshot:${event}`, {
    detail: data,
    bubbles: false,
    cancelable: false,
  });
  window.dispatchEvent(customEvent);
}

/**
 * Subscribe to a snapshot event
 * Returns cleanup function for useEffect
 */
function onSnapshotEvent<T extends SnapshotEventType>(
  event: T,
  handler: SnapshotEventHandler<T>
): () => void {
  const listener = (e: Event) => {
    const customEvent = e as CustomEvent<SnapshotEventData<T>>;
    console.log(`[EventBus] Received snapshot:${event}`, customEvent.detail);
    handler(customEvent.detail);
  };

  window.addEventListener(`snapshot:${event}`, listener);

  // Return cleanup function
  return () => {
    window.removeEventListener(`snapshot:${event}`, listener);
  };
}

/**
 * Subscribe once to a snapshot event
 * Automatically unsubscribes after first emission
 */
function onceSnapshotEvent<T extends SnapshotEventType>(
  event: T,
  handler: SnapshotEventHandler<T>
): () => void {
  const listener = (e: Event) => {
    const customEvent = e as CustomEvent<SnapshotEventData<T>>;
    handler(customEvent.detail);
    window.removeEventListener(`snapshot:${event}`, listener);
  };

  window.addEventListener(`snapshot:${event}`, listener);

  // Return cleanup function (in case caller wants to cancel before event fires)
  return () => {
    window.removeEventListener(`snapshot:${event}`, listener);
  };
}

/**
 * Snapshot Events API
 *
 * Usage:
 * ```typescript
 * // Emit event (from usePty.ts after creating snapshot)
 * snapshotEvents.emit('created', { version: 1, projectPath: '/path', commitHash: 'abc123', timestamp: Date.now() });
 *
 * // Listen for events (in SnapshotSelector.tsx)
 * useEffect(() => {
 *   return snapshotEvents.on('created', (data) => {
 *     console.log('Snapshot created:', data.version);
 *     refreshSnapshots();
 *   });
 * }, []);
 * ```
 */
export const snapshotEvents = {
  emit: emitSnapshotEvent,
  on: onSnapshotEvent,
  once: onceSnapshotEvent,
};

/**
 * Hook-friendly subscription for React components
 *
 * Usage:
 * ```typescript
 * function MyComponent() {
 *   useSnapshotEvent('created', (data) => {
 *     console.log('New snapshot:', data.version);
 *   });
 * }
 * ```
 */
export function useSnapshotEvent<T extends SnapshotEventType>(
  event: T,
  handler: SnapshotEventHandler<T>,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    return snapshotEvents.on(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
