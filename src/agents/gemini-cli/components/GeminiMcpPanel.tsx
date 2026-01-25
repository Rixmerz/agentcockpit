/**
 * Gemini MCP Panel
 *
 * Manages MCP servers for Gemini CLI.
 * Configuration stored in ~/.gemini/settings.json
 */

import { useState, useEffect, useCallback } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { RefreshCw, Server, AlertCircle, Plus, X } from 'lucide-react';

// Timeout for file operations
const INVOKE_TIMEOUT_MS = 5000;

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface GeminiSettings {
  ide?: {
    hasSeenNudge?: boolean;
    enabled?: boolean;
  };
  mcpServers?: Record<string, McpServerConfig>;
  security?: {
    auth?: {
      selectedType?: string;
    };
  };
  [key: string]: unknown;
}

interface GeminiMcpPanelProps {
  projectPath: string | null;
}

// Read JSON file with timeout
async function readJsonFile(path: string): Promise<GeminiSettings | null> {
  try {
    console.log('[GeminiMCP] Reading file:', path);
    const content = await Promise.race([
      readTextFile(path),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), INVOKE_TIMEOUT_MS)
      ),
    ]);
    console.log('[GeminiMCP] File content length:', content.length);
    const parsed = JSON.parse(content);
    console.log('[GeminiMCP] Parsed settings:', JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (e) {
    console.error('[GeminiMCP] Read error:', path, e);
    return null;
  }
}

// Write JSON file
async function writeJsonFile(path: string, data: GeminiSettings): Promise<boolean> {
  try {
    const json = JSON.stringify(data, null, 2);
    await Promise.race([
      writeTextFile(path, json),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), INVOKE_TIMEOUT_MS)
      ),
    ]);
    return true;
  } catch (e) {
    console.error('[GeminiMCP] Write error:', e);
    return false;
  }
}

export function GeminiMcpPanel({ projectPath }: GeminiMcpPanelProps) {
  const [mcpServers, setMcpServers] = useState<Array<{ name: string; config: McpServerConfig }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [homePath, setHomePath] = useState<string>('');
  const [expanded, setExpanded] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualJson, setManualJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Show temporary message
  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // Get settings file path
  const getSettingsPath = useCallback(() => {
    return `${homePath}/.gemini/settings.json`;
  }, [homePath]);

  // Parse manual MCP JSON input
  const parseManualMcpJson = useCallback((jsonText: string): {
    name: string;
    config: McpServerConfig;
  } | null => {
    try {
      const parsed = JSON.parse(jsonText);

      // Check if it's wrapped with mcpServers
      let serversObj = parsed;
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        serversObj = parsed.mcpServers;
      }

      // Extract first (and should be only) server
      const entries = Object.entries(serversObj);
      if (entries.length === 0) {
        setJsonError('No MCP server found in JSON');
        return null;
      }

      if (entries.length > 1) {
        setJsonError('Only one server can be added at a time');
        return null;
      }

      const [name, config] = entries[0];

      // Validate config structure
      if (typeof config !== 'object' || config === null) {
        setJsonError('Configuration must be an object');
        return null;
      }

      // Validate it has command
      const configObj = config as Record<string, unknown>;
      if (!configObj.command) {
        setJsonError('Configuration must have "command"');
        return null;
      }

      setJsonError(null);
      return { name: name as string, config: config as McpServerConfig };
    } catch (e) {
      if (e instanceof SyntaxError) {
        setJsonError(`Invalid JSON: ${e.message}`);
      } else {
        setJsonError('Error processing JSON');
      }
      return null;
    }
  }, []);

  // Load MCPs from settings file
  const loadMcps = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const home = await homeDir();
      if (!home) {
        setError('No home directory');
        setIsLoading(false);
        return;
      }

      const normalizedHome = home.endsWith('/') ? home.slice(0, -1) : home;
      setHomePath(normalizedHome);

      const settingsPath = `${normalizedHome}/.gemini/settings.json`;
      const settings = await readJsonFile(settingsPath);

      const servers: Array<{ name: string; config: McpServerConfig }> = [];
      if (settings?.mcpServers) {
        for (const [name, config] of Object.entries(settings.mcpServers)) {
          servers.push({ name, config });
        }
      }

      setMcpServers(servers);
    } catch (e) {
      console.error('[GeminiMCP] General error:', e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMcps();
  }, [loadMcps]);

  // Add manual MCP from JSON
  const handleAddManualMcp = useCallback(async () => {
    const parsed = parseManualMcpJson(manualJson);
    if (!parsed) return;

    const { name, config } = parsed;

    try {
      const settingsPath = getSettingsPath();
      const existingSettings = await readJsonFile(settingsPath);

      // Create default settings if file doesn't exist
      const settings: GeminiSettings = existingSettings || {
        mcpServers: {},
      };

      // Initialize mcpServers if not exists
      if (!settings.mcpServers) {
        settings.mcpServers = {};
      }

      // Check if server already exists
      if (settings.mcpServers[name]) {
        showMessage('error', `Server "${name}" already exists`);
        return;
      }

      // Add new server
      settings.mcpServers[name] = config;

      const success = await writeJsonFile(settingsPath, settings);
      if (success) {
        showMessage('success', `"${name}" added successfully`);
        setShowManualInput(false);
        setManualJson('');
        setJsonError(null);
        loadMcps();
      } else {
        showMessage('error', 'Error saving configuration');
      }
    } catch (e) {
      console.error('[GeminiMCP] Add manual error:', e);
      showMessage('error', `Error: ${e}`);
    }
  }, [manualJson, parseManualMcpJson, getSettingsPath, loadMcps, showMessage]);

  // Remove MCP server
  const handleRemoveMcp = useCallback(async (name: string) => {
    try {
      const settingsPath = getSettingsPath();
      const settings = await readJsonFile(settingsPath);

      if (!settings?.mcpServers?.[name]) {
        showMessage('error', `"${name}" not found`);
        return;
      }

      const { [name]: _, ...remainingServers } = settings.mcpServers;
      settings.mcpServers = remainingServers;

      const success = await writeJsonFile(settingsPath, settings);
      if (success) {
        showMessage('success', `"${name}" removed`);
        loadMcps();
      } else {
        showMessage('error', 'Error removing');
      }
    } catch (e) {
      console.error('[GeminiMCP] Remove error:', e);
      showMessage('error', `Error: ${e}`);
    }
  }, [getSettingsPath, loadMcps, showMessage]);

  if (isLoading) {
    return (
      <div className="mcp-manager">
        <div className="mcp-header">
          <span className="mcp-title">MCP Servers</span>
          <RefreshCw size={12} className="animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mcp-manager">
        <div className="mcp-header">
          <span className="mcp-title">MCP Servers</span>
        </div>
        <div className="p-2 text-xs flex items-center gap-2" style={{ color: 'var(--error)' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mcp-manager">
      <div
        className="mcp-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="mcp-title">
          MCP Servers ({mcpServers.length})
        </span>
        <button
          className="mcp-refresh-btn"
          onClick={(e) => {
            e.stopPropagation();
            loadMcps();
          }}
          title="Reload"
        >
          <RefreshCw size={12} />
        </button>
        <span className="mcp-expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="mcp-content">
          {message && (
            <div className={`mcp-message ${message.type}`}>
              {message.text}
            </div>
          )}

          <div className="mcp-section">
            <div className="mcp-section-title">
              <span>~/.gemini/settings.json</span>
              <button
                className="btn-icon-sm"
                onClick={() => setShowManualInput(!showManualInput)}
                title="Add MCP manually"
              >
                <Plus size={12} />
              </button>
            </div>

            {showManualInput && (
              <div className="manual-mcp-input">
                <label className="manual-mcp-label">
                  MCP Server JSON
                </label>
                <textarea
                  className="manual-mcp-textarea"
                  value={manualJson}
                  onChange={(e) => {
                    setManualJson(e.target.value);
                    if (jsonError) setJsonError(null);
                  }}
                  onBlur={() => {
                    if (manualJson.trim()) {
                      parseManualMcpJson(manualJson);
                    }
                  }}
                  placeholder={`Example:\n{\n  "my-server": {\n    "command": "npx",\n    "args": ["-y", "mcp-remote", "http://localhost:3001/sse"],\n    "env": { "NODE_ENV": "production" }\n  }\n}`}
                  rows={8}
                />
                {jsonError && (
                  <div className="manual-mcp-error">
                    {jsonError}
                  </div>
                )}
                <div className="manual-mcp-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setShowManualInput(false);
                      setManualJson('');
                      setJsonError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleAddManualMcp}
                    disabled={!manualJson.trim() || !!jsonError}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            <div className="mcp-list">
              {mcpServers.length === 0 ? (
                <div className="mcp-empty">No MCPs configured</div>
              ) : (
                mcpServers.map(server => (
                  <div key={server.name} className="mcp-item group">
                    <div className="mcp-item-content">
                      <Server size={14} style={{ color: 'var(--accent)' }} />
                      <span className="mcp-name">{server.name}</span>
                    </div>
                    <div className="mcp-actions">
                      <button
                        className="btn-icon-sm danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveMcp(server.name);
                        }}
                        title="Remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
