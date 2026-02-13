/**
 * Terminal Context
 *
 * Handles PTY instance management, terminal writer registry,
 * and terminal activity tracking (finished state detection).
 */

import { useContext, useCallback, createContext } from 'react';
import type { AppState, AppAction, AppContextType } from './types';

// Internal context reference - set by AppContext orchestrator
export const TerminalInternalContext = createContext<AppContextType | null>(null);

// ==================== Reducer ====================

export function terminalReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_PTY_INSTANCE': {
      const newPtyInstances = new Map(state.ptyInstances);
      newPtyInstances.set(action.payload.terminalId, action.payload);
      return { ...state, ptyInstances: newPtyInstances };
    }

    case 'REMOVE_PTY_INSTANCE': {
      const newPtyInstances = new Map(state.ptyInstances);
      newPtyInstances.delete(action.payload);
      return { ...state, ptyInstances: newPtyInstances };
    }

    // Cross-cutting: REMOVE_TERMINAL also cleans up PTY
    case 'REMOVE_TERMINAL': {
      const newPtyInstances = new Map(state.ptyInstances);
      newPtyInstances.delete(action.payload.terminalId);
      return { ...state, ptyInstances: newPtyInstances };
    }

    case 'SET_TERMINAL_ACTIVITY': {
      const newActivity = new Map(state.terminalActivity);
      newActivity.set(action.payload.terminalId, {
        terminalId: action.payload.terminalId,
        isFinished: action.payload.isFinished,
        lastOutputAt: action.payload.lastOutputAt,
      });
      return { ...state, terminalActivity: newActivity };
    }

    case 'CLEAR_TERMINAL_ACTIVITY': {
      const newActivity = new Map(state.terminalActivity);
      newActivity.delete(action.payload);
      return { ...state, terminalActivity: newActivity };
    }

    default:
      return state;
  }
}

// ==================== Hooks ====================

function useAppInternal() {
  const context = useContext(TerminalInternalContext);
  if (!context) {
    throw new Error('useTerminalActions must be used within AppProvider');
  }
  return context;
}

export function useTerminalActions() {
  const { writeToActiveTerminal, activeTerminal } = useAppInternal();
  return {
    writeToActiveTerminal,
    hasActiveTerminal: !!activeTerminal,
  };
}

export function useTerminalActivityState() {
  const { state, dispatch } = useAppInternal();

  const setTerminalActivity = useCallback((terminalId: string, isFinished: boolean, lastOutputAt: number) => {
    dispatch({ type: 'SET_TERMINAL_ACTIVITY', payload: { terminalId, isFinished, lastOutputAt } });
  }, [dispatch]);

  const clearTerminalActivity = useCallback((terminalId: string) => {
    dispatch({ type: 'CLEAR_TERMINAL_ACTIVITY', payload: terminalId });
  }, [dispatch]);

  const isTerminalFinished = useCallback((terminalId: string) => {
    return state.terminalActivity.get(terminalId)?.isFinished ?? false;
  }, [state.terminalActivity]);

  return {
    terminalActivity: state.terminalActivity,
    setTerminalActivity,
    clearTerminalActivity,
    isTerminalFinished,
  };
}
