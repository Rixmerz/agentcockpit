import { useCallback, useEffect } from 'react';
import { AppProvider, useApp, useSettings, useTerminalActions } from './contexts/AppContext';
import { TerminalView } from './components/terminal/TerminalView';
import { TerminalHeader } from './components/terminal/TerminalHeader';
import { PathNavigator } from './components/sidebar-left/PathNavigator';
import { ActionsPanel } from './components/sidebar-right/ActionsPanel';
import './App.css';

// Loading screen component
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-spinner" />
        <span>Cargando...</span>
      </div>
    </div>
  );
}

function MainContent() {
  const { state, activeProject, activeTerminal, addProject, addTerminal, setActiveTerminal, removeTerminal, removeProject } = useApp();
  const { selectedModel, setModel } = useSettings();
  const { writeToActiveTerminal, hasActiveTerminal } = useTerminalActions();

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

  // Show loading screen
  if (state.isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="app">
      {/* Sidebar Left - Projects Tree */}
      <aside className="sidebar-left">
        <div className="sidebar-header">
          <h2>Proyectos</h2>
        </div>

        <div className="project-tree">
          {state.projects.length === 0 ? (
            <p className="placeholder">Sin proyectos</p>
          ) : (
            state.projects.map(project => (
              <div key={project.id} className="project-item">
                <div
                  className={`project-header ${state.activeProjectId === project.id ? 'active' : ''}`}
                >
                  <span className="project-icon">▼</span>
                  <span className="project-name" title={project.path}>{project.name}</span>
                  <button
                    className="btn-add-terminal"
                    onClick={() => handleAddTerminal(project.id)}
                    title="Nueva terminal (Cmd+N)"
                  >
                    +
                  </button>
                  <button
                    className="btn-remove-project"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProject(project.id);
                    }}
                    title="Eliminar proyecto"
                  >
                    ×
                  </button>
                </div>
                <div className="terminal-list">
                  {project.terminals.map(terminal => (
                    <div
                      key={terminal.id}
                      className={`terminal-item ${state.activeTerminalId === terminal.id ? 'active' : ''}`}
                      onClick={() => setActiveTerminal(project.id, terminal.id)}
                    >
                      <span className="terminal-icon">▸</span>
                      <span>{terminal.name}</span>
                      <button
                        className="btn-remove-terminal"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTerminal(project.id, terminal.id);
                        }}
                        title="Cerrar terminal (Cmd+W)"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="navigator-section">
          <div className="section-header">Nuevo Proyecto</div>
          <PathNavigator onCreateProject={handleCreateProject} />
        </div>
      </aside>

      {/* Main Content - Terminal View */}
      <main className="main-content">
        {/* Header for active terminal */}
        {activeTerminal && activeProject ? (
          <TerminalHeader
            name={activeTerminal.name}
            projectName={activeProject.name}
            onClose={() => removeTerminal(activeProject.id, activeTerminal.id)}
          />
        ) : (
          <div className="terminal-header">
            <span className="terminal-name">Sin terminal activa</span>
          </div>
        )}

        {/* Render ALL terminals, hide inactive ones with CSS */}
        <div className="terminal-view">
          {state.projects.flatMap(project =>
            project.terminals.map(terminal => (
              <div
                key={terminal.id}
                className={`terminal-wrapper ${state.activeTerminalId === terminal.id ? 'active' : 'hidden'}`}
              >
                <TerminalView
                  terminalId={terminal.id}
                  workingDir={project.path}
                />
              </div>
            ))
          )}
          {/* Show placeholder when no terminals exist */}
          {state.projects.every(p => p.terminals.length === 0) && (
            <div className="terminal-placeholder">
              <p className="placeholder">Selecciona o crea una terminal</p>
            </div>
          )}
        </div>
      </main>

      {/* Sidebar Right - Actions Panel */}
      <aside className="sidebar-right">
        <ActionsPanel
          projectPath={activeProject?.path || null}
          terminalId={activeTerminal?.id || null}
          hasActiveTerminal={hasActiveTerminal}
          selectedModel={selectedModel}
          onModelChange={(model) => setModel(model as 'haiku' | 'sonnet' | 'opus')}
          onWriteToTerminal={writeToActiveTerminal}
        />
      </aside>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <MainContent />
    </AppProvider>
  );
}

export default App;
