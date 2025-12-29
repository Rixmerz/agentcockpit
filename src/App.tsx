import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AppProvider, useApp, useTerminalActions, useAppSettings } from './contexts/AppContext';
import { PluginProvider } from './plugins/context/PluginContext';
import { claudePlugin } from './agents/claude';
import { TerminalView } from './components/terminal/TerminalView';
import { TerminalHeader } from './components/terminal/TerminalHeader';
import { ProjectOpener } from './components/sidebar-left/ProjectOpener';
import { GitHubLoginModal } from './components/sidebar-left/GitHubLoginModal';
import { ActionsPanel } from './components/sidebar-right/ActionsPanel';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  TerminalSquare,
  Folder,
  ExternalLink
} from 'lucide-react';
import './App.css';

// Loading screen component
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-spinner" />
        <span style={{ marginTop: '12px', fontSize: '13px' }}>Cargando...</span>
      </div>
    </div>
  );
}

function MainContent() {
  const { state, activeProject, activeTerminal, addProject, addTerminal, setActiveTerminal, removeTerminal, removeProject } = useApp();
  const { writeToActiveTerminal, hasActiveTerminal } = useTerminalActions();
  const { defaultIDE, backgroundImage, backgroundOpacity, terminalOpacity } = useAppSettings();

  // IDE Detection
  const [availableIDEs, setAvailableIDEs] = useState<string[]>([]);
  const [selectedIDE, setSelectedIDE] = useState<string | null>(null);

  // Detect installed IDEs on mount and respect defaultIDE setting
  useEffect(() => {
    const detectIDEs = async () => {
      const ides = ['cursor', 'code', 'antigravity'];
      const available: string[] = [];

      for (const ide of ides) {
        try {
          await invoke<string>('execute_command', {
            cmd: `which ${ide}`,
            cwd: '/',
          });
          available.push(ide);
        } catch {
          // IDE not installed
        }
      }

      setAvailableIDEs(available);

      // Prioritize defaultIDE if set and available
      if (defaultIDE && available.includes(defaultIDE)) {
        setSelectedIDE(defaultIDE);
      } else if (available.length > 0) {
        setSelectedIDE(available[0]);
      }
    };

    detectIDEs();
  }, [defaultIDE]);

  // Handler to open project in IDE
  const handleOpenInIDE = useCallback(async (projectPath: string) => {
    if (!selectedIDE) {
      console.error('No IDE available');
      return;
    }

    try {
      await invoke<string>('execute_command', {
        cmd: `${selectedIDE} "${projectPath}"`,
        cwd: '/',
      });
    } catch (error) {
      console.error(`Error opening ${selectedIDE}:`, error);
    }
  }, [selectedIDE]);

  const handleAddTerminal = useCallback((projectId: string) => {
    const project = state.projects.find(p => p.id === projectId);
    if (project) {
      const terminalName = `Terminal ${project.terminals.length + 1}`;
      addTerminal(projectId, terminalName);
    }
  }, [state.projects, addTerminal]);

  const handleCreateProject = useCallback((name: string, path: string) => {
    addProject(name, path);
  }, [addProject]);

  // GitHub login modal state
  const [showGitHubLogin, setShowGitHubLogin] = useState(false);

  const handleNeedLogin = useCallback(() => {
    setShowGitHubLogin(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N: New terminal in active project
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (activeProject) {
          handleAddTerminal(activeProject.id);
        }
      }
      // Cmd/Ctrl + W: Close active terminal
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeProject && activeTerminal) {
          removeTerminal(activeProject.id, activeTerminal.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProject, activeTerminal, handleAddTerminal, removeTerminal]);

  if (state.isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div
      className="app"
      style={{
        backgroundImage: backgroundImage ? `url("${backgroundImage}")` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Background opacity overlay */}
      {backgroundImage && (
        <div
          className="app-background-overlay"
          style={{ opacity: 1 - backgroundOpacity / 100 }}
        />
      )}

      {/* Sidebar Left - Projects Tree */}
      <aside className="sidebar-left">
        <div className="sidebar-header">
          <h2>EXPLORER</h2>
        </div>

        <div className="project-tree">
          {state.projects.length === 0 ? (
            <div className="p-4 text-center">
              <p className="placeholder">Sin proyectos</p>
            </div>
          ) : (
            state.projects.map(project => (
              <div key={project.id} className="project-item">
                <div
                  className={`project-header ${state.activeProjectId === project.id ? 'active' : ''}`}
                >
                  <span className="project-icon">
                    {state.activeProjectId === project.id ? 
                      <ChevronDown size={14} /> : 
                      <ChevronRight size={14} />
                    }
                  </span>
                  <div className="flex items-center gap-2 flex-1 overflow-hidden">
                    <Folder size={14} className="text-blue-500" style={{ color: 'var(--accent)' }} />
                    <span className="project-name" title={project.path}>{project.name}</span>
                  </div>
                  
                  <div className="project-actions">
                    <button
                      className="btn-icon"
                      onClick={() => handleAddTerminal(project.id)}
                      title="Nueva terminal (Cmd+N)"
                    >
                      <Plus size={14} />
                    </button>
                    {availableIDEs.length > 0 && (
                      <button
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenInIDE(project.path);
                        }}
                        title={`Abrir en ${selectedIDE}`}
                      >
                        <ExternalLink size={14} />
                      </button>
                    )}
                    <button
                      className="btn-icon danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProject(project.id);
                      }}
                      title="Eliminar proyecto"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                
                {/* Terminals list */}
                <div className="terminal-list">
                  {project.terminals.map(terminal => (
                    <div
                      key={terminal.id}
                      className={`terminal-item ${state.activeTerminalId === terminal.id ? 'active' : ''}`}
                      onClick={() => setActiveTerminal(project.id, terminal.id)}
                    >
                      <TerminalSquare size={13} className="terminal-icon" />
                      <span>{terminal.name}</span>
                      <button
                        className="btn-icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTerminal(project.id, terminal.id);
                        }}
                        title="Cerrar terminal (Cmd+W)"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="navigator-section">
          <div className="section-header" style={{ height: '32px', border: 'none', paddingLeft: '8px' }}>
            ABRIR PROYECTO
          </div>
          <ProjectOpener
            onCreateProject={handleCreateProject}
            onNeedLogin={handleNeedLogin}
          />
        </div>

        {/* GitHub Login Modal */}
        <GitHubLoginModal
          isOpen={showGitHubLogin}
          onClose={() => setShowGitHubLogin(false)}
          onLogin={() => setShowGitHubLogin(false)}
        />
      </aside>

      {/* Main Content - Terminal View */}
      <main className="main-content">
        <div
          className="terminal-container"
          style={{
            backgroundColor: `rgba(24, 24, 27, ${terminalOpacity / 100})`,
          }}
        >
          {activeTerminal && activeProject ? (
            <TerminalHeader
              name={activeTerminal.name}
              projectName={activeProject.name}
              projectPath={activeProject.path}
              onClose={() => removeTerminal(activeProject.id, activeTerminal.id)}
            />
          ) : (
            <div className="terminal-header justify-center">
              <span className="terminal-name text-muted">No Active Terminal</span>
            </div>
          )}

          <div className="terminal-view">
            {state.projects.flatMap(project =>
              project.terminals.map(terminal => (
                <div
                  key={terminal.id}
                  className={`terminal-wrapper ${state.activeTerminalId === terminal.id ? 'active' : ''}`}
                >
                  <TerminalView
                    terminalId={terminal.id}
                    workingDir={project.path}
                  />
                </div>
              ))
            )}
            {state.projects.every(p => p.terminals.length === 0) && (
              <div className="terminal-placeholder">
                <div className="flex flex-col items-center gap-4 opacity-50">
                  <TerminalSquare size={48} strokeWidth={1} />
                  <p>Selecciona o crea una terminal para comenzar</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Sidebar Right - Actions Panel */}
      <aside className="sidebar-right">
        <ActionsPanel
          projectPath={activeProject?.path || null}
          terminalId={activeTerminal?.id || null}
          hasActiveTerminal={hasActiveTerminal}
          onWriteToTerminal={writeToActiveTerminal}
          availableIDEs={availableIDEs}
        />
      </aside>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <PluginProvider initialPlugins={[claudePlugin]}>
        <MainContent />
      </PluginProvider>
    </AppProvider>
  );
}

export default App;
