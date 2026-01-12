/**
 * Plugin Configuration Service
 *
 * Manages plugin-specific settings stored in ~/.agentcockpit/plugins.json
 * Each plugin can have its own configuration section.
 */

import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { withTimeout } from '../core/utils/promiseTimeout';

const INVOKE_TIMEOUT_MS = 5000;
const CONFIG_DIR = '.agentcockpit';
const CONFIG_FILE = 'plugins.json';

/**
 * Claude plugin specific settings
 */
export interface ClaudePluginConfig {
  /** Whether to show the legacy MCP panel in the sidebar */
  showLegacyMcpPanel: boolean;
}

/**
 * All plugin configurations
 */
export interface PluginsConfig {
  version: string;
  lastUpdated: string;
  claude?: ClaudePluginConfig;
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
      console.log('[PluginConfig] Created config directory:', dir);
    }
  } catch (e) {
    console.error('[PluginConfig] Error creating directory:', e);
    throw e;
  }
}

/**
 * Get default plugin configuration
 */
function getDefaultConfig(): PluginsConfig {
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    claude: {
      showLegacyMcpPanel: true, // Default to showing legacy panel
    },
  };
}

/**
 * Get default Claude plugin config
 */
export function getDefaultClaudeConfig(): ClaudePluginConfig {
  return {
    showLegacyMcpPanel: true,
  };
}

/**
 * Load plugin configuration
 */
export async function loadPluginsConfig(): Promise<PluginsConfig> {
  try {
    const configPath = await getConfigPath();
    console.log('[PluginConfig] Loading from:', configPath);

    const fileExists = await exists(configPath);
    if (!fileExists) {
      console.log('[PluginConfig] Config not found, returning defaults');
      return getDefaultConfig();
    }

    const content = await withTimeout(
      readTextFile(configPath),
      INVOKE_TIMEOUT_MS,
      'read plugins.json'
    );

    const config = JSON.parse(content) as PluginsConfig;
    console.log('[PluginConfig] Loaded config');
    return config;
  } catch (e) {
    console.error('[PluginConfig] Load error:', e);
    return getDefaultConfig();
  }
}

/**
 * Save plugin configuration
 */
export async function savePluginsConfig(config: PluginsConfig): Promise<boolean> {
  try {
    await ensureConfigDir();
    const configPath = await getConfigPath();

    config.lastUpdated = new Date().toISOString();
    const content = JSON.stringify(config, null, 2);

    await withTimeout(
      writeTextFile(configPath, content),
      INVOKE_TIMEOUT_MS,
      'write plugins.json'
    );

    console.log('[PluginConfig] Saved config');
    return true;
  } catch (e) {
    console.error('[PluginConfig] Save error:', e);
    return false;
  }
}

/**
 * Get Claude plugin configuration
 */
export async function getClaudePluginConfig(): Promise<ClaudePluginConfig> {
  const config = await loadPluginsConfig();
  return config.claude ?? getDefaultClaudeConfig();
}

/**
 * Update Claude plugin configuration
 */
export async function updateClaudePluginConfig(
  updates: Partial<ClaudePluginConfig>
): Promise<{ success: boolean; message: string }> {
  try {
    const config = await loadPluginsConfig();

    config.claude = {
      ...getDefaultClaudeConfig(),
      ...config.claude,
      ...updates,
    };

    const saved = await savePluginsConfig(config);
    if (saved) {
      return { success: true, message: 'Configuration updated' };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

/**
 * Toggle legacy MCP panel visibility
 */
export async function toggleLegacyMcpPanel(): Promise<{ success: boolean; enabled: boolean; message: string }> {
  try {
    const current = await getClaudePluginConfig();
    const newValue = !current.showLegacyMcpPanel;

    const result = await updateClaudePluginConfig({ showLegacyMcpPanel: newValue });

    return {
      success: result.success,
      enabled: newValue,
      message: result.success
        ? `Legacy MCP panel ${newValue ? 'enabled' : 'disabled'}`
        : result.message,
    };
  } catch (e) {
    return { success: false, enabled: false, message: `Error: ${e}` };
  }
}
