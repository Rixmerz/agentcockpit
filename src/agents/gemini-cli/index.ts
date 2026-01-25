/**
 * Gemini CLI Plugin
 *
 * Main export for the gemini CLI integration.
 */

import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import type { AgentPlugin } from '../../plugins/types/plugin';
import manifest from './manifest.json';
import { GeminiLauncher } from './components/GeminiLauncher';
import { GeminiMcpPanel } from './components/GeminiMcpPanel';
import { buildGeminiCommand } from './services/geminiService';

// ==================== Gemini Plugin ====================

export const geminiPlugin: AgentPlugin = {
  manifest: manifest as AgentPlugin['manifest'],

  // React Components
  Launcher: GeminiLauncher,
  McpPanel: GeminiMcpPanel,

  // Services
  buildCommand: buildGeminiCommand,

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
      '/usr/local/bin/gemini',
      '/opt/homebrew/bin/gemini',
      '/usr/bin/gemini',
    ];

    // Add home path if available
    if (homePath) {
      paths.unshift(`${homePath}.local/bin/gemini`);
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

    // Check via simple which first
    try {
      const result = await invoke<string>('execute_command', {
        cmd: 'which gemini 2>/dev/null',
        cwd: '/',
      });
      if (result.trim()) return true;
    } catch {
      // Not found
    }

    // Fallback: login shell to get full PATH (includes nvm, pyenv, etc.)
    try {
      const result = await invoke<string>('execute_command', {
        cmd: 'zsh -l -c "which gemini" 2>/dev/null',
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
    console.log('[GeminiPlugin] Activated');
  },

  onDeactivate: () => {
    console.log('[GeminiPlugin] Deactivated');
  },
};

// Re-export components for direct usage
export { GeminiLauncher } from './components/GeminiLauncher';
export { GeminiMcpPanel } from './components/GeminiMcpPanel';
export { buildGeminiCommand } from './services/geminiService';
