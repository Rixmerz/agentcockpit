/**
 * Event Bus for Git Watcher Events
 *
 * Simple CustomEvent-based pub/sub for synchronizing
 * git status between components. Single source of truth
 * for git polling — replaces per-component polling.
 */

import { useEffect } from 'react';
import type { SyncStatus } from '../../services/gitService';

// Event data types
export interface GitWatcherStatusEvent {
  projectPath: string;
  branch: string | null;
  hasChanges: boolean;
  modifiedFiles: string[];
  stagedFiles: string[];
  untrackedFiles: string[];
  syncStatus: SyncStatus | null;
  hasRepo: boolean;
  timestamp: number;
}

export interface GitWatcherChangedEvent {
  projectPath: string;
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
  timestamp: number;
}

export interface GitWatcherErrorEvent {
  projectPath: string;
  error: string;
  timestamp: number;
}

export interface GitWatcherCommitEvent {
  projectPath: string;
  commitHash: string;
  previousHash: string | null;
  timestamp: number;
}

// Event types
type GitWatcherEventType = 'status' | 'changed' | 'commit' | 'error';

// Combined event data type
type GitWatcherEventData<T extends GitWatcherEventType> = T extends 'status'
  ? GitWatcherStatusEvent
  : T extends 'changed'
  ? GitWatcherChangedEvent
  : T extends 'commit'
  ? GitWatcherCommitEvent
  : GitWatcherErrorEvent;

// Type-safe event handlers
type GitWatcherEventHandler<T extends GitWatcherEventType> = (data: GitWatcherEventData<T>) => void;

/**
 * Emit a git watcher event
 */
function emitGitWatcherEvent<T extends GitWatcherEventType>(
  event: T,
  data: GitWatcherEventData<T>
): void {
  const customEvent = new CustomEvent(`gitwatcher:${event}`, {
    detail: data,
    bubbles: false,
    cancelable: false,
  });
  window.dispatchEvent(customEvent);
}

/**
 * Subscribe to a git watcher event
 * Returns cleanup function for useEffect
 */
function onGitWatcherEvent<T extends GitWatcherEventType>(
  event: T,
  handler: GitWatcherEventHandler<T>
): () => void {
  const listener = (e: Event) => {
    const customEvent = e as CustomEvent<GitWatcherEventData<T>>;
    handler(customEvent.detail);
  };

  window.addEventListener(`gitwatcher:${event}`, listener);

  return () => {
    window.removeEventListener(`gitwatcher:${event}`, listener);
  };
}

/**
 * Subscribe once to a git watcher event
 * Automatically unsubscribes after first emission
 */
function onceGitWatcherEvent<T extends GitWatcherEventType>(
  event: T,
  handler: GitWatcherEventHandler<T>
): () => void {
  const listener = (e: Event) => {
    const customEvent = e as CustomEvent<GitWatcherEventData<T>>;
    handler(customEvent.detail);
    window.removeEventListener(`gitwatcher:${event}`, listener);
  };

  window.addEventListener(`gitwatcher:${event}`, listener);

  return () => {
    window.removeEventListener(`gitwatcher:${event}`, listener);
  };
}

/**
 * Git Watcher Events API
 */
export const gitWatcherEvents = {
  emit: emitGitWatcherEvent,
  on: onGitWatcherEvent,
  once: onceGitWatcherEvent,
};

/**
 * Hook-friendly subscription for React components
 */
export function useGitWatcherEvent<T extends GitWatcherEventType>(
  event: T,
  handler: GitWatcherEventHandler<T>,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    return gitWatcherEvents.on(event, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}
