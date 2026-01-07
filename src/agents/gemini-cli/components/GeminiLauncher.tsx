/**
 * Gemini Launcher
 *
 * Simple launch button for gemini CLI.
 * Part of the gemini-cli plugin.
 */

import { useCallback } from 'react';
import { Rocket } from 'lucide-react';
import type { LauncherProps } from '../../../plugins/types/plugin';

export function GeminiLauncher({
  projectPath,
  hasActiveTerminal,
  onLaunch,
}: LauncherProps) {
  const handleLaunch = useCallback(() => {
    onLaunch('gemini');
  }, [onLaunch]);

  const canLaunch = hasActiveTerminal && projectPath;

  return (
    <div className="panel-section">
      <button
        className="btn-primary"
        onClick={handleLaunch}
        disabled={!canLaunch}
        title={!canLaunch ? 'You need a project with an active terminal' : 'Start Gemini'}
      >
        <Rocket size={16} />
        Start Gemini
      </button>

      {!hasActiveTerminal && (
        <div className="text-center text-xs text-muted opacity-60">
          Create a terminal first
        </div>
      )}
    </div>
  );
}
