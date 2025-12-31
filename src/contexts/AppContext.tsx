import React, { createContext, useContext, useReducer, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AppState, AppAction, Project, Terminal } from '../types';
import { usePersistence } from '../hooks/usePersistence';
import { ptyClose } from '../services/tauriService';
import { cleanStaleSessionsOnStartup } from '../services/projectSessionService';

// Initial state
const initialState: AppState = {
  projects: [],
  activeProjectId: null,
  activeTerminalId: null,
  selectedModel: 'sonnet',
  mcpDesktopEnabled: false,
  mcpDefaultEnabled: true,
  // Global settings
  defaultIDE: undefined,
  backgroundImage: undefined,
  backgroundOpacity: 30, // Default 30%
  terminalOpacity: 15, // Default 15% (semi-transparent)
  idleTimeout: 5, // Default 5 seconds
  ptyInstances: new Map(),
  isLoading: true,
};

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };

    case 'ADD_PROJECT':
      return { ...state, projects: [...state.projects, action.payload] };

    case 'REMOVE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter(p => p.id !== action.payload),
        activeProjectId: state.activeProjectId === action.payload ? null : state.activeProjectId,
      };

    case 'SET_ACTIVE_PROJECT':
      return { ...state, activeProjectId: action.payload };

    case 'ADD_TERMINAL': {
      const { projectId, terminal } = action.payload;
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === projectId
            ? { ...p, terminals: [...p.terminals, terminal] }
            : p
        ),
      };
    }

    case 'REMOVE_TERMINAL': {
      const { projectId, terminalId } = action.payload;
      const newPtyInstances = new Map(state.ptyInstances);
      newPtyInstances.delete(terminalId);
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === projectId
            ? { ...p, terminals: p.terminals.filter(t => t.id !== terminalId) }
            : p
        ),
        activeTerminalId: state.activeTerminalId === terminalId ? null : state.activeTerminalId,
        ptyInstances: newPtyInstances,
      };
    }

    case 'RENAME_TERMINAL': {
      const { projectId, terminalId, name } = action.payload;
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === projectId
            ? {
                ...p,
                terminals: p.terminals.map(t =>
                  t.id === terminalId ? { ...t, name } : t
                ),
              }
            : p
        ),
      };
    }

    case 'SET_ACTIVE_TERMINAL':
      return { ...state, activeTerminalId: action.payload };

    case 'SET_MODEL':
      return { ...state, selectedModel: action.payload };

    case 'TOGGLE_MCP_DESKTOP':
      return { ...state, mcpDesktopEnabled: !state.mcpDesktopEnabled };

    case 'TOGGLE_MCP_DEFAULT':
      return { ...state, mcpDefaultEnabled: !state.mcpDefaultEnabled };

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

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'LOAD_CONFIG':
      return {
        ...state,
        ...action.payload,
        ptyInstances: new Map(),
        isLoading: false,
      };

    // Global settings actions
    case 'SET_DEFAULT_IDE':
      return { ...state, defaultIDE: action.payload };

    case 'SET_BACKGROUND_IMAGE':
      return { ...state, backgroundImage: action.payload };

    case 'SET_BACKGROUND_OPACITY':
      return { ...state, backgroundOpacity: action.payload };

    case 'SET_TERMINAL_OPACITY':
      return { ...state, terminalOpacity: action.payload };

    case 'SET_IDLE_TIMEOUT':
      return { ...state, idleTimeout: action.payload };

    default:
      return state;
  }
}

// Terminal writer type
type TerminalWriter = (data: string) => Promise<void>;

// Context types
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  // Convenience getters
  activeProject: Project | null;
  activeTerminal: Terminal | null;
  // Actions
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

const AppContext = createContext<AppContextType | null>(null);

// Provider component
interface AppProviderProps {
  children: ReactNode;
}

export function AppProvider({ children }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Terminal writers registry
  const terminalWritersRef = useRef<Map<string, TerminalWriter>>(new Map());

  // PTY ID registry (terminalId -> ptyId)
  const ptyIdMapRef = useRef<Map<string, number>>(new Map());

  // State ref for persistence (to avoid stale closures)
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
        // No config found, just mark as loaded
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
      // Global settings
      defaultIDE: stateRef.current.defaultIDE,
      backgroundImage: stateRef.current.backgroundImage,
      backgroundOpacity: stateRef.current.backgroundOpacity,
      terminalOpacity: stateRef.current.terminalOpacity,
      idleTimeout: stateRef.current.idleTimeout,
    }), []),
  });

  // Clean up stale sessions on startup for all loaded projects
  useEffect(() => {
    if (!state.isLoading && state.projects.length > 0) {
      // Clean stale sessions for each project
      state.projects.forEach(project => {
        cleanStaleSessionsOnStartup(project.path)
          .catch(err => console.error(`[SessionCleanup] Failed for ${project.name}:`, err));
      });
    }
  }, [state.isLoading]); // Only run once when loading completes

  // Convenience getters
  const activeProject = state.projects.find(p => p.id === state.activeProjectId) || null;
  const activeTerminal = activeProject?.terminals.find(t => t.id === state.activeTerminalId) || null;

  // Generate UUID
  const generateId = () => crypto.randomUUID();

  // Actions
  const addProject = useCallback((name: string, path: string) => {
    const projectId = generateId();
    const terminalId = generateId();

    // Create project with first terminal included
    const terminal: Terminal = {
      id: terminalId,
      name: 'Terminal 1',
      createdAt: Date.now(),
    };

    const project: Project = {
      id: projectId,
      name,
      path,
      terminals: [terminal],
      createdAt: Date.now(),
    };

    dispatch({ type: 'ADD_PROJECT', payload: project });
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId });
    dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: terminalId });
    scheduleSave();
  }, [scheduleSave]);

  const removeProject = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_PROJECT', payload: id });
    scheduleSave();
  }, [scheduleSave]);

  const addTerminal = useCallback((projectId: string, name: string) => {
    const terminal: Terminal = {
      id: generateId(),
      name,
      createdAt: Date.now(),
    };
    dispatch({ type: 'ADD_TERMINAL', payload: { projectId, terminal } });
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId });
    dispatch({ type: 'SET_ACTIVE_TERMINAL', payload: terminal.id });
  }, []);

  const removeTerminal = useCallback(async (projectId: string, terminalId: string) => {
    // Close PTY before removing terminal
    const ptyId = ptyIdMapRef.current.get(terminalId);
    if (ptyId !== undefined) {
      try {
        await ptyClose(ptyId);
        console.log(`PTY ${ptyId} closed for terminal ${terminalId}`);
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

  // PTY registry functions
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

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Hook for accessing context
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

// Specialized hooks
export function useProjects() {
  const { state, addProject, removeProject } = useApp();
  return {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    addProject,
    removeProject,
  };
}

export function useTerminals() {
  const { state, activeProject, activeTerminal, addTerminal, removeTerminal, setActiveTerminal } = useApp();
  return {
    terminals: activeProject?.terminals || [],
    activeTerminal,
    addTerminal,
    removeTerminal,
    setActiveTerminal,
    ptyInstances: state.ptyInstances,
  };
}

export function useSettings() {
  const { state, dispatch, scheduleSave } = useApp();
  return {
    selectedModel: state.selectedModel,
    mcpDesktopEnabled: state.mcpDesktopEnabled,
    mcpDefaultEnabled: state.mcpDefaultEnabled,
    setModel: (model: 'haiku' | 'sonnet' | 'opus') => {
      dispatch({ type: 'SET_MODEL', payload: model });
      scheduleSave();
    },
    toggleMcpDesktop: () => {
      dispatch({ type: 'TOGGLE_MCP_DESKTOP' });
      scheduleSave();
    },
    toggleMcpDefault: () => {
      dispatch({ type: 'TOGGLE_MCP_DEFAULT' });
      scheduleSave();
    },
  };
}

// Hook for terminal actions
export function useTerminalActions() {
  const { writeToActiveTerminal, activeTerminal } = useApp();
  return {
    writeToActiveTerminal,
    hasActiveTerminal: !!activeTerminal,
  };
}

// Hook for global app settings (IDE, background, etc.)
export function useAppSettings() {
  const { state, dispatch, scheduleSave } = useApp();

  return {
    defaultIDE: state.defaultIDE,
    backgroundImage: state.backgroundImage,
    backgroundOpacity: state.backgroundOpacity ?? 30,
    terminalOpacity: state.terminalOpacity ?? 15,
    idleTimeout: state.idleTimeout ?? 5, // Default 5 seconds

    setDefaultIDE: (ide: 'cursor' | 'code' | 'antigravity' | undefined) => {
      dispatch({ type: 'SET_DEFAULT_IDE', payload: ide });
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
  };
}
