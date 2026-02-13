/**
 * Project Context
 *
 * Handles project and terminal CRUD operations, active state tracking,
 * and model/MCP flag management.
 */

import { useContext, createContext } from 'react';
import type { AppState, AppAction, AppContextType } from './types';

// Internal context reference - set by AppContext orchestrator
export const ProjectInternalContext = createContext<AppContextType | null>(null);

// ==================== Reducer ====================

export function projectReducer(state: AppState, action: AppAction): AppState {
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
      return {
        ...state,
        projects: state.projects.map(p =>
          p.id === projectId
            ? { ...p, terminals: p.terminals.filter(t => t.id !== terminalId) }
            : p
        ),
        activeTerminalId: state.activeTerminalId === terminalId ? null : state.activeTerminalId,
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

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    default:
      return state;
  }
}

// ==================== Hooks ====================

function useAppInternal() {
  const context = useContext(ProjectInternalContext);
  if (!context) {
    throw new Error('useProjects must be used within AppProvider');
  }
  return context;
}

export function useProjects() {
  const { state, addProject, removeProject } = useAppInternal();
  return {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    addProject,
    removeProject,
  };
}

export function useTerminals() {
  const { state, activeProject, activeTerminal, addTerminal, removeTerminal, setActiveTerminal } = useAppInternal();
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
  const { state, dispatch, scheduleSave } = useAppInternal();
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
