/**
 * Claude Agent Plugin
 *
 * Main export for the Claude Code CLI integration.
 */

import { invoke } from '@tauri-apps/api/core';
import type { AgentPlugin } from '../../plugins/types/plugin';
import manifest from './manifest.json';
import { ClaudeLauncher } from './components/ClaudeLauncher';
import { McpPanel } from './components/McpPanel';
import { ClaudeQuickActions } from './components/QuickActions';
import { buildClaudeCommand } from './services/claudeService';

// ==================== Claude Plugin ====================

export const claudePlugin: AgentPlugin = {
  manifest: manifest as AgentPlugin['manifest'],

  // React Components
  Launcher: ClaudeLauncher,
  McpPanel: McpPanel,
  QuickActions: ClaudeQuickActions,

  // Services
  buildCommand: buildClaudeCommand,

  // Validate CLI installation
  validateInstallation: async () => {
    // Check specific paths where claude CLI is typically installed
    const paths = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/bin/claude',
    ];

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

    // Also check via simple which (no login shell)
    try {
      const result = await invoke<string>('execute_command', {
        cmd: 'which claude 2>/dev/null',
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
    console.log('[ClaudePlugin] Activated');
  },

  onDeactivate: () => {
    console.log('[ClaudePlugin] Deactivated');
  },
};

// Re-export types that may be needed externally
export type { McpServer, McpServerConfig } from './components/McpPanel';
