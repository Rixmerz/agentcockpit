/**
 * Settings Context
 *
 * Handles global app settings: theme, IDE, background, opacity,
 * idle timeout, and terminal notification settings.
 */

import { useContext, createContext } from 'react';
import type { AppState, AppAction, AppContextType } from './types';
import type { ThemeId } from '../types';

// Internal context reference - set by AppContext orchestrator
export const SettingsInternalContext = createContext<AppContextType | null>(null);

// ==================== Reducer ====================

export function settingsReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_DEFAULT_IDE':
      return { ...state, defaultIDE: action.payload };

    case 'SET_THEME':
      return { ...state, theme: action.payload };

    case 'SET_BACKGROUND_IMAGE':
      return { ...state, backgroundImage: action.payload };

    case 'SET_BACKGROUND_OPACITY':
      return { ...state, backgroundOpacity: action.payload };

    case 'SET_TERMINAL_OPACITY':
      return { ...state, terminalOpacity: action.payload };

    case 'SET_IDLE_TIMEOUT':
      return { ...state, idleTimeout: action.payload };

    case 'SET_TERMINAL_FINISHED_SOUND':
      return { ...state, terminalFinishedSound: action.payload };

    case 'SET_TERMINAL_FINISHED_THRESHOLD':
      return { ...state, terminalFinishedThreshold: action.payload };

    case 'SET_CUSTOM_SOUND_PATH':
      return { ...state, customSoundPath: action.payload };

    default:
      return state;
  }
}

// ==================== Hooks ====================

function useAppInternal() {
  const context = useContext(SettingsInternalContext);
  if (!context) {
    throw new Error('useAppSettings must be used within AppProvider');
  }
  return context;
}

export function useAppSettings() {
  const { state, dispatch, scheduleSave } = useAppInternal();

  return {
    defaultIDE: state.defaultIDE,
    theme: (state.theme ?? 'cyber-teal') as ThemeId,
    backgroundImage: state.backgroundImage || 'https://backiee.com/static/wallpapers/1000x563/167970.jpg',
    backgroundOpacity: state.backgroundOpacity ?? 30,
    terminalOpacity: state.terminalOpacity ?? 15,
    idleTimeout: state.idleTimeout ?? 5,
    terminalFinishedSound: state.terminalFinishedSound ?? true,
    terminalFinishedThreshold: state.terminalFinishedThreshold ?? 3,
    customSoundPath: state.customSoundPath ?? null,

    setDefaultIDE: (ide: 'cursor' | 'code' | 'antigravity' | undefined) => {
      dispatch({ type: 'SET_DEFAULT_IDE', payload: ide });
      scheduleSave();
    },

    setTheme: (theme: ThemeId) => {
      dispatch({ type: 'SET_THEME', payload: theme });
      scheduleSave();
    },

    setBackgroundImage: (image: string | undefined) => {
      dispatch({ type: 'SET_BACKGROUND_IMAGE', payload: image });
      scheduleSave();
    },

    setBackgroundOpacity: (opacity: number) => {
      dispatch({ type: 'SET_BACKGROUND_OPACITY', payload: opacity });
      scheduleSave();
    },

    setTerminalOpacity: (opacity: number) => {
      dispatch({ type: 'SET_TERMINAL_OPACITY', payload: opacity });
      scheduleSave();
    },

    setIdleTimeout: (seconds: number) => {
      dispatch({ type: 'SET_IDLE_TIMEOUT', payload: seconds });
      scheduleSave();
    },

    setTerminalFinishedSound: (enabled: boolean) => {
      dispatch({ type: 'SET_TERMINAL_FINISHED_SOUND', payload: enabled });
      scheduleSave();
    },

    setTerminalFinishedThreshold: (seconds: number) => {
      dispatch({ type: 'SET_TERMINAL_FINISHED_THRESHOLD', payload: seconds });
      scheduleSave();
    },

    setCustomSoundPath: (path: string | null) => {
      dispatch({ type: 'SET_CUSTOM_SOUND_PATH', payload: path });
      scheduleSave();
    },
  };
}
