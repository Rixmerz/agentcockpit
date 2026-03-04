/**
 * LSP Service — Calls scripts/claude-lsp-setup for LSP management.
 */

import { invoke } from '@tauri-apps/api/core';

const SCRIPT_PATH = '/var/home/rixmerz/agentcockpit/scripts/claude-lsp-setup';

export interface LspStatus {
  plugin: string;
  displayName: string;
  hasBinary: boolean;
  binaryType: 'native' | 'wrapper' | '';
  hasPlugin: boolean;
}

export interface LspDetection {
  detected: string[];
  missing: string[];
  installed: string[];
}

async function runLspSetup(args: string, cwd: string): Promise<string> {
  return invoke<string>('execute_command', {
    cmd: `python3 ${SCRIPT_PATH} ${args}`,
    cwd,
  });
}

export async function getLspStatus(): Promise<LspStatus[]> {
  const output = await runLspSetup('--status --json', '/');
  return JSON.parse(output.trim());
}

export async function detectProjectLsps(projectPath: string): Promise<LspDetection> {
  const output = await runLspSetup(`--detect --json "${projectPath}"`, projectPath);
  return JSON.parse(output.trim());
}

export async function installLsp(plugin: string): Promise<boolean> {
  const output = await runLspSetup(`--install-single ${plugin}`, '/');
  const result = JSON.parse(output.trim());
  return result.success === true;
}

export async function uninstallLsp(plugin: string): Promise<boolean> {
  const output = await runLspSetup(`--uninstall-single ${plugin}`, '/');
  const result = JSON.parse(output.trim());
  return result.success === true;
}
