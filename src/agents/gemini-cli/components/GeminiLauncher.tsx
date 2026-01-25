/**
 * Gemini Launcher
 *
 * Launch button for Gemini CLI with yolo mode support.
 * Part of the gemini-cli plugin.
 */

import { useState, useCallback } from 'react';
import { Rocket, ChevronRight, ChevronDown } from 'lucide-react';
import type { LauncherProps } from '../../../plugins/types/plugin';

export function GeminiLauncher({
  projectPath,
  hasActiveTerminal,
  onLaunch,
  skipPermissions = false,
  onSkipPermissionsChange,
}: LauncherProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customArgs, setCustomArgs] = useState('');

  const handleSkipPermissionsChange = (value: boolean) => {
    onSkipPermissionsChange?.(value);
  };

  const handleLaunch = useCallback(() => {
    const args: string[] = ['gemini'];

    // Add yolo mode if enabled
    if (skipPermissions) {
      args.push('-y');
    }

    // Add custom args (filter out -y if already present to avoid duplicates)
    if (customArgs) {
      const customArgsList = customArgs.split(' ').filter(arg => arg && arg !== '-y');
      args.push(...customArgsList);
    }

    onLaunch(args.join(' '));
  }, [skipPermissions, customArgs, onLaunch]);

  // Build preview command
  const previewArgs: string[] = ['gemini'];
  if (skipPermissions) {
    previewArgs.push('-y');
  }
  if (customArgs) {
    const filteredCustomArgs = customArgs.split(' ').filter(arg => arg && arg !== '-y');
    previewArgs.push(...filteredCustomArgs);
  }
  const previewCommand = previewArgs.join(' ');

  const canLaunch = hasActiveTerminal && projectPath;

  return (
    <div className="panel-section">
      {/* Yolo Mode Toggle */}
      <div className="flex items-center justify-between mt-2 px-1">
        <label className="text-xs text-muted cursor-pointer flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipPermissions}
            onChange={(e) => handleSkipPermissionsChange(e.target.checked)}
            disabled={!hasActiveTerminal}
            className="skip-permissions-checkbox cursor-pointer"
          />
          <span>Yolo mode (-y)</span>
        </label>
      </div>

      {/* Advanced Options */}
      <div className="flex flex-col gap-2 mt-2">
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
