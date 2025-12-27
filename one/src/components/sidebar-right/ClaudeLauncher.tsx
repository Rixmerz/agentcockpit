import { useState, useCallback } from 'react';
import { buildClaudeCommand } from '../../services/mcpService';
import type { ProjectSession } from '../../services/projectSessionService';

interface ClaudeLauncherProps {
  projectPath: string | null;
  selectedSession: ProjectSession | null;
  selectedModel: string;
  hasActiveTerminal: boolean;
  onLaunch: (command: string) => void;
  onModelChange: (model: string) => void;
}

export function ClaudeLauncher({
  projectPath,
  selectedSession,
  selectedModel,
  hasActiveTerminal,
  onLaunch,
  onModelChange,
}: ClaudeLauncherProps) {
  const [resumeMode, setResumeMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customArgs, setCustomArgs] = useState('');

  const handleLaunch = useCallback(() => {
    const command = buildClaudeCommand({
      sessionId: selectedSession?.id,
      model: selectedModel,
      resume: resumeMode && !!selectedSession,
      additionalArgs: customArgs ? customArgs.split(' ').filter(Boolean) : undefined,
    });

    onLaunch(command);
  }, [selectedSession, selectedModel, resumeMode, customArgs, onLaunch]);

  const previewCommand = buildClaudeCommand({
    sessionId: selectedSession?.id,
    model: selectedModel,
    resume: resumeMode && !!selectedSession,
    additionalArgs: customArgs ? customArgs.split(' ').filter(Boolean) : undefined,
  });

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
