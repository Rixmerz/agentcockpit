import { useState, useCallback } from 'react';
import { buildClaudeCommand } from '../../services/mcpService';
import type { ProjectSession } from '../../services/projectSessionService';
import type { McpServer } from './McpPanel';

interface ClaudeLauncherProps {
  projectPath: string | null;
  selectedSession: ProjectSession | null;
  selectedModel: string;
  hasActiveTerminal: boolean;
  mcpsToInject: McpServer[];
  mcpsToRemove: string[];
  onLaunch: (command: string) => void;
  onModelChange: (model: string) => void;
}

export function ClaudeLauncher({
  projectPath,
  selectedSession,
  selectedModel,
  hasActiveTerminal,
  mcpsToInject,
  mcpsToRemove,
  onLaunch,
  onModelChange,
}: ClaudeLauncherProps) {
  const [resumeMode, setResumeMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customArgs, setCustomArgs] = useState('');

  const handleLaunch = useCallback(async () => {
    // Build Claude command
    const claudeCommand = buildClaudeCommand({
      sessionId: selectedSession?.id,
      model: selectedModel,
      resume: resumeMode && !!selectedSession,
      additionalArgs: customArgs ? customArgs.split(' ').filter(Boolean) : undefined,
    });

    const allCommands: string[] = [];

    // First: remove MCPs marked for removal (from project scope, no -s flag)
    if (mcpsToRemove.length > 0) {
      const removeCommands = mcpsToRemove.map(name =>
        `claude mcp remove "${name}" 2>/dev/null || true`
      );
      allCommands.push(...removeCommands);
    }

    // Second: inject MCPs
    if (mcpsToInject.length > 0) {
      const injectCommands = mcpsToInject.map(mcp => {
        const jsonConfig = JSON.stringify(mcp.config);
        // Escape single quotes for shell
        const escapedJson = jsonConfig.replace(/'/g, "'\"'\"'");
        // Use 2>/dev/null || true to ignore "already exists" errors
        return `claude mcp add-json "${mcp.name}" '${escapedJson}' -s user 2>/dev/null || true`;
      });
      allCommands.push(...injectCommands);
    }

    // Finally: launch Claude
    allCommands.push(claudeCommand);

    // Chain all commands with ;
    const fullCommand = allCommands.join(' ; ');
    console.log('[Launcher] Full command:', fullCommand);
    onLaunch(fullCommand);
  }, [mcpsToInject, mcpsToRemove, selectedSession, selectedModel, resumeMode, customArgs, onLaunch]);

  // Build preview command (including MCP injections)
  const claudeCmd = buildClaudeCommand({
    sessionId: selectedSession?.id,
    model: selectedModel,
    resume: resumeMode && !!selectedSession,
    additionalArgs: customArgs ? customArgs.split(' ').filter(Boolean) : undefined,
  });

  // Build preview string
  const previewParts: string[] = [];
  if (mcpsToRemove.length > 0) {
    previewParts.push(`[-${mcpsToRemove.length}]`);
  }
  if (mcpsToInject.length > 0) {
    previewParts.push(`[+${mcpsToInject.length}]`);
  }
  const previewCommand = previewParts.length > 0
    ? `${previewParts.join(' ')} ; ${claudeCmd}`
    : claudeCmd;

  const canLaunch = hasActiveTerminal && projectPath;

  return (
    <div className="claude-launcher">
      <div className="launcher-section">
        <div className="section-header">Modelo</div>
        <select
          className="model-selector"
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
        >
          <option value="haiku">Haiku (rápido)</option>
          <option value="sonnet">Sonnet (balanceado)</option>
          <option value="opus">Opus (potente)</option>
        </select>
      </div>

      {selectedSession && (
        <div className="launcher-section">
          <div className="session-info">
            <span className="session-label">Sesión:</span>
            <span className="session-value" title={selectedSession.id}>
              {selectedSession.name}
            </span>
          </div>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={resumeMode}
              onChange={(e) => setResumeMode(e.target.checked)}
            />
            <span>Resumir sesión (--resume)</span>
          </label>
        </div>
      )}

      {/* Show MCPs to remove */}
      {mcpsToRemove.length > 0 && (
        <div className="launcher-section">
          <div className="mcp-inject-info">
            <span className="mcp-inject-label mcp-remove-label">MCPs a remover:</span>
            <span className="mcp-inject-count mcp-remove-count">{mcpsToRemove.length}</span>
          </div>
          <div className="mcp-inject-list">
            {mcpsToRemove.map(name => (
              <span key={name} className="mcp-inject-item mcp-remove-item">{name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Show MCPs to inject */}
      {mcpsToInject.length > 0 && (
        <div className="launcher-section">
          <div className="mcp-inject-info">
            <span className="mcp-inject-label">MCPs a inyectar:</span>
            <span className="mcp-inject-count">{mcpsToInject.length}</span>
          </div>
          <div className="mcp-inject-list">
            {mcpsToInject.map(mcp => (
              <span key={mcp.name} className="mcp-inject-item">{mcp.name}</span>
            ))}
          </div>
        </div>
      )}

      <div className="launcher-section">
        <button
          className="btn-toggle-advanced"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? '▼' : '▶'} Opciones avanzadas
        </button>

        {showAdvanced && (
          <div className="advanced-options">
            <input
              type="text"
              className="custom-args-input"
              value={customArgs}
              onChange={(e) => setCustomArgs(e.target.value)}
              placeholder="Args adicionales..."
            />
            <div className="command-preview">
              <span className="preview-label">Comando:</span>
              <code className="preview-command">{previewCommand}</code>
            </div>
          </div>
        )}
      </div>

      <button
        className="btn-launch-claude"
        onClick={handleLaunch}
        disabled={!canLaunch}
        title={!canLaunch ? 'Necesitas un proyecto con terminal activa' : 'Iniciar Claude'}
      >
        🚀 Iniciar Claude
      </button>

      {!hasActiveTerminal && (
        <div className="launcher-hint">
          Crea una terminal primero
        </div>
      )}
    </div>
  );
}
