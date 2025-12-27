import { useState, useCallback, useEffect } from 'react';
import { AppProvider, useApp, useSettings, useTerminalActions } from './contexts/AppContext';
import { TerminalView } from './components/terminal/TerminalView';
import { TerminalHeader } from './components/terminal/TerminalHeader';
import { MiniTerminal } from './components/sidebar-left/MiniTerminal';
import { openFolderDialog } from './services/fileSystemService';
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
  const { selectedModel, setModel, mcpDesktopEnabled, mcpDefaultEnabled, toggleMcpDesktop, toggleMcpDefault } = useSettings();
  const { writeToActiveTerminal, hasActiveTerminal } = useTerminalActions();

  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [selectedPath, setSelectedPath] = useState('/Users/juanpablodiaz');

  const handleAddProject = useCallback(() => {
    if (newProjectName.trim() && selectedPath) {
      addProject(newProjectName.trim(), selectedPath);
      setNewProjectName('');
      setShowNewProject(false);
    }
  }, [newProjectName, selectedPath, addProject]);

  const handleAddTerminal = useCallback((projectId: string) => {
    const project = state.projects.find(p => p.id === projectId);
    if (project) {
      const terminalName = `Terminal ${project.terminals.length + 1}`;
      addTerminal(projectId, terminalName);
    }
  }, [state.projects, addTerminal]);

  const handleOpenFolder = useCallback(async () => {
    const path = await openFolderDialog();
    if (path) {
      setSelectedPath(path);
      // Extract folder name from path
      const folderName = path.split('/').pop() || 'proyecto';
      setNewProjectName(folderName);
      setShowNewProject(true);
    }
  }, []);

  const handleDirectorySelect = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const handleUltrathink = useCallback(async () => {
    if (hasActiveTerminal) {
      await writeToActiveTerminal('ultrathink\n');
    }
  }, [hasActiveTerminal, writeToActiveTerminal]);

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
      // Cmd/Ctrl + O: Open folder
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        handleOpenFolder();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProject, activeTerminal, handleAddTerminal, removeTerminal, handleOpenFolder]);

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
          <button
            className="btn-add"
            title="Agregar Proyecto"
            onClick={() => setShowNewProject(!showNewProject)}
          >
            +
          </button>
        </div>

        {showNewProject && (
          <div className="new-project-form">
            <input
              type="text"
              placeholder="Nombre del proyecto"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddProject()}
              autoFocus
            />
            <div className="path-display" title={selectedPath}>
              {selectedPath.replace('/Users/juanpablodiaz', '~')}
            </div>
            <button onClick={handleAddProject}>Crear</button>
          </div>
        )}

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

        <div className="mini-terminal-section">
          <div className="section-header">Navegador</div>
          <MiniTerminal
            initialPath="~"
            onDirectorySelect={handleDirectorySelect}
          />
          <button className="btn-open-folder" onClick={handleOpenFolder}>
            Abrir Carpeta
          </button>
        </div>
      </aside>

      {/* Main Content - Terminal View */}
      <main className="main-content">
        {activeTerminal && activeProject ? (
          <>
            <TerminalHeader
              name={activeTerminal.name}
              projectName={activeProject.name}
              onClose={() => removeTerminal(activeProject.id, activeTerminal.id)}
            />
            <div className="terminal-view">
              <TerminalView
                key={activeTerminal.id}
                terminalId={activeTerminal.id}
                workingDir={activeProject.path}
              />
            </div>
          </>
        ) : (
          <>
            <div className="terminal-header">
              <span className="terminal-name">Sin terminal activa</span>
            </div>
            <div className="terminal-view empty">
              <p className="placeholder">Selecciona o crea una terminal</p>
            </div>
          </>
        )}
      </main>

      {/* Sidebar Right - Actions Panel */}
      <aside className="sidebar-right">
        <div className="section">
          <div className="section-header">Modelo</div>
          <select
            className="model-selector"
            value={selectedModel}
            onChange={(e) => setModel(e.target.value as 'haiku' | 'sonnet' | 'opus')}
          >
            <option value="haiku">Haiku</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
        </div>

        <div className="section">
          <div className="section-header">Acciones</div>
          <button
            className="btn-action"
            onClick={handleUltrathink}
            disabled={!hasActiveTerminal}
            title={hasActiveTerminal ? 'Escribir ultrathink al terminal' : 'Selecciona un terminal primero'}
          >
            Ultrathink
          </button>
        </div>

        <div className="section">
          <div className="section-header">MCP Config</div>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={mcpDesktopEnabled}
              onChange={toggleMcpDesktop}
            />
            <span>Desktop MCP</span>
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={mcpDefaultEnabled}
              onChange={toggleMcpDefault}
            />
            <span>Default CLI</span>
          </label>
        </div>
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
