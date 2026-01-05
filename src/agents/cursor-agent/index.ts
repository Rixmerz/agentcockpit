/**
 * Cursor Agent Plugin
 *
 * Main export for the cursor-agent CLI integration.
 */

import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import type { AgentPlugin } from '../../plugins/types/plugin';
import manifest from './manifest.json';
import { CursorAgentLauncher } from './components/CursorAgentLauncher';
import { buildCursorAgentCommand } from './services/cursorAgentService';

// ==================== Cursor Agent Plugin ====================

export const cursorAgentPlugin: AgentPlugin = {
  manifest: manifest as AgentPlugin['manifest'],

  // React Components
  Launcher: CursorAgentLauncher,

  // Services
  buildCommand: buildCursorAgentCommand,

  // Validate CLI installation
  validateInstallation: async () => {
    // Get home directory for ~/.local/bin check
    let homePath = '';
    try {
      homePath = await homeDir();
    } catch {
      // Fallback - will be handled by which command
    }

    // Build paths to check
    const paths = [
      '/usr/local/bin/cursor-agent',
      '/opt/homebrew/bin/cursor-agent',
      '/usr/bin/cursor-agent',
    ];

    // Add home path if available
    if (homePath) {
      paths.unshift(`${homePath}.local/bin/cursor-agent`);
    }

    for (const path of paths) {
      try {
        const result = await invoke<string>('execute_command', {
          cmd: `test -x "${path}" && echo "found"`,
          cwd: '/',
        });
        if (result.trim() === 'found') return true;
      } catch {
        // Not in this path
      }
    }

    // Also check via which (will find it in PATH including ~/.local/bin)
    try {
      const result = await invoke<string>('execute_command', {
        cmd: 'which cursor-agent 2>/dev/null',
        cwd: '/',
      });
      if (result.trim()) return true;
    } catch {
      // Not found
    }

    return false;
  },

  // Lifecycle hooks
  onActivate: () => {
    console.log('[CursorAgentPlugin] Activated');
  },

  onDeactivate: () => {
    console.log('[CursorAgentPlugin] Deactivated');
  },
};

// Re-export components for direct usage
export { CursorAgentLauncher } from './components/CursorAgentLauncher';
export { buildCursorAgentCommand } from './services/cursorAgentService';
