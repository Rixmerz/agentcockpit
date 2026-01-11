/**
 * MCP Configuration Service
 *
 * Manages a centralized MCP configuration at ~/.agentcockpit/mcps.json
 * This is the source of truth for MCPs used by the pipeline system.
 *
 * The execute_mcp_tool in pipeline-manager reads from this config.
 */

import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { withTimeout } from '../core/utils/promiseTimeout';

const INVOKE_TIMEOUT_MS = 5000;
const CONFIG_DIR = '.agentcockpit';
const CONFIG_FILE = 'mcps.json';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  cwd?: string;
  disabled?: boolean;
}

export interface ManagedMcp {
  name: string;
  config: McpServerConfig;
  importedFrom?: 'desktop' | 'code' | 'manual';
  importedAt?: string;
  notes?: string;
}

export interface McpConfig {
  version: string;
  mcpServers: Record<string, ManagedMcp>;
  lastUpdated: string;
}

// Cache
let cachedHomePath: string | null = null;

async function getHomePath(): Promise<string> {
  if (!cachedHomePath) {
    const home = await homeDir();
    if (!home) throw new Error('Could not determine home directory');
    cachedHomePath = home.endsWith('/') ? home.slice(0, -1) : home;
  }
  return cachedHomePath;
}

async function getConfigPath(): Promise<string> {
  const home = await getHomePath();
  return `${home}/${CONFIG_DIR}/${CONFIG_FILE}`;
}

async function getConfigDir(): Promise<string> {
  const home = await getHomePath();
  return `${home}/${CONFIG_DIR}`;
}

/**
 * Ensure the config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  const dir = await getConfigDir();
  try {
    const dirExists = await exists(dir);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
      console.log('[McpConfig] Created config directory:', dir);
    }
  } catch (e) {
    console.error('[McpConfig] Error creating directory:', e);
    throw e;
  }
}

/**
 * Get default empty config
 */
function getDefaultConfig(): McpConfig {
  return {
    version: '1.0.0',
    mcpServers: {},
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Load MCP configuration from ~/.agentcockpit/mcps.json
 */
export async function loadMcpConfig(): Promise<McpConfig> {
  try {
    const configPath = await getConfigPath();
    console.log('[McpConfig] Loading from:', configPath);

    const fileExists = await exists(configPath);
    if (!fileExists) {
      console.log('[McpConfig] Config not found, returning defaults');
      return getDefaultConfig();
    }

    const content = await withTimeout(
      readTextFile(configPath),
      INVOKE_TIMEOUT_MS,
      'read mcps.json'
    );

    const config = JSON.parse(content) as McpConfig;
    console.log('[McpConfig] Loaded', Object.keys(config.mcpServers).length, 'MCPs');
    return config;
  } catch (e) {
    console.error('[McpConfig] Load error:', e);
    return getDefaultConfig();
  }
}

/**
 * Save MCP configuration to ~/.agentcockpit/mcps.json
 */
export async function saveMcpConfig(config: McpConfig): Promise<boolean> {
  try {
    await ensureConfigDir();
    const configPath = await getConfigPath();

    config.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(config, null, 2);

    await withTimeout(
      writeTextFile(configPath, content),
      INVOKE_TIMEOUT_MS,
      'write mcps.json'
    );

    console.log('[McpConfig] Saved', Object.keys(config.mcpServers).length, 'MCPs');
    return true;
  } catch (e) {
    console.error('[McpConfig] Save error:', e);
    return false;
  }
}

/**
 * Add an MCP to the configuration
 */
export async function addMcp(
  name: string,
  serverConfig: McpServerConfig,
  source: 'desktop' | 'code' | 'manual' = 'manual',
  notes?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const config = await loadMcpConfig();

    if (config.mcpServers[name]) {
      return { success: false, message: `MCP "${name}" already exists` };
    }

    config.mcpServers[name] = {
      name,
      config: serverConfig,
      importedFrom: source,
      importedAt: new Date().toISOString(),
      notes
    };

    const saved = await saveMcpConfig(config);
    if (saved) {
      return { success: true, message: `MCP "${name}" added successfully` };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

/**
 * Remove an MCP from the configuration
 */
export async function removeMcp(name: string): Promise<{ success: boolean; message: string }> {
  try {
    const config = await loadMcpConfig();

    if (!config.mcpServers[name]) {
      return { success: false, message: `MCP "${name}" not found` };
    }

    delete config.mcpServers[name];

    const saved = await saveMcpConfig(config);
    if (saved) {
      return { success: true, message: `MCP "${name}" removed successfully` };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

/**
 * Update an MCP configuration
 */
export async function updateMcp(
  name: string,
  serverConfig: McpServerConfig
): Promise<{ success: boolean; message: string }> {
  try {
    const config = await loadMcpConfig();

    if (!config.mcpServers[name]) {
      return { success: false, message: `MCP "${name}" not found` };
    }

    config.mcpServers[name].config = serverConfig;

    const saved = await saveMcpConfig(config);
    if (saved) {
      return { success: true, message: `MCP "${name}" updated successfully` };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

/**
 * Toggle MCP disabled state
 */
export async function toggleMcpDisabled(name: string): Promise<{ success: boolean; message: string }> {
  try {
    const config = await loadMcpConfig();

    if (!config.mcpServers[name]) {
      return { success: false, message: `MCP "${name}" not found` };
    }

    const current = config.mcpServers[name].config.disabled || false;
    config.mcpServers[name].config.disabled = !current;

    const saved = await saveMcpConfig(config);
    if (saved) {
      const status = config.mcpServers[name].config.disabled ? 'disabled' : 'enabled';
      return { success: true, message: `MCP "${name}" ${status}` };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

// =====================================================
// Import functions for Desktop and Code MCPs
// =====================================================

/**
 * Load MCPs from Claude Desktop config
 */
export async function loadDesktopMcps(): Promise<Record<string, McpServerConfig>> {
  try {
    const home = await getHomePath();
    const desktopPath = `${home}/Library/Application Support/Claude/claude_desktop_config.json`;

    const fileExists = await exists(desktopPath);
    if (!fileExists) return {};

    const content = await withTimeout(
      readTextFile(desktopPath),
      INVOKE_TIMEOUT_MS,
      'read desktop config'
    );

    const config = JSON.parse(content);
    return config.mcpServers || {};
  } catch (e) {
    console.error('[McpConfig] Load Desktop MCPs error:', e);
    return {};
  }
}

/**
 * Load MCPs from Claude Code config (~/.claude.json)
 */
export async function loadCodeMcps(): Promise<Record<string, McpServerConfig>> {
  try {
    const home = await getHomePath();
    const codePath = `${home}/.claude.json`;

    const fileExists = await exists(codePath);
    if (!fileExists) return {};

    const content = await withTimeout(
      readTextFile(codePath),
      INVOKE_TIMEOUT_MS,
      'read code config'
    );

    const config = JSON.parse(content);
    return config.mcpServers || {};
  } catch (e) {
    console.error('[McpConfig] Load Code MCPs error:', e);
    return {};
  }
}

/**
 * Import MCP from Desktop config (copies, does NOT remove from original)
 */
export async function importFromDesktop(name: string): Promise<{ success: boolean; message: string }> {
  const desktopMcps = await loadDesktopMcps();

  if (!desktopMcps[name]) {
    return { success: false, message: `MCP "${name}" not found in Desktop config` };
  }

  return addMcp(name, desktopMcps[name], 'desktop');
}

/**
 * Import MCP from Code config (copies, does NOT remove from original)
 */
export async function importFromCode(name: string): Promise<{ success: boolean; message: string }> {
  const codeMcps = await loadCodeMcps();

  if (!codeMcps[name]) {
    return { success: false, message: `MCP "${name}" not found in Code config` };
  }

  return addMcp(name, codeMcps[name], 'code');
}

/**
 * Import all MCPs from Desktop config
 */
export async function importAllFromDesktop(): Promise<{ success: boolean; imported: number; skipped: number; message: string }> {
  const desktopMcps = await loadDesktopMcps();
  const config = await loadMcpConfig();

  let imported = 0;
  let skipped = 0;

  for (const [name, serverConfig] of Object.entries(desktopMcps)) {
    if (config.mcpServers[name]) {
      skipped++;
      continue;
    }

    config.mcpServers[name] = {
      name,
      config: serverConfig,
      importedFrom: 'desktop',
      importedAt: new Date().toISOString()
    };
    imported++;
  }

  if (imported > 0) {
    await saveMcpConfig(config);
  }

  return {
    success: true,
    imported,
    skipped,
    message: `Imported ${imported} MCPs, skipped ${skipped} (already exist)`
  };
}

/**
 * Import all MCPs from Code config
 */
export async function importAllFromCode(): Promise<{ success: boolean; imported: number; skipped: number; message: string }> {
  const codeMcps = await loadCodeMcps();
  const config = await loadMcpConfig();

  let imported = 0;
  let skipped = 0;

  for (const [name, serverConfig] of Object.entries(codeMcps)) {
    if (config.mcpServers[name]) {
      skipped++;
      continue;
    }

    config.mcpServers[name] = {
      name,
      config: serverConfig,
      importedFrom: 'code',
      importedAt: new Date().toISOString()
    };
    imported++;
  }

  if (imported > 0) {
    await saveMcpConfig(config);
  }

  return {
    success: true,
    imported,
    skipped,
    message: `Imported ${imported} MCPs, skipped ${skipped} (already exist)`
  };
}

/**
 * Open config file in default editor
 */
export async function openConfigInEditor(): Promise<{ success: boolean; message: string }> {
  try {
    await ensureConfigDir();
    const configPath = await getConfigPath();

    // Ensure file exists
    const fileExists = await exists(configPath);
    if (!fileExists) {
      await saveMcpConfig(getDefaultConfig());
    }

    await invoke<string>('execute_command', {
      cmd: `open "${configPath}"`,
      cwd: '/'
    });

    return { success: true, message: 'Opening config file...' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

/**
 * Get config file path (for display purposes)
 */
export async function getConfigFilePath(): Promise<string> {
  return getConfigPath();
}

/**
 * Get list of active (non-disabled) MCPs
 */
export async function getActiveMcps(): Promise<ManagedMcp[]> {
  const config = await loadMcpConfig();
  return Object.values(config.mcpServers).filter(mcp => !mcp.config.disabled);
}

/**
 * Get count of active MCPs
 */
export async function getActiveMcpCount(): Promise<number> {
  const active = await getActiveMcps();
  return active.length;
}
