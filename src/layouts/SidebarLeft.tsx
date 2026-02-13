/**
 * Sidebar Left - Project Explorer
 *
 * Displays project tree with terminals, project opener,
 * and GitHub login modal.
 */

import { useState, useCallback } from 'react';
import { useApp, useTerminalActivityState } from '../contexts/AppContext';
import { ProjectOpener } from '../components/sidebar-left/ProjectOpener';
import { GitHubLoginModal } from '../components/sidebar-left/GitHubLoginModal';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  TerminalSquare,
  Folder,
  CheckCircle2
} from 'lucide-react';

interface SidebarLeftProps {
  onAddTerminal: (projectId: string) => void;
}

export function SidebarLeft({ onAddTerminal }: SidebarLeftProps) {
  const { state, addProject, removeProject, setActiveTerminal, removeTerminal, renameTerminal } = useApp();
  const { isTerminalFinished, clearTerminalActivity } = useTerminalActivityState();

  // Terminal name editing
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // GitHub login modal state
  const [showGitHubLogin, setShowGitHubLogin] = useState(false);

  const handleCreateProject = useCallback((name: string, path: string) => {
    addProject(name, path);
  }, [addProject]);

  const handleNeedLogin = useCallback(() => {
    setShowGitHubLogin(true);
  }, []);

  return (
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
                    onClick={() => onAddTerminal(project.id)}
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

      <div className="navigator-section">
        <div className="section-header" style={{ height: '32px', border: 'none', paddingLeft: '8px' }}>
          OPEN PROJECT
        </div>
        <ProjectOpener
          onCreateProject={handleCreateProject}
          onNeedLogin={handleNeedLogin}
        />
      </div>

      <GitHubLoginModal
        isOpen={showGitHubLogin}
        onClose={() => setShowGitHubLogin(false)}
        onLogin={() => setShowGitHubLogin(false)}
      />
    </aside>
  );
}
