import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  cwd?: string;
  disabled?: boolean;
}

export interface McpServer {
  name: string;
  source: 'desktop' | 'code';
  config: McpServerConfig;
  status?: 'connected' | 'failed' | 'unknown';
}

export interface McpConfigs {
  desktop: McpServer[];
  code: McpServer[];
}

// Path for Claude Desktop config (relative to home)
const CLAUDE_DESKTOP_CONFIG_PATH = 'Library/Application Support/Claude/claude_desktop_config.json';

async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    console.log('[MCP] Reading file:', path);
    const result = await invoke<string>('execute_command', {
      cmd: `cat "${path}"`,
      cwd: '/',
    });
    const parsed = JSON.parse(result);
    console.log('[MCP] Successfully parsed JSON from:', path);
    return parsed;
  } catch (e) {
    console.error('[MCP] Failed to read/parse file:', path, e);
    return null;
  }
}

// Unicode-safe base64 encoding
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function writeJsonFile(path: string, data: unknown): Promise<boolean> {
  try {
    const json = JSON.stringify(data, null, 2);
    const base64 = utf8ToBase64(json);
    await invoke<string>('execute_command', {
      cmd: `echo "${base64}" | base64 -d > "${path}"`,
      cwd: '/',
    });
    return true;
  } catch (e) {
    console.error('Failed to write JSON file:', e);
    return false;
  }
}

// Get Claude Desktop config path
export async function getDesktopConfigPath(): Promise<string> {
  const home = await homeDir();
  if (!home) {
    throw new Error('Could not determine home directory');
  }
  // IMPORTANTE: Agregar / entre home y el path relativo
  return `${home}/${CLAUDE_DESKTOP_CONFIG_PATH}`;
}

// Load Claude Desktop MCPs from config file
export async function loadDesktopMcps(): Promise<McpServer[]> {
  const servers: McpServer[] = [];

  try {
    const configPath = await getDesktopConfigPath();
    console.log('[MCP] Loading Desktop MCPs from:', configPath);

    const config = await readJsonFile(configPath) as { mcpServers?: Record<string, McpServerConfig> } | null;

    if (!config) {
      console.warn('[MCP] No Desktop config found or failed to parse');
      return servers;
    }

    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        servers.push({
          name,
          source: 'desktop',
          config: serverConfig,
          status: 'unknown',
        });
      }
      console.log('[MCP] Loaded', servers.length, 'Desktop MCPs:', servers.map(s => s.name).join(', '));
    } else {
      console.warn('[MCP] Desktop config has no mcpServers key');
    }
  } catch (e) {
    console.error('[MCP] Failed to load Claude Desktop config:', e);
  }

  return servers;
}

// Get Claude Code config path (~/.claude.json)
export async function getCodeConfigPath(): Promise<string> {
  const home = await homeDir();
  if (!home) {
    throw new Error('Could not determine home directory');
  }
  return `${home}/.claude.json`;
}

// Load Claude Code MCPs from ~/.claude.json
export async function loadCodeMcps(): Promise<McpServer[]> {
  const servers: McpServer[] = [];

  try {
    const configPath = await getCodeConfigPath();
    console.log('[MCP] Loading Code MCPs from:', configPath);

    const config = await readJsonFile(configPath) as { mcpServers?: Record<string, McpServerConfig> } | null;

    if (!config) {
      console.warn('[MCP] No Code config found or failed to parse');
      return servers;
    }

    if (config.mcpServers) {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        servers.push({
          name,
          source: 'code',
          config: serverConfig,
          status: 'unknown',
        });
      }
      console.log('[MCP] Loaded', servers.length, 'Code MCPs:', servers.map(s => s.name).join(', '));
    } else {
      console.warn('[MCP] Code config has no mcpServers key');
    }
  } catch (e) {
    console.error('[MCP] Failed to load Claude Code config:', e);
  }

  return servers;
}

// Load all MCP configs
export async function loadMcpConfigs(): Promise<McpConfigs> {
  const [desktop, code] = await Promise.all([
    loadDesktopMcps(),
    loadCodeMcps(),
  ]);

  return { desktop, code };
}

// ==================== Desktop MCP Management ====================

// Add MCP to Claude Desktop config
export async function addDesktopMcp(name: string, config: McpServerConfig): Promise<boolean> {
  try {
    const configPath = await getDesktopConfigPath();
    const existingConfig = await readJsonFile(configPath) as { mcpServers?: Record<string, McpServerConfig> } | null;

    const newConfig = {
      ...existingConfig,
      mcpServers: {
        ...(existingConfig?.mcpServers || {}),
        [name]: config,
      },
    };

    return await writeJsonFile(configPath, newConfig);
  } catch (e) {
    console.error('Failed to add Desktop MCP:', e);
    return false;
  }
}

// Remove MCP from Claude Desktop config
export async function removeDesktopMcp(name: string): Promise<boolean> {
  try {
    const configPath = await getDesktopConfigPath();
    const existingConfig = await readJsonFile(configPath) as { mcpServers?: Record<string, McpServerConfig> } | null;

    if (!existingConfig?.mcpServers?.[name]) {
      return false;
    }

    const { [name]: _, ...remainingServers } = existingConfig.mcpServers;

    const newConfig = {
      ...existingConfig,
      mcpServers: remainingServers,
    };

    return await writeJsonFile(configPath, newConfig);
  } catch (e) {
    console.error('Failed to remove Desktop MCP:', e);
    return false;
  }
}

// ==================== Code MCP Management ====================

// Add MCP to Claude Code using CLI
export async function addCodeMcp(name: string, config: McpServerConfig): Promise<{ success: boolean; message: string }> {
  try {
    // Build the add-json command
    const jsonConfig = JSON.stringify(config);
    // Escape for shell
    const escapedJson = jsonConfig.replace(/'/g, "'\"'\"'");

    const result = await invoke<string>('execute_command', {
      cmd: `claude mcp add-json "${name}" '${escapedJson}' -s user 2>&1`,
      cwd: '/',
    });

    return { success: true, message: result };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

// Remove MCP from Claude Code using CLI
export async function removeCodeMcp(name: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await invoke<string>('execute_command', {
      cmd: `claude mcp remove "${name}" -s user 2>&1`,
      cwd: '/',
    });

    return { success: true, message: result };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

// Import MCP from Desktop to Code
export async function importDesktopToCode(name: string): Promise<{ success: boolean; message: string }> {
  try {
    // First get the Desktop config for this server
    const desktopServers = await loadDesktopMcps();
    const server = desktopServers.find(s => s.name === name);

    if (!server) {
      return { success: false, message: `Server "${name}" not found in Desktop config` };
    }

    // Add it to Code
    return await addCodeMcp(name, server.config);
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

// Import all Desktop MCPs to Code
export async function importAllDesktopToCode(): Promise<{ success: boolean; message: string }> {
  try {
    const result = await invoke<string>('execute_command', {
      cmd: 'claude mcp add-from-claude-desktop 2>&1',
      cwd: '/',
    });

    return { success: true, message: result };
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

// Get MCP server details
export async function getMcpDetails(name: string): Promise<string> {
  try {
    const result = await invoke<string>('execute_command', {
      cmd: `claude mcp get "${name}" 2>&1`,
      cwd: '/',
    });
    return result;
  } catch (e) {
    return `Error: ${e}`;
  }
}
