/**
 * Cursor Agent Launcher
 *
 * Simple launch button for cursor-agent CLI.
 * Part of the cursor-agent plugin.
 */

import { useCallback } from 'react';
import { Rocket } from 'lucide-react';
import type { LauncherProps } from '../../../plugins/types/plugin';

export function CursorAgentLauncher({
  projectPath,
  hasActiveTerminal,
  onLaunch,
}: LauncherProps) {
  const handleLaunch = useCallback(() => {
    onLaunch('cursor-agent');
  }, [onLaunch]);

  const canLaunch = hasActiveTerminal && projectPath;

  return (
    <div className="panel-section">
      <button
        className="btn-primary"
        onClick={handleLaunch}
        disabled={!canLaunch}
        title={!canLaunch ? 'You need a project with an active terminal' : 'Start Cursor Agent'}
      >
        <Rocket size={16} />
        Start Cursor Agent
      </button>

      {!hasActiveTerminal && (
        <div className="text-center text-xs text-muted opacity-60">
          Create a terminal first
        </div>
      )}
    </div>
  );
}
