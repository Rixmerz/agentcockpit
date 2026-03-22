/**
 * Terminal Activity Context
 *
 * Isolated context for terminalActivity state, extracted into its own module
 * to avoid circular dependencies between AppContext and TerminalContext.
 *
 * High-frequency updates to terminalActivity (PTY output events) only re-render
 * components that consume this context, not all AppContext consumers.
 */

import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { AppAction } from '../types';
import type { TerminalActivityState } from '../types';

export interface TerminalActivityContextType {
  terminalActivity: Map<string, TerminalActivityState>;
  dispatch: Dispatch<AppAction>;
}

export const TerminalActivityContext = createContext<TerminalActivityContextType | null>(null);

export function useTerminalActivity() {
  const context = useContext(TerminalActivityContext);
  if (!context) {
    throw new Error('useTerminalActivity must be used within AppProvider');
  }
  return context;
}
