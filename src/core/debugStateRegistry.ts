/**
 * Debug State Registry (Singleton)
 *
 * Holds a reference to the latest React state so that
 * code outside the React tree (window.__debug) can read it.
 * AppContext calls update() on every state change (DEV only).
 */

import type { AppState, Project, Terminal } from '../types';

interface RegistrySnapshot {
  state: AppState;
  activeProject: Project | null;
  activeTerminal: Terminal | null;
  updatedAt: number;
}

let _snapshot: RegistrySnapshot | null = null;

export const debugStateRegistry = {
  update(state: AppState, activeProject: Project | null, activeTerminal: Terminal | null): void {
    _snapshot = { state, activeProject, activeTerminal, updatedAt: Date.now() };
  },

  get(): AppState | null {
    return _snapshot?.state ?? null;
  },

  getActiveProject(): Project | null {
    return _snapshot?.activeProject ?? null;
  },

  getActiveTerminal(): Terminal | null {
    return _snapshot?.activeTerminal ?? null;
  },

  getSnapshot(): RegistrySnapshot | null {
    return _snapshot;
  },
};
