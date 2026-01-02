/**
 * Claude Launcher
 *
 * Model selection and Claude CLI launch component.
 * Part of the Claude agent plugin.
 */

import { useState, useCallback } from 'react';
import { Rocket, ChevronRight, ChevronDown } from 'lucide-react';
import type { LauncherProps } from '../../../plugins/types/plugin';
import { buildClaudeCommand } from '../services/claudeService';
import {
  executeAction,
  escapeJsonForShell,
  joinCommandsSequential,
  wrapCommandSafe,
} from '../../../core/utils/terminalCommands';

export function ClaudeLauncher({
  projectPath,
  session,
  hasActiveTerminal,
  mcpsToInject,
  mcpsToRemove,
  ensureSession,
  onLaunch,
  onWriteToTerminal,
}: LauncherProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customArgs, setCustomArgs] = useState('');
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [skipPermissions, setSkipPermissions] = useState(false);

  // Send /model command to switch model in running Claude instance
  const handleModelSwitch = useCallback(async (model: string) => {
    setActiveModel(model);
    await executeAction(onWriteToTerminal, `/model ${model}`);
  }, [onWriteToTerminal]);

  const handleLaunch = useCallback(async () => {
    console.log('[ClaudeLauncher] Launch button clicked');
    console.log('[ClaudeLauncher] State:', {
      projectPath,
      hasActiveTerminal,
      mcpsToInject: mcpsToInject.length,
      mcpsToRemove: mcpsToRemove.length,
      customArgs
    });

    // STEP 1: Ensure session exists BEFORE building command
    console.log('[ClaudeLauncher] Step 1: Ensuring session...');
    const currentSession = await ensureSession();
    console.log('[ClaudeLauncher] Session ensured:', currentSession?.id ?? 'NULL');

    if (!currentSession) {
      console.error('[ClaudeLauncher] No session available - aborting launch');
      return;
    }

    // STEP 2: Build command with guaranteed session
    console.log('[ClaudeLauncher] Step 2: Building command...');
    // wasPreExisting=true → --resume (existing sessions)
    // wasPreExisting=false → --session-id (newly created sessions)
    const baseArgs = customArgs ? customArgs.split(' ').filter(Boolean) : [];
    const filteredArgs = baseArgs.filter(arg => arg !== '--dangerously-skip-permissions');
    const allArgs = skipPermissions
      ? [...filteredArgs, '--dangerously-skip-permissions']
      : filteredArgs;

    const claudeCommand = buildClaudeCommand({
      sessionId: currentSession.id,
      resume: currentSession.wasPreExisting ?? false,
      additionalArgs: allArgs.length > 0 ? allArgs : undefined,
    });
    console.log('[ClaudeLauncher] Claude command built:', claudeCommand);

    const allCommands: string[] = [];

    // First: remove MCPs marked for removal
    if (mcpsToRemove.length > 0) {
      console.log('[ClaudeLauncher] Adding MCP remove commands:', mcpsToRemove);
      const removeCommands = mcpsToRemove.map(name =>
        wrapCommandSafe(`claude mcp remove "${name}"`)
      );
      allCommands.push(...removeCommands);
    }

    // Second: inject MCPs
    if (mcpsToInject.length > 0) {
      console.log('[ClaudeLauncher] Adding MCP inject commands:', mcpsToInject.map(m => m.name));
      const injectCommands = mcpsToInject.map(mcp => {
        const escapedJson = escapeJsonForShell(mcp.config);
        return wrapCommandSafe(`claude mcp add-json "${mcp.name}" '${escapedJson}' -s user`);
      });
      allCommands.push(...injectCommands);
    }

    // Finally: launch Claude
    allCommands.push(claudeCommand);

    const fullCommand = joinCommandsSequential(allCommands);
    console.log('[ClaudeLauncher] Full command:', fullCommand);
    console.log('[ClaudeLauncher] Executing onLaunch callback...');
    onLaunch(fullCommand);
    console.log('[ClaudeLauncher] Launch complete');
  }, [projectPath, hasActiveTerminal, mcpsToInject, mcpsToRemove, ensureSession, customArgs, skipPermissions, onLaunch]);

  // Build preview command
  const previewSession = session ?? { wasPreExisting: false };
  const previewBaseArgs = customArgs ? customArgs.split(' ').filter(Boolean) : [];
  const previewFiltered = previewBaseArgs.filter(arg => arg !== '--dangerously-skip-permissions');
  const previewAllArgs = skipPermissions
    ? [...previewFiltered, '--dangerously-skip-permissions']
    : previewFiltered;

  const claudeCmd = buildClaudeCommand({
    sessionId: session?.id ?? '<auto-session>',
    resume: (previewSession as { wasPreExisting?: boolean }).wasPreExisting ?? false,
    additionalArgs: previewAllArgs.length > 0 ? previewAllArgs : undefined,
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

      {/* Skip Permissions Toggle */}
      <div className="flex items-center justify-between mt-2 px-1">
        <label className="text-xs text-muted cursor-pointer flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={(e) => setSkipPermissions(e.target.checked)}
            disabled={!hasActiveTerminal}
            className="cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-input)',
              borderColor: 'var(--accent-dim)',
              accentColor: 'var(--accent)',
            }}
          />
          <span>Skip permissions</span>
        </label>
      </div>

      {session && (
        <div className="flex items-center justify-between text-xs mt-2">
          <span className="text-muted">Sesión:</span>
          <span className="font-mono" title={session.id} style={{ color: 'var(--accent)' }}>
            {session.name}
          </span>
        </div>
      )}

      {/* Configuration Summary */}
      {(mcpsToRemove.length > 0 || mcpsToInject.length > 0) && (
        <div className="bg-zinc-800 rounded p-2 text-xs flex flex-col gap-1" style={{ backgroundColor: 'var(--bg-input)' }}>
          {mcpsToRemove.length > 0 && (
            <div className="flex justify-between" style={{ color: 'var(--error)' }}>
              <span>Remover MCPs:</span>
              <span>{mcpsToRemove.length}</span>
            </div>
          )}
          {mcpsToInject.length > 0 && (
            <div className="flex justify-between" style={{ color: 'var(--success)' }}>
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
          <div className="flex flex-col gap-2 p-2 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
            <input
              type="text"
              className="custom-args-input"
              value={customArgs}
              onChange={(e) => setCustomArgs(e.target.value)}
              placeholder="Args adicionales..."
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">Preview:</span>
              <code className="text-xs font-mono break-all opacity-70" style={{ color: 'var(--text-muted)' }}>
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
