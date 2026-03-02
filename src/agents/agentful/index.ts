/**
 * Agentful Agent Plugin
 *
 * Autonomous feature-driven development with quality gates.
 * Integrates agentful slash commands and pipeline graph activation
 * into AgentCockpit's plugin system.
 */

import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import type { AgentPlugin } from '../../plugins/types/plugin';
import manifest from './manifest.json';
import { AgentfulLauncher } from './components/AgentfulLauncher';
import { AgentfulQuickActions } from './components/QuickActions';
import { buildAgentfulCommand } from './services/agentfulService';

export const agentfulPlugin: AgentPlugin = {
  manifest: manifest as AgentPlugin['manifest'],

  // React Components
  Launcher: AgentfulLauncher,
  QuickActions: AgentfulQuickActions,

  // Services
  buildCommand: buildAgentfulCommand,

  // Validate CLI installation (agentful needs claude CLI)
  validateInstallation: async () => {
    let homePath = '';
    try {
      homePath = await homeDir();
    } catch {
      // Fallback
    }

    const paths = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/bin/claude',
    ];

    if (homePath) {
      const normalized = homePath.endsWith('/') ? homePath.slice(0, -1) : homePath;
      paths.push(`${normalized}/.local/bin/claude`);
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

  onActivate: () => {
    console.log('[AgentfulPlugin] Activated');
  },

  onDeactivate: () => {
    console.log('[AgentfulPlugin] Deactivated');
  },
};
