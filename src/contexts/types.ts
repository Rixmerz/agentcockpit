/**
 * Shared context types for the AppContext system.
 *
 * The AppState and AppAction types are shared across all domain contexts
 * (ProjectContext, SettingsContext, TerminalContext).
 */

import type React from 'react';
import type { AppState, AppAction, Project, Terminal } from '../types';

// Terminal writer type
export type TerminalWriter = (data: string) => Promise<void>;

// Internal context type - used by the unified AppContext provider
export interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  // Convenience getters
  activeProject: Project | null;
  activeTerminal: Terminal | null;
  // Project actions
  addProject: (name: string, path: string) => void;
  removeProject: (id: string) => void;
  addTerminal: (projectId: string, name: string) => void;
  removeTerminal: (projectId: string, terminalId: string) => Promise<void>;
  renameTerminal: (projectId: string, terminalId: string, name: string) => void;
  setActiveTerminal: (projectId: string, terminalId: string) => void;
  // Terminal writer registry
  registerTerminalWriter: (terminalId: string, writer: TerminalWriter) => void;
  unregisterTerminalWriter: (terminalId: string) => void;
  writeToActiveTerminal: (data: string) => Promise<void>;
  // PTY registry
  registerPtyId: (terminalId: string, ptyId: number) => void;
  unregisterPtyId: (terminalId: string) => void;
  // Persistence
  scheduleSave: () => void;
}

// Re-export types for convenience
export type { AppState, AppAction, Project, Terminal };
