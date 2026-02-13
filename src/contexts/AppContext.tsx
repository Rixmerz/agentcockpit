/**
 * App Context - Orchestrator
 *
 * Composes domain-specific reducers (Project, Settings, Terminal),
 * coordinates persistence, and provides backward-compatible hooks.
 */

import { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AppState, AppAction, Project, Terminal } from '../types';
import type { AppContextType, TerminalWriter } from './types';
import { usePersistence } from '../hooks/usePersistence';
import { ptyClose } from '../services/tauriService';
import { cleanStaleSessionsOnStartup } from '../services/projectSessionService';
import { hasLocalGitRepo, initRepository } from '../services/gitService';

// Domain reducers
import { projectReducer } from './ProjectContext';
import { settingsReducer } from './SettingsContext';
import { terminalReducer } from './TerminalContext';

// Domain context references (shared context, one provider)
import { ProjectInternalContext } from './ProjectContext';
import { SettingsInternalContext } from './SettingsContext';
import { TerminalInternalContext } from './TerminalContext';

// ==================== Initial State ====================

const initialState: AppState = {
  projects: [],
  activeProjectId: null,
  activeTerminalId: null,
  selectedModel: 'sonnet',
  mcpDesktopEnabled: false,
  mcpDefaultEnabled: true,
  defaultIDE: undefined,
  theme: 'cyber-teal',
  backgroundImage: 'https://backiee.com/static/wallpapers/1000x563/167970.jpg',
  backgroundOpacity: 30,
  terminalOpacity: 15,
  idleTimeout: 5,
  terminalFinishedSound: true,
  terminalFinishedThreshold: 3,
  customSoundPath: null,
  ptyInstances: new Map(),
  isLoading: true,
  terminalActivity: new Map(),
};

// ==================== Combined Reducer ====================

function appReducer(state: AppState, action: AppAction): AppState {
  // LOAD_CONFIG is cross-cutting - handled here
  if (action.type === 'LOAD_CONFIG') {
    return {
      ...state,
      ...action.payload,
      ptyInstances: new Map(),
      isLoading: false,
    };
  }

  // Chain domain reducers
  let newState = state;
  newState = projectReducer(newState, action);
  newState = settingsReducer(newState, action);
  newState = terminalReducer(newState, action);
  return newState;
}

// ==================== Unified Context ====================

const AppContext = createContext<AppContextType | null>(null);

// ==================== Provider ====================

interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Terminal writers registry
  const terminalWritersRef = useRef<Map<string, TerminalWriter>>(new Map());

  // PTY ID registry (terminalId -> ptyId)
  const ptyIdMapRef = useRef<Map<string, number>>(new Map());

  // State ref for persistence
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Persistence
  const { scheduleSave } = usePersistence({
    onLoad: useCallback((config) => {
      if (config) {
        dispatch({ type: 'LOAD_CONFIG', payload: config });
      } else {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }, []),
    getState: useCallback(() => ({
      projects: stateRef.current.projects,
      activeProjectId: stateRef.current.activeProjectId,
      activeTerminalId: stateRef.current.activeTerminalId,
      selectedModel: stateRef.current.selectedModel,
      mcpDesktopEnabled: stateRef.current.mcpDesktopEnabled,
      mcpDefaultEnabled: stateRef.current.mcpDefaultEnabled,
      defaultIDE: stateRef.current.defaultIDE,
      theme: stateRef.current.theme,
      backgroundImage: stateRef.current.backgroundImage,
      backgroundOpacity: stateRef.current.backgroundOpacity,
      terminalOpacity: stateRef.current.terminalOpacity,
      idleTimeout: stateRef.current.idleTimeout,
      terminalFinishedSound: stateRef.current.terminalFinishedSound,
      terminalFinishedThreshold: stateRef.current.terminalFinishedThreshold,
      customSoundPath: stateRef.current.customSoundPath,
    }), []),
  });

  // Clean up stale sessions on startup
  useEffect(() => {
    if (!state.isLoading && state.projects.length > 0) {
      state.projects.forEach(project => {
        cleanStaleSessionsOnStartup(project.path)
          .catch(err => console.error(`[SessionCleanup] Failed for ${project.name}:`, err));
      });
    }
  }, [state.isLoading]);

  // Convenience getters
  const activeProject = state.projects.find(p => p.id === state.activeProjectId) || null;
  const activeTerminal = activeProject?.terminals.find(t => t.id === state.activeTerminalId) || null;

  const generateId = () => crypto.randomUUID();

  // ==================== Actions ====================

  const addProject = useCallback((name: string, path: string) => {
    const projectId = generateId();
    const terminalId = generateId();
    const terminal: Terminal = { id: terminalId, name: 'Terminal 1', createdAt: Date.now() };
    const project: Project = { id: projectId, name, path, terminals: [terminal], createdAt: Date.now() };

    dispatch({ type: 'ADD_PROJECT', payload: project });
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId });
    dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: terminalId });
    scheduleSave();

    // Auto git init if project has no .git
    hasLocalGitRepo(path).then(hasRepo => {
      if (!hasRepo) initRepository(path).catch(console.warn);
    });
  }, [scheduleSave]);

  const removeProject = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_PROJECT', payload: id });
    scheduleSave();
  }, [scheduleSave]);

  const addTerminal = useCallback((projectId: string, name: string) => {
    const terminal: Terminal = { id: generateId(), name, createdAt: Date.now() };
    dispatch({ type: 'ADD_TERMINAL', payload: { projectId, terminal } });
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId });
    dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: terminal.id });
  }, []);

  const removeTerminal = useCallback(async (projectId: string, terminalId: string) => {
    const ptyId = ptyIdMapRef.current.get(terminalId);
    if (ptyId !== undefined) {
      try {
        await ptyClose(ptyId);
      } catch (err) {
        console.error(`Failed to close PTY ${ptyId}:`, err);
      }
      ptyIdMapRef.current.delete(terminalId);
    }
    dispatch({ type: 'REMOVE_TERMINAL', payload: { projectId, terminalId } });
  }, []);

  const renameTerminal = useCallback((projectId: string, terminalId: string, name: string) => {
    dispatch({ type: 'RENAME_TERMINAL', payload: { projectId, terminalId, name } });
  }, []);

  const setActiveTerminal = useCallback((projectId: string, terminalId: string) => {
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId });
    dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: terminalId });
  }, []);

  // Terminal writer registry
  const registerTerminalWriter = useCallback((terminalId: string, writer: TerminalWriter) => {
    terminalWritersRef.current.set(terminalId, writer);
  }, []);

  const unregisterTerminalWriter = useCallback((terminalId: string) => {
    terminalWritersRef.current.delete(terminalId);
  }, []);

  const registerPtyId = useCallback((terminalId: string, ptyId: number) => {
    ptyIdMapRef.current.set(terminalId, ptyId);
  }, []);

  const unregisterPtyId = useCallback((terminalId: string) => {
    ptyIdMapRef.current.delete(terminalId);
  }, []);

  const writeToActiveTerminal = useCallback(async (data: string) => {
    if (!state.activeTerminalId) {
      console.warn('No active terminal to write to');
      return;
    }
    const writer = terminalWritersRef.current.get(state.activeTerminalId);
    if (writer) {
      await writer(data);
    } else {
      console.warn(`No writer registered for terminal ${state.activeTerminalId}`);
    }
  }, [state.activeTerminalId]);

  const value: AppContextType = {
    state,
    dispatch,
    activeProject,
    activeTerminal,
    addProject,
    removeProject,
    addTerminal,
    removeTerminal,
    renameTerminal,
    setActiveTerminal,
    registerTerminalWriter,
    unregisterTerminalWriter,
    writeToActiveTerminal,
    registerPtyId,
    unregisterPtyId,
    scheduleSave,
  };

  return (
    <AppContext.Provider value={value}>
      <ProjectInternalContext.Provider value={value}>
        <SettingsInternalContext.Provider value={value}>
          <TerminalInternalContext.Provider value={value}>
            {children}
          </TerminalInternalContext.Provider>
        </SettingsInternalContext.Provider>
      </ProjectInternalContext.Provider>
    </AppContext.Provider>
  );
}

// ==================== Backward-Compatible Hooks ====================

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

// Re-export domain hooks for backward compatibility
export { useProjects, useTerminals, useSettings } from './ProjectContext';
export { useAppSettings } from './SettingsContext';
export { useTerminalActions, useTerminalActivityState } from './TerminalContext';
