import { useState, useCallback } from 'react';
import { McpPanel } from './McpPanel';
import { SessionManager } from './SessionManager';
import { ClaudeLauncher } from './ClaudeLauncher';
import { createSession, updateSessionLastUsed, type ProjectSession } from '../../services/projectSessionService';

interface ActionsPanelProps {
  projectPath: string | null;
  terminalId: string | null;
  hasActiveTerminal: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onWriteToTerminal: (data: string) => Promise<void>;
}

export function ActionsPanel({
  projectPath,
  terminalId,
  hasActiveTerminal,
  selectedModel,
  onModelChange,
  onWriteToTerminal,
}: ActionsPanelProps) {
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);

  const handleLaunch = useCallback(async (command: string) => {
    // If no session selected, create one automatically
    let session = selectedSession;
    if (!session && projectPath) {
      session = await createSession(projectPath, undefined, selectedModel);
      setSelectedSession(session);
    }

    // Update session last used
    if (session && projectPath) {
      await updateSessionLastUsed(projectPath, session.id, terminalId || undefined);
    }

    // Write command to terminal
    await onWriteToTerminal(command + '\n');
  }, [selectedSession, projectPath, selectedModel, terminalId, onWriteToTerminal]);

  const handleSessionCreated = useCallback((session: ProjectSession) => {
    setSelectedSession(session);
  }, []);

  const handleQuickAction = useCallback(async (action: string) => {
    await onWriteToTerminal(action + '\n');
  }, [onWriteToTerminal]);

  return (
    <div className="actions-panel">
      {/* Claude Launcher */}
      <ClaudeLauncher
        projectPath={projectPath}
        selectedSession={selectedSession}
        selectedModel={selectedModel}
        hasActiveTerminal={hasActiveTerminal}
        onLaunch={handleLaunch}
        onModelChange={onModelChange}
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
        selectedServers={selectedMcpServers}
        onSelectionChange={setSelectedMcpServers}
      />

      {/* Quick Actions */}
      <div className="quick-actions">
        <div className="section-header">Acciones Rápidas</div>
        <div className="quick-actions-grid">
          <button
            className="quick-action-btn"
            onClick={() => handleQuickAction('ultrathink')}
            disabled={!hasActiveTerminal}
            title="Enviar 'ultrathink'"
          >
            🧠 Ultrathink
          </button>
          <button
            className="quick-action-btn"
            onClick={() => handleQuickAction('/compact')}
            disabled={!hasActiveTerminal}
            title="Compactar contexto"
          >
            📦 Compact
          </button>
          <button
            className="quick-action-btn"
            onClick={() => handleQuickAction('/clear')}
            disabled={!hasActiveTerminal}
            title="Limpiar conversación"
          >
            🧹 Clear
          </button>
          <button
            className="quick-action-btn"
            onClick={() => handleQuickAction('\x03')}
            disabled={!hasActiveTerminal}
            title="Cancelar (Ctrl+C)"
          >
            ⛔ Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
