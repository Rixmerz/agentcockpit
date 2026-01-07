/**
 * Claude Launcher
 *
 * Model selection and Claude CLI launch component.
 * Part of the Claude agent plugin.
 */

import { useState, useCallback } from 'react';
import { Rocket, ChevronRight, ChevronDown } from 'lucide-react';
import type { LauncherProps } from '../../../plugins/types/plugin';
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
    // Ensure session exists BEFORE building command
    const currentSession = await ensureSession();
    if (!currentSession) {
      console.error('[ClaudeLauncher] No session available - aborting launch');
      return;
    }

    // Simple logic: if session was already selected (from list) → --resume
    // If session was just created by ensureSession() → --session-id
    const sessionWasPreSelected = session !== null && session.id === currentSession.id;

    const baseArgs = customArgs ? customArgs.split(' ').filter(Boolean) : [];
    const filteredArgs = baseArgs.filter(arg => arg !== '--dangerously-skip-permissions');
    const allArgs = skipPermissions
      ? [...filteredArgs, '--dangerously-skip-permissions']
      : filteredArgs;

    // Build command: --resume if pre-selected, --session-id if newly created
    const args: string[] = ['claude'];
    if (sessionWasPreSelected) {
      args.push('--resume', currentSession.id);
    } else {
      args.push('--session-id', currentSession.id);
    }
    if (allArgs.length > 0) {
      args.push(...allArgs);
    }
    const claudeCommand = args.join(' ');

    const allCommands: string[] = [];

    // First: remove MCPs marked for removal
    if (mcpsToRemove.length > 0) {
      const removeCommands = mcpsToRemove.map(name =>
        wrapCommandSafe(`claude mcp remove "${name}"`)
      );
      allCommands.push(...removeCommands);
    }

    // Second: inject MCPs
    if (mcpsToInject.length > 0) {
      const injectCommands = mcpsToInject.map(mcp => {
        const escapedJson = escapeJsonForShell(mcp.config);
        return wrapCommandSafe(`claude mcp add-json "${mcp.name}" '${escapedJson}' -s user`);
      });
      allCommands.push(...injectCommands);
    }

    // Finally: launch Claude
    allCommands.push(claudeCommand);

    const fullCommand = joinCommandsSequential(allCommands);
    onLaunch(fullCommand);
  }, [session, mcpsToInject, mcpsToRemove, ensureSession, customArgs, skipPermissions, onLaunch]);

  // Build preview command (synchronous version for display)
  const previewBaseArgs = customArgs ? customArgs.split(' ').filter(Boolean) : [];
  const previewFiltered = previewBaseArgs.filter(arg => arg !== '--dangerously-skip-permissions');
  const previewAllArgs = skipPermissions
    ? [...previewFiltered, '--dangerously-skip-permissions']
    : previewFiltered;

  // Simple preview: shows that command will use session detection
  const sessionDisplay = session?.id ? `${session.id.slice(0, 8)}...` : '<auto-session>';
  const claudeCmd = `claude [--resume|--session-id] ${sessionDisplay}${previewAllArgs.length > 0 ? ' ' + previewAllArgs.join(' ') : ''}`;

  const previewParts: string[] = [];
  if (mcpsToRemove.length > 0) previewParts.push(`[-${mcpsToRemove.length}]`);
  if (mcpsToInject.length > 0) previewParts.push(`[+${mcpsToInject.length}]`);

  const previewCommand = previewParts.length > 0
    ? `${previewParts.join(' ')} ; ${claudeCmd}`
    : claudeCmd;

  const canLaunch = hasActiveTerminal && projectPath;

  return (
    <div className="panel-section">
      <div className="box-title">Model</div>
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
            className="skip-permissions-checkbox cursor-pointer"
          />
          <span>Skip permissions</span>
        </label>
      </div>

      {session && (
        <div className="flex items-center justify-between text-xs mt-2">
          <span className="text-muted">Session:</span>
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
              <span>Remove MCPs:</span>
              <span>{mcpsToRemove.length}</span>
            </div>
          )}
          {mcpsToInject.length > 0 && (
            <div className="flex justify-between" style={{ color: 'var(--success)' }}>
              <span>Inject MCPs:</span>
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
          <span>Advanced options</span>
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-2 p-2 rounded" style={{ backgroundColor: 'var(--bg-input)' }}>
            <input
              type="text"
              className="custom-args-input"
              value={customArgs}
              onChange={(e) => setCustomArgs(e.target.value)}
              placeholder="Additional args..."
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
        title={!canLaunch ? 'You need a project with an active terminal' : 'Start Claude'}
      >
        <Rocket size={16} />
        Start Claude
      </button>

      {!hasActiveTerminal && (
        <div className="text-center text-xs text-muted opacity-60">
          Create a terminal first
        </div>
      )}
    </div>
  );
}
