/**
 * Main Content - Terminal Area
 *
 * Contains the control bars, terminal header, browser panel,
 * and terminal views.
 */

import { useState, useCallback } from 'react';
import { useApp, useAppSettings } from '../contexts/AppContext';
import { TerminalView } from '../components/terminal/TerminalView';
import { TerminalHeader } from '../components/terminal/TerminalHeader';
import { BrowserPanel } from '../components/browser/BrowserPanel';
import { hideAllBrowserWebviews } from '../services/browserService';
import { ControlBar, PipelineStepsBar } from '../components/control-bar';
import { TerminalSquare } from 'lucide-react';

interface MainContentAreaProps {
  selectedIDE: string | null;
  handleOpenInIDE: (path: string) => void;
  isIdle: boolean;
  signalActivity: () => void;
  anyModalOpen: boolean;
}

export function MainContentArea({
  selectedIDE,
  handleOpenInIDE,
  isIdle,
  signalActivity,
  anyModalOpen,
}: MainContentAreaProps) {
  const { state, activeProject, activeTerminal, removeTerminal } = useApp();
  const { terminalOpacity } = useAppSettings();

  // Browser panel state
  const [browserOpen, setBrowserOpen] = useState(false);

  const handleBrowserToggle = useCallback(async () => {
    if (browserOpen) {
      await hideAllBrowserWebviews();
      setBrowserOpen(false);
    } else {
      setBrowserOpen(true);
    }
  }, [browserOpen]);

  return (
    <main className="main-content">
      {/* Control Bars - Above Terminal */}
      <div className="app-top-bars">
        <ControlBar
          projectPath={activeProject?.path || null}
          onPipelineChange={(name) => console.log('[App] Pipeline changed:', name)}
        />
        <PipelineStepsBar
          projectPath={activeProject?.path || null}
          onNodeClick={(nodeId) => console.log('[App] Node clicked:', nodeId)}
        />
      </div>

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

        {/* Browser Panel */}
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
  );
}
