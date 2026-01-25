import { useCallback, useEffect, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { AppProvider, useApp, useTerminalActions, useAppSettings, useTerminalActivityState } from './contexts/AppContext';
import { PluginProvider } from './plugins/context/PluginContext';
import { claudePlugin } from './agents/claude';
import { cursorAgentPlugin } from './agents/cursor-agent';
import { geminiPlugin } from './agents/gemini-cli';
import { useIdleMode } from './hooks/useIdleMode';
import { TerminalView } from './components/terminal/TerminalView';
import { TerminalHeader } from './components/terminal/TerminalHeader';
import { BrowserPanel } from './components/browser/BrowserPanel';
import { hideAllBrowserWebviews } from './services/browserService';
import { ProjectOpener } from './components/sidebar-left/ProjectOpener';
import { GitHubLoginModal } from './components/sidebar-left/GitHubLoginModal';
import { SnapshotPanel } from './components/sidebar-left/SnapshotPanel';
import { ActionsPanel } from './components/sidebar-right/ActionsPanel';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  TerminalSquare,
  Folder,
  CheckCircle2
} from 'lucide-react';
import './App.css';

// Loading screen component
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-content">
        <div className="loading-spinner" />
        <span style={{ marginTop: '12px', fontSize: '13px' }}>Loading...</span>
      </div>
    </div>
  );
}

function MainContent() {
  const { state, activeProject, activeTerminal, addProject, addTerminal, setActiveTerminal, removeTerminal, renameTerminal, removeProject } = useApp();
  const { writeToActiveTerminal, hasActiveTerminal } = useTerminalActions();
  const { defaultIDE, backgroundImage, backgroundOpacity, terminalOpacity, idleTimeout } = useAppSettings();
  const { isTerminalFinished, clearTerminalActivity } = useTerminalActivityState();

  // Idle mode - fade UI after configured inactivity (0 = disabled)
  const { isIdle, signalActivity } = useIdleMode({
    idleTimeout: idleTimeout > 0 ? idleTimeout * 1000 : 0 // Convert to ms, 0 = disabled
  });

  // Convert local file paths to asset:// protocol for Tauri
  const getBackgroundUrl = useCallback((path: string | undefined): string => {
    if (!path) return 'none';
    // URLs (http/https) use directly
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return `url("${path}")`;
    }
    // Local paths need conversion to asset:// protocol
    if (path.startsWith('/')) {
      return `url("${convertFileSrc(path)}")`;
    }
    return `url("${path}")`;
  }, []);

  // Terminal name editing
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // IDE Detection
  const [availableIDEs, setAvailableIDEs] = useState<string[]>([]);
  const [selectedIDE, setSelectedIDE] = useState<string | null>(null);

  // Set IDE based on defaultIDE setting or fallback to 'cursor'
  // No detection needed - we just try to open and let it fail gracefully
  useEffect(() => {
    const supportedIDEs = ['cursor', 'code', 'antigravity'];
    setAvailableIDEs(supportedIDEs);

    if (defaultIDE && supportedIDEs.includes(defaultIDE)) {
      setSelectedIDE(defaultIDE);
    } else {
      // Default to cursor if no preference set
      setSelectedIDE('cursor');
    }
  }, [defaultIDE]);

  // Handler to open project in IDE
  // Uses macOS `open -a` for reliability, with CLI fallback
  const handleOpenInIDE = useCallback(async (projectPath: string) => {
    if (!selectedIDE) {
      console.error('[App] No IDE selected');
      return;
    }

    // Map CLI names to macOS app names
    const appNames: Record<string, string> = {
      cursor: 'Cursor',
      code: 'Visual Studio Code',
      antigravity: 'Antigravity',
    };

    const appName = appNames[selectedIDE] || selectedIDE;

    try {
      // Try opening with macOS open command first (most reliable)
      await invoke<string>('execute_command', {
        cmd: `open -a "${appName}" "${projectPath}"`,
        cwd: '/',
      });
      console.log(`[App] Opened ${projectPath} in ${appName}`);
    } catch {
      // Fallback to CLI command
      try {
        await invoke<string>('execute_command', {
          cmd: `${selectedIDE} "${projectPath}" &`,
          cwd: '/',
        });
        console.log(`[App] Opened ${projectPath} with ${selectedIDE} CLI`);
      } catch (error) {
        console.error(`[App] Failed to open in IDE:`, error);
      }
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

  // Track when any modal is open (for browser webview z-index)
  const [actionsPanelModalOpen, setActionsPanelModalOpen] = useState(false);
  const anyModalOpen = showGitHubLogin || actionsPanelModalOpen;

  // Browser panel state
  const [browserOpen, setBrowserOpen] = useState(false);

  const handleBrowserToggle = useCallback(async () => {
    if (browserOpen) {
      // Closing: hide webview FIRST, then update state
      await hideAllBrowserWebviews();
      setBrowserOpen(false);
    } else {
      // Opening: just update state, webview will be created by BrowserPanel
      setBrowserOpen(true);
    }
  }, [browserOpen]);

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
      // Cmd/Ctrl + O: Open in IDE
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        if (activeProject && selectedIDE) {
          handleOpenInIDE(activeProject.path);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProject, activeTerminal, handleAddTerminal, removeTerminal, selectedIDE, handleOpenInIDE]);

  if (state.isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div
      className={`app ${isIdle ? 'app--idle' : ''}`}
      style={{
        backgroundImage: getBackgroundUrl(backgroundImage),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Background opacity overlay - fades when idle */}
      {backgroundImage && (
        <div
          className="app-background-overlay"
          style={{ opacity: isIdle ? 0 : 1 - backgroundOpacity / 100 }}
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
              <p className="placeholder">No projects</p>
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
                      title="New terminal (Cmd+N)"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      className="btn-icon danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProject(project.id);
                      }}
                      title="Delete project"
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
                      onClick={() => {
                        setActiveTerminal(project.id, terminal.id);
                        clearTerminalActivity(terminal.id);
                      }}
                    >
                      <TerminalSquare size={13} className="terminal-icon" />
                      {editingTerminalId === terminal.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => {
                            if (editingName.trim()) {
                              renameTerminal(project.id, terminal.id, editingName.trim());
                            }
                            setEditingTerminalId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (editingName.trim()) {
                                renameTerminal(project.id, terminal.id, editingName.trim());
                              }
                              setEditingTerminalId(null);
                            } else if (e.key === 'Escape') {
                              setEditingTerminalId(null);
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                          className="terminal-name-input"
                        />
                      ) : (
                        <span
                          onDoubleClick={(e) => {
                            if (state.activeTerminalId === terminal.id) {
                              e.stopPropagation();
                              setEditingName(terminal.name);
                              setEditingTerminalId(terminal.id);
                            }
                          }}
                        >
                          {terminal.name}
                        </span>
                      )}
                      {/* Terminal finished indicator */}
                      {isTerminalFinished(terminal.id) && (
                        <span className="terminal-finished-indicator" title="Terminal finished">
                          <CheckCircle2 size={12} />
                        </span>
                      )}
                      <button
                        className="btn-icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTerminal(project.id, terminal.id);
                        }}
                        title="Close terminal (Cmd+W)"
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

        {/* Snapshots Section - Fixed position for active project */}
        {activeProject && (
          <div className="navigator-section">
            <div className="section-header" style={{ height: '32px', border: 'none', paddingLeft: '8px' }}>
              VERSIONS
            </div>
            <SnapshotPanel projectPath={activeProject.path} />
          </div>
        )}

        <div className="navigator-section">
          <div className="section-header" style={{ height: '32px', border: 'none', paddingLeft: '8px' }}>
            OPEN PROJECT
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
              onClose={() => removeTerminal(activeProject.id, activeTerminal.id)}
              onOpenInIDE={() => handleOpenInIDE(activeProject.path)}
              selectedIDE={selectedIDE}
              onBrowserToggle={handleBrowserToggle}
              isBrowserOpen={browserOpen}
            />
          ) : (
            <div className="terminal-header justify-center">
              <span className="terminal-name text-muted">No Active Terminal</span>
            </div>
          )}

          {/* Browser Panel - appears below header when open */}
          <BrowserPanel
            isOpen={browserOpen}
            onClose={() => setBrowserOpen(false)}
            isIdle={isIdle}
            hideForModal={anyModalOpen}
          />

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
                    onActivity={signalActivity}
                  />
                </div>
              ))
            )}
            {state.projects.every(p => p.terminals.length === 0) && (
              <div className="terminal-placeholder">
                <div className="flex flex-col items-center gap-4">
                  <TerminalSquare size={48} strokeWidth={1} />
                  <p>Select or create a terminal to begin</p>
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
          onModalStateChange={setActionsPanelModalOpen}
        />
      </aside>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <PluginProvider initialPlugins={[claudePlugin, cursorAgentPlugin, geminiPlugin]}>
        <MainContent />
      </PluginProvider>
    </AppProvider>
  );
}

export default App;
