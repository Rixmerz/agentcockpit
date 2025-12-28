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
    try {
      await invoke<string>('execute_command', {
        cmd: 'which claude',
        cwd: '/',
      });
      return true;
    } catch {
      return false;
    }
  },

  // Lifecycle hooks
  onActivate: () => {
    console.log('[ClaudePlugin] Activated');
  },

  onDeactivate: () => {
    console.log('[ClaudePlugin] Deactivated');
  },
};

// Re-export components for direct usage
export { ClaudeLauncher } from './components/ClaudeLauncher';
export { McpPanel } from './components/McpPanel';
export { ClaudeQuickActions } from './components/QuickActions';
export { buildClaudeCommand } from './services/claudeService';
export type { McpServer, McpServerConfig } from './components/McpPanel';
