import { useState, useCallback } from 'react';
import { buildClaudeCommand } from '../../services/claudeService';
import type { ProjectSession } from '../../services/projectSessionService';
import type { McpServer } from './McpPanel';
import { Rocket, ChevronRight, ChevronDown } from 'lucide-react';

interface ClaudeLauncherProps {
  projectPath: string | null;
  selectedSession: ProjectSession | null;
  hasActiveTerminal: boolean;
  mcpsToInject: McpServer[];
  mcpsToRemove: string[];
  ensureSession: () => Promise<ProjectSession | null>;
  onLaunch: (command: string) => void;
  onWriteToTerminal: (data: string) => Promise<void>;
}

export function ClaudeLauncher({
  projectPath,
  selectedSession,
  hasActiveTerminal,
  mcpsToInject,
  mcpsToRemove,
  ensureSession,
  onLaunch,
  onWriteToTerminal,
}: ClaudeLauncherProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customArgs, setCustomArgs] = useState('');
  const [activeModel, setActiveModel] = useState<string | null>(null);

  // Send /model command to switch model in running Claude instance
  const handleModelSwitch = useCallback(async (model: string) => {
    setActiveModel(model);
    await onWriteToTerminal(`/model ${model}`);
    await new Promise(resolve => setTimeout(resolve, 50));
    await onWriteToTerminal('\r');
  }, [onWriteToTerminal]);

  const handleLaunch = useCallback(async () => {
    // PASO 1: Garantizar sesión existe ANTES de construir comando
    const session = await ensureSession();

    if (!session) {
      console.error('[Launcher] No session available');
      return;
    }

    // PASO 2: Construir comando con sesión garantizada
    // wasPreExisting=true → --resume (sesiones que ya existían)
    // wasPreExisting=false → --session-id (sesiones recién creadas)
    const claudeCommand = buildClaudeCommand({
      sessionId: session.id,
      resume: session.wasPreExisting ?? false,
      additionalArgs: customArgs ? customArgs.split(' ').filter(Boolean) : undefined,
    });

    const allCommands: string[] = [];

    // First: remove MCPs marked for removal
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
        const escapedJson = jsonConfig.replace(/'/g, "'\"'\"'");
        return `claude mcp add-json "${mcp.name}" '${escapedJson}' -s user 2>/dev/null || true`;
      });
      allCommands.push(...injectCommands);
    }

    // Finally: launch Claude
    allCommands.push(claudeCommand);

    const fullCommand = allCommands.join(' ; ');
    console.log('[Launcher] Full command:', fullCommand);
    onLaunch(fullCommand);
  }, [mcpsToInject, mcpsToRemove, ensureSession, customArgs, onLaunch]);

  // Build preview command (muestra comportamiento esperado)
  const previewSession = selectedSession ?? { wasPreExisting: false };
  const claudeCmd = buildClaudeCommand({
    sessionId: selectedSession?.id ?? '<auto-session>',
    resume: (previewSession as ProjectSession).wasPreExisting ?? false,
    additionalArgs: customArgs ? customArgs.split(' ').filter(Boolean) : undefined,
  });

  const previewParts: string[] = [];
  if (mcpsToRemove.length > 0) previewParts.push(`[-${mcpsToRemove.length}]`);
  if (mcpsToInject.length > 0) previewParts.push(`[+${mcpsToInject.length}]`);

  const previewCommand = previewParts.length > 0
    ? `${previewParts.join(' ')} ; ${claudeCmd}`
    : claudeCmd;

  const canLaunch = hasActiveTerminal && projectPath;

  return (
    <div className="panel-section">
      <div className="box-title">Modelo</div>
      <div className="model-selector">
        <button
          className={`model-btn ${activeModel === 'haiku' ? 'active' : ''}`}
          onClick={() => handleModelSwitch('haiku')}
          disabled={!hasActiveTerminal}
        >
          Haiku
        </button>
        <button
          className={`model-btn ${activeModel === 'sonnet' ? 'active' : ''}`}
          onClick={() => handleModelSwitch('sonnet')}
          disabled={!hasActiveTerminal}
        >
          Sonnet
        </button>
        <button
          className={`model-btn ${activeModel === 'opus' ? 'active' : ''}`}
          onClick={() => handleModelSwitch('opus')}
          disabled={!hasActiveTerminal}
        >
          Opus
        </button>
      </div>

      {selectedSession && (
        <div className="flex items-center justify-between text-xs mt-2">
          <span className="text-muted">Sesión:</span>
          <span className="font-mono" title={selectedSession.id} style={{ color: 'var(--accent)' }}>
            {selectedSession.name}
          </span>
        </div>
      )}

      {/* Configuration Summary */}
      {(mcpsToRemove.length > 0 || mcpsToInject.length > 0) && (
        <div className="bg-zinc-800 rounded p-2 text-xs flex flex-col gap-1" style={{ backgroundColor: 'var(--bg-input)' }}>
          {mcpsToRemove.length > 0 && (
            <div className="flex justify-between text-red-400" style={{ color: 'var(--error)' }}>
              <span>Remover MCPs:</span>
              <span>{mcpsToRemove.length}</span>
            </div>
          )}
          {mcpsToInject.length > 0 && (
            <div className="flex justify-between text-green-400" style={{ color: 'var(--success)' }}>
              <span>Inyectar MCPs:</span>
              <span>{mcpsToInject.length}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>Opciones avanzadas</span>
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-2 p-2 bg-zinc-900 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
            <input
              type="text"
              className="custom-args-input"
              value={customArgs}
              onChange={(e) => setCustomArgs(e.target.value)}
              placeholder="Args adicionales..."
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">Preview:</span>
              <code className="text-xs font-mono text-zinc-500 break-all opacity-70">
                {previewCommand}
              </code>
            </div>
          </div>
        )}
      </div>

      <button
        className="btn-primary"
        onClick={handleLaunch}
        disabled={!canLaunch}
        title={!canLaunch ? 'Necesitas un proyecto con terminal activa' : 'Iniciar Claude'}
      >
        <Rocket size={16} />
        Iniciar Claude
      </button>

      {!hasActiveTerminal && (
        <div className="text-center text-xs text-muted opacity-60">
          Crea una terminal primero
        </div>
      )}
    </div>
  );
}
