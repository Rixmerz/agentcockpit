import { useState, useCallback } from 'react';
import { McpPanel, type McpServer } from './McpPanel';
import { SessionManager } from './SessionManager';
import { ClaudeLauncher } from './ClaudeLauncher';
import { createSession, updateSessionLastUsed, type ProjectSession } from '../../services/projectSessionService';
import { Zap, Archive, Eraser, Ban } from 'lucide-react';

interface ActionsPanelProps {
  projectPath: string | null;
  terminalId: string | null;
  hasActiveTerminal: boolean;
  onWriteToTerminal: (data: string) => Promise<void>;
}

export function ActionsPanel({
  projectPath,
  terminalId,
  hasActiveTerminal,
  onWriteToTerminal,
}: ActionsPanelProps) {
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [mcpsToInject, setMcpsToInject] = useState<McpServer[]>([]);
  const [mcpsToRemove, setMcpsToRemove] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);

  const handleLaunch = useCallback(async (command: string) => {
    // If no session selected, create one automatically
    let session = selectedSession;
    if (!session && projectPath) {
      session = await createSession(projectPath);
      setSelectedSession(session);
    }

    // Update session last used
    if (session && projectPath) {
      await updateSessionLastUsed(projectPath, session.id, terminalId || undefined);
    }

    // Write command to terminal
    await onWriteToTerminal(command + '\n');
  }, [selectedSession, projectPath, terminalId, onWriteToTerminal]);

  const handleSessionCreated = useCallback((session: ProjectSession) => {
    setSelectedSession(session);
  }, []);

  // Send command to terminal with proper PTY execution pattern
  // Must send text and carriage return separately with delay
  const handleQuickAction = useCallback(async (action: string) => {
    await onWriteToTerminal(action);
    await new Promise(resolve => setTimeout(resolve, 50));
    await onWriteToTerminal('\r');
  }, [onWriteToTerminal]);

  // Special handler for ultrathink: adds newline to pending input, then ultrathink, then sends all
  const handleUltrathink = useCallback(async () => {
    // Add newline to pending message (not execute, just new line in input)
    await onWriteToTerminal('\n');
    await new Promise(resolve => setTimeout(resolve, 50));
    // Write ultrathink
    await onWriteToTerminal('ultrathink');
    await new Promise(resolve => setTimeout(resolve, 50));
    // Send everything
    await onWriteToTerminal('\r');
  }, [onWriteToTerminal]);

  return (
    <div className="actions-panel sidebar-right">
      {/* Claude Launcher */}
      <ClaudeLauncher
        projectPath={projectPath}
        selectedSession={selectedSession}
        hasActiveTerminal={hasActiveTerminal}
        mcpsToInject={mcpsToInject}
        mcpsToRemove={mcpsToRemove}
        onLaunch={handleLaunch}
        onWriteToTerminal={onWriteToTerminal}
      />

      {/* Session Manager */}
      <SessionManager
        projectPath={projectPath}
        selectedSession={selectedSession}
        onSessionSelect={setSelectedSession}
        onSessionCreated={handleSessionCreated}
      />

      {/* MCP Panel */}
      <McpPanel
        projectPath={projectPath}
        selectedServers={selectedMcpServers}
        onSelectionChange={setSelectedMcpServers}
        onMcpsForInjection={setMcpsToInject}
        onMcpsForRemoval={setMcpsToRemove}
      />

      {/* Quick Actions */}
      <div className="panel-section">
        <div className="box-title">Acciones Rápidas</div>
        <div className="quick-actions-grid">
          <button
            className="action-card"
            onClick={handleUltrathink}
            disabled={!hasActiveTerminal}
            title="Enviar 'ultrathink'"
          >
            <Zap size={18} className="text-yellow-500" style={{ color: 'var(--warning)' }} />
            <span>Ultrathink</span>
          </button>
          <button
            className="action-card"
            onClick={() => handleQuickAction('/compact')}
            disabled={!hasActiveTerminal}
            title="Compactar contexto"
          >
            <Archive size={18} className="text-blue-500" style={{ color: 'var(--accent)' }} />
            <span>Compact</span>
          </button>
          <button
            className="action-card"
            onClick={() => handleQuickAction('/clear')}
            disabled={!hasActiveTerminal}
            title="Limpiar conversación"
          >
            <Eraser size={18} />
            <span>Clear</span>
          </button>
          <button
            className="action-card"
            onClick={() => handleQuickAction('\x03')}
            disabled={!hasActiveTerminal}
            title="Cancelar (Ctrl+C)"
          >
            <Ban size={18} className="text-red-500" style={{ color: 'var(--error)' }} />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </div>
  );
}
