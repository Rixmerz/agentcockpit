/**
 * Agentful Launcher
 *
 * Setup and launch panel for agentful autonomous development.
 * Provides Init (npx install) and Start Dev Loop actions.
 */

import { useCallback } from 'react';
import { Rocket, PackagePlus } from 'lucide-react';
import type { LauncherProps } from '../../../plugins/types/plugin';
import { executeAction } from '../../../core/utils/terminalCommands';

export function AgentfulLauncher({
  hasActiveTerminal,
  onWriteToTerminal,
  skipPermissions,
  onSkipPermissionsChange,
}: LauncherProps) {
  const handleInit = useCallback(async () => {
    await onWriteToTerminal('npx @itz4blitz/agentful init\n');
  }, [onWriteToTerminal]);

  const handleStart = useCallback(async () => {
    await executeAction(onWriteToTerminal, '/agentful-start');
  }, [onWriteToTerminal]);

  return (
    <div className="panel-section">
      <div className="box-title">Agentful</div>

      {/* Skip permissions toggle */}
      <div className="flex items-center justify-between mt-2 px-1">
        <label className="text-xs text-muted cursor-pointer flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipPermissions ?? false}
            onChange={(e) => onSkipPermissionsChange?.(e.target.checked)}
            disabled={!hasActiveTerminal}
            className="skip-permissions-checkbox cursor-pointer"
          />
          <span>Skip permissions</span>
        </label>
      </div>

      {/* Init button — runs npx @itz4blitz/agentful init in terminal shell */}
      <button
        className="btn-primary"
        onClick={handleInit}
        disabled={!hasActiveTerminal}
        title="Install/setup agentful in current project (npx @itz4blitz/agentful init)"
        style={{ backgroundColor: 'var(--bg-input)', color: 'var(--text-primary)' }}
      >
        <PackagePlus size={16} />
        Init Project
      </button>

      {/* Start button — sends /agentful-start to running Claude session */}
      <button
        className="btn-primary"
        onClick={handleStart}
        disabled={!hasActiveTerminal}
        title="Start the agentful development loop"
      >
        <Rocket size={16} />
        Start Dev Loop
      </button>

      {!hasActiveTerminal && (
        <div className="text-center text-xs text-muted opacity-60">
          Create a terminal first
        </div>
      )}
    </div>
  );
}
