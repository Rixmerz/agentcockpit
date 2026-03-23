/**
 * App Context - Orchestrator
 *
 * Composes domain-specific reducers (Project, Settings, Terminal),
 * coordinates persistence, and provides backward-compatible hooks.
 */

import { createContext, useContext, useReducer, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AppState, AppAction, Project, Terminal } from '../types';
import type { AppContextType, TerminalWriter } from './types';
import { usePersistence } from '../hooks/usePersistence';
import { debugStateRegistry } from '../core/debugStateRegistry';
import { ptyClose } from '../services/tauriService';
import { hasLocalGitRepo, initRepository } from '../services/gitService';
import { setupProjectDefaults } from '../services/hookService';
// Domain reducers
import { projectReducer } from './ProjectContext';
import { settingsReducer } from './SettingsContext';
import { terminalReducer } from './TerminalContext';

// Domain context references (shared context, one provider)
import { ProjectInternalContext } from './ProjectContext';
import { SettingsInternalContext } from './SettingsContext';
import { TerminalInternalContext } from './TerminalContext';

// Terminal activity isolated context (separate module to avoid circular deps)
import { TerminalActivityContext, useTerminalActivity } from './TerminalActivityContext';
import type { TerminalActivityContextType } from './TerminalActivityContext';
export { TerminalActivityContext, useTerminalActivity };

// ==================== Stable Utilities ====================

// generateId is a pure function with no dependencies — keep it at module scope
// so it never changes identity and doesn't need to be in useCallback deps.
const generateId = () => crypto.randomUUID();

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

  // Stable state reference that only changes identity when fields OTHER than
  // terminalActivity change. This prevents terminalActivity updates (high-frequency)
  // from invalidating the main AppContext value memo and re-rendering all consumers.
  const stableStateRef = useRef(state);
  const prevNonActivityStateRef = useRef({
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeTerminalId: state.activeTerminalId,
    selectedModel: state.selectedModel,
    mcpDesktopEnabled: state.mcpDesktopEnabled,
    mcpDefaultEnabled: state.mcpDefaultEnabled,
    defaultIDE: state.defaultIDE,
    theme: state.theme,
    backgroundImage: state.backgroundImage,
    backgroundOpacity: state.backgroundOpacity,
    terminalOpacity: state.terminalOpacity,
    idleTimeout: state.idleTimeout,
    terminalFinishedSound: state.terminalFinishedSound,
    terminalFinishedThreshold: state.terminalFinishedThreshold,
    customSoundPath: state.customSoundPath,
    ptyInstances: state.ptyInstances,
    isLoading: state.isLoading,
  });
  // Check if any non-activity field changed; only then update stableStateRef
  const nonActivity = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeTerminalId: state.activeTerminalId,
    selectedModel: state.selectedModel,
    mcpDesktopEnabled: state.mcpDesktopEnabled,
    mcpDefaultEnabled: state.mcpDefaultEnabled,
    defaultIDE: state.defaultIDE,
    theme: state.theme,
    backgroundImage: state.backgroundImage,
    backgroundOpacity: state.backgroundOpacity,
    terminalOpacity: state.terminalOpacity,
    idleTimeout: state.idleTimeout,
    terminalFinishedSound: state.terminalFinishedSound,
    terminalFinishedThreshold: state.terminalFinishedThreshold,
    customSoundPath: state.customSoundPath,
    ptyInstances: state.ptyInstances,
    isLoading: state.isLoading,
  };
  const prev = prevNonActivityStateRef.current;
  const nonActivityChanged = (Object.keys(nonActivity) as Array<keyof typeof nonActivity>).some(
    k => nonActivity[k] !== prev[k]
  );
  if (nonActivityChanged) {
    prevNonActivityStateRef.current = nonActivity;
    stableStateRef.current = state;
  }

  // Sync state to debug registry (DEV only)
  // activeProject/activeTerminal are computed inline here to avoid
  // creating derived variables that would need their own deps tracking.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const ap = state.projects.find(p => p.id === state.activeProjectId) || null;
      const at = ap?.terminals.find(t => t.id === state.activeTerminalId) || null;
      debugStateRegistry.update(state, ap, at);
    }
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

    // Install AgentCockpit defaults (rules, hooks, commands)
    setupProjectDefaults(path).catch(console.warn);

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

  // Separate memoized value for terminalActivity — high-frequency updates
  // must NOT invalidate the main AppContext value (which would re-render all consumers).
  const terminalActivityValue = useMemo<TerminalActivityContextType>(() => ({
    terminalActivity: state.terminalActivity,
    dispatch,
  }), [state.terminalActivity]);

  // Use stableStateRef.current so that terminalActivity changes (high-frequency)
  // do NOT invalidate this memo and re-render all AppContext consumers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value: AppContextType = useMemo(() => {
    const stableState = stableStateRef.current;
    const activeProject = stableState.projects.find(p => p.id === stableState.activeProjectId) || null;
    const activeTerminal = activeProject?.terminals.find(t => t.id === stableState.activeTerminalId) || null;
    return {
      state: stableState,
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
  // stableStateRef.current is intentionally NOT in deps — it's a ref.
  // We depend on nonActivityChanged (captured via prevNonActivityStateRef) instead.
  // The linter sees this as exhaustive because we suppress the warning above.
  }, [
    nonActivityChanged,
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
  ]);

  return (
    <AppContext.Provider value={value}>
      <TerminalActivityContext.Provider value={terminalActivityValue}>
        <ProjectInternalContext.Provider value={value}>
          <SettingsInternalContext.Provider value={value}>
            <TerminalInternalContext.Provider value={value}>
              {children}
            </TerminalInternalContext.Provider>
          </SettingsInternalContext.Provider>
        </ProjectInternalContext.Provider>
      </TerminalActivityContext.Provider>
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
