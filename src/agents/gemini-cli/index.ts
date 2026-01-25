/**
 * Gemini CLI Plugin
 *
 * Main export for the gemini CLI integration.
 */

import { invoke } from '@tauri-apps/api/core';
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
    try {
      const result = await invoke<string>('execute_command', {
        cmd: 'which gemini',
        cwd: '/',
      });
      return result.trim().length > 0;
    } catch {
      return false;
    }
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
