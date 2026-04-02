/**
 * Main Content - Terminal Area
 *
 * Contains the control bars, terminal header,
 * and terminal views.
 */

import { useState, useCallback, memo } from 'react';

import { useApp, useAppSettings } from '../contexts/AppContext';
import { TerminalView } from '../components/terminal/TerminalView';
import { TerminalHeader } from '../components/terminal/TerminalHeader';
import { ControlBar, WorkflowStepsBar } from '../components/control-bar';
import { TerminalSquare } from 'lucide-react';
import type { WorkflowStatus } from '../services/workflow/index';

interface MainContentAreaProps {
  selectedIDE: string | null;
  handleOpenInIDE: (path: string) => void;
  signalActivity: () => void;
}

export const MainContentArea = memo(function MainContentArea({
  selectedIDE,
  handleOpenInIDE,
  signalActivity,
}: MainContentAreaProps) {
  const { state, activeProject, activeTerminal, removeTerminal } = useApp();
  const { terminalOpacity } = useAppSettings();

  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);

  const handleStatusChange = useCallback((status: WorkflowStatus | null) => {
    setWorkflowStatus(status);
  }, []);

  return (
    <main className="main-content">
      {/* Control Bars - Above Terminal */}
      <div className="app-top-bars">
        <ControlBar
          projectPath={activeProject?.path || null}
          onWorkflowChange={(name) => {
            console.log('[App] Workflow changed:', name);
          }}
          onStatusChange={handleStatusChange}
        />
        <WorkflowStepsBar
          status={workflowStatus}
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
          />
        ) : (
          <div className="terminal-header justify-center">
            <span className="terminal-name text-muted">No Active Terminal</span>
          </div>
        )}

        <div className="terminal-view">
          {activeProject?.terminals.map(terminal => (
            <div
              key={terminal.id}
              className={`terminal-wrapper ${state.activeTerminalId === terminal.id ? 'active' : ''}`}
            >
              <TerminalView
                terminalId={terminal.id}
                workingDir={activeProject.path}
                onActivity={signalActivity}
              />
            </div>
          ))}
          {(!activeProject || activeProject.terminals.length === 0) && (
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
});
