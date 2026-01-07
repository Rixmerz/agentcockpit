import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { RefreshCw, Check, X, Import, Server, AlertCircle, Plus } from 'lucide-react';
import { withTimeout } from '../../core/utils/promiseTimeout';

// Timeout for file operations (same as snapshotService)
const INVOKE_TIMEOUT_MS = 5000;

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
  source: 'desktop' | 'code' | 'project';
  config: McpServerConfig;
}

interface McpPanelProps {
  projectPath: string | null;
  selectedServers: string[];
  onSelectionChange: (servers: string[]) => void;
  onMcpsForInjection: (mcps: McpServer[]) => void;
  onMcpsForRemoval: (names: string[]) => void;
}

// Read JSON file using Tauri FS plugin (avoids TCC cascade)
// Note: We skip exists() check because it has issues with paths containing spaces
async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    console.log('[MCP] Reading file:', path);
    const content = await withTimeout(
      readTextFile(path),
      INVOKE_TIMEOUT_MS,
      `read ${path}`
    );
    console.log('[MCP] File read successfully, length:', content.length);
    return JSON.parse(content);
  } catch (e) {
    // File might not exist or other error - return null
    console.log('[MCP] Read error (file may not exist):', path, e);
    return null;
  }
}

// Write JSON file using Tauri FS plugin (avoids TCC cascade)
async function writeJsonFile(path: string, data: unknown): Promise<boolean> {
  try {
    const json = JSON.stringify(data, null, 2);
    await withTimeout(
      writeTextFile(path, json),
      INVOKE_TIMEOUT_MS,
      `write ${path}`
    );
    return true;
  } catch (e) {
    console.error('[MCP] Write error:', e);
    return false;
  }
}

export function McpPanel({ projectPath, selectedServers, onSelectionChange, onMcpsForInjection, onMcpsForRemoval }: McpPanelProps) {
  const [desktopMcps, setDesktopMcps] = useState<McpServer[]>([]);
  const [codeMcps, setCodeMcps] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [homePath, setHomePath] = useState<string>('');
  const [serversToRemove, setServersToRemove] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualJson, setManualJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Show temporary message
  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  /**
   * Parse and validate manual MCP JSON input
   * Handles both formats:
   * - { "mcpServers": { "name": { config } } }
   * - { "name": { config } }
   */
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

      // Validate config structure (at minimum should be an object)
      if (typeof config !== 'object' || config === null) {
        setJsonError('Configuration must be an object');
        return null;
      }

      // Validate it has at least command or url
      const configObj = config as Record<string, unknown>;
      if (!configObj.command && !configObj.url) {
        setJsonError('Configuration must have "command" or "url"');
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

  // Load MCPs
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

      // Normalize home path (remove trailing slash if present)
      const normalizedHome = home.endsWith('/') ? home.slice(0, -1) : home;
      setHomePath(normalizedHome);

      const desktopPath = `${normalizedHome}/Library/Application Support/Claude/claude_desktop_config.json`;
      const codePath = `${normalizedHome}/.claude.json`;

      // Load Desktop MCPs
      const desktopServers: McpServer[] = [];
      try {
        const desktopConfig = await readJsonFile(desktopPath) as { mcpServers?: Record<string, McpServerConfig> } | null;
        if (desktopConfig?.mcpServers) {
          for (const [name, config] of Object.entries(desktopConfig.mcpServers)) {
            desktopServers.push({ name, source: 'desktop', config });
          }
        }
      } catch (e) {
        console.error('[MCP] Desktop load error:', e);
      }

      // Load Code MCPs
      const codeServers: McpServer[] = [];
      try {
        const codeConfig = await readJsonFile(codePath) as { mcpServers?: Record<string, McpServerConfig> } | null;
        if (codeConfig?.mcpServers) {
          for (const [name, config] of Object.entries(codeConfig.mcpServers)) {
            codeServers.push({ name, source: 'code', config });
          }
        }
      } catch (e) {
        console.error('[MCP] Code load error:', e);
      }

      setDesktopMcps(desktopServers);
      setCodeMcps(codeServers);
    } catch (e) {
      console.error('[MCP] General error:', e);
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    loadMcps();
  }, [loadMcps]);

  // Add manual MCP from JSON
  const handleAddManualMcp = useCallback(async () => {
    const parsed = parseManualMcpJson(manualJson);
    if (!parsed) return;

    const { name, config } = parsed;

    try {
      const desktopPath = `${homePath}/Library/Application Support/Claude/claude_desktop_config.json`;
      const existingConfig = await readJsonFile(desktopPath) as { mcpServers?: Record<string, McpServerConfig> } | null;

      if (!existingConfig) {
        showMessage('error', 'Could not read configuration file');
        return;
      }

      // Check if server already exists
      if (existingConfig.mcpServers?.[name]) {
        showMessage('error', `Server "${name}" already exists`);
        return;
      }

      // Add new server
      const newConfig = {
        ...existingConfig,
        mcpServers: {
          ...existingConfig.mcpServers,
          [name]: config,
        },
      };

      const success = await writeJsonFile(desktopPath, newConfig);
      if (success) {
        showMessage('success', `"${name}" added successfully`);
        setShowManualInput(false);
        setManualJson('');
        setJsonError(null);
        loadMcps(); // Reload to show new MCP
      } else {
        showMessage('error', 'Error saving configuration');
      }
    } catch (e) {
      console.error('[MCP] Add manual error:', e);
      showMessage('error', `Error: ${e}`);
    }
  }, [manualJson, parseManualMcpJson, homePath, loadMcps, showMessage]);

  // Single click: toggle inject (green)
  const handleSingleClick = useCallback((serverName: string) => {
    // If marked for removal, clear it first
    if (serversToRemove.includes(serverName)) {
      const newRemove = serversToRemove.filter(s => s !== serverName);
      setServersToRemove(newRemove);
      onMcpsForRemoval(newRemove);
      return;
    }

    // Toggle inject selection
    let newSelection: string[];
    if (selectedServers.includes(serverName)) {
      newSelection = selectedServers.filter(s => s !== serverName);
    } else {
      newSelection = [...selectedServers, serverName];
    }
    onSelectionChange(newSelection);

    // Update MCPs for injection (only Desktop MCPs)
    const mcpsToInject = desktopMcps.filter(mcp => newSelection.includes(mcp.name));
    onMcpsForInjection(mcpsToInject);
  }, [selectedServers, serversToRemove, onSelectionChange, desktopMcps, onMcpsForInjection, onMcpsForRemoval]);

  // Double click: mark for removal (red)
  const handleDoubleClick = useCallback((serverName: string) => {
    // Remove from inject if selected
    if (selectedServers.includes(serverName)) {
      const newSelection = selectedServers.filter(s => s !== serverName);
      onSelectionChange(newSelection);
      const mcpsToInject = desktopMcps.filter(mcp => newSelection.includes(mcp.name));
      onMcpsForInjection(mcpsToInject);
    }

    // Toggle removal state
    let newRemove: string[];
    if (serversToRemove.includes(serverName)) {
      newRemove = serversToRemove.filter(s => s !== serverName);
    } else {
      newRemove = [...serversToRemove, serverName];
    }
    setServersToRemove(newRemove);
    onMcpsForRemoval(newRemove);
  }, [selectedServers, serversToRemove, onSelectionChange, desktopMcps, onMcpsForInjection, onMcpsForRemoval]);

  // Remove Desktop MCP
  const handleRemoveDesktop = useCallback(async (name: string) => {
    try {
      const desktopPath = `${homePath}/Library/Application Support/Claude/claude_desktop_config.json`;
      const config = await readJsonFile(desktopPath) as { mcpServers?: Record<string, McpServerConfig> } | null;

      if (!config?.mcpServers?.[name]) {
        showMessage('error', `"${name}" not found`);
        return;
      }

      const { [name]: _, ...remainingServers } = config.mcpServers;
      const newConfig = { ...config, mcpServers: remainingServers };

      const success = await writeJsonFile(desktopPath, newConfig);
      if (success) {
        showMessage('success', `"${name}" removed from Desktop`);
        // Remove from selection if selected
        if (selectedServers.includes(name)) {
          onSelectionChange(selectedServers.filter(s => s !== name));
        }
        loadMcps();
      } else {
        showMessage('error', 'Error removing');
      }
    } catch (e) {
      console.error('[MCP] Remove Desktop error:', e);
      showMessage('error', `Error: ${e}`);
    }
  }, [homePath, selectedServers, onSelectionChange, loadMcps, showMessage]);

  // Remove Code MCP using CLI
  const handleRemoveCode = useCallback(async (name: string) => {
    try {
      await invoke<string>('execute_command', {
        cmd: `claude mcp remove "${name}" -s user 2>&1`,
        cwd: '/',
      });
      showMessage('success', `"${name}" removed from Code`);
      loadMcps();
    } catch (e) {
      console.error('[MCP] Remove Code error:', e);
      showMessage('error', `Error: ${e}`);
    }
  }, [loadMcps, showMessage]);

  // Import Desktop MCP to Code
  const handleImportToCode = useCallback(async (server: McpServer) => {
    try {
      const jsonConfig = JSON.stringify(server.config);
      const escapedJson = jsonConfig.replace(/'/g, "'\"'\"'");

      await invoke<string>('execute_command', {
        cmd: `claude mcp add-json "${server.name}" '${escapedJson}' -s user 2>&1`,
        cwd: '/',
      });

      showMessage('success', `"${server.name}" imported to Code`);
      loadMcps();
    } catch (e) {
      console.error('[MCP] Import to Code error:', e);
      showMessage('error', `Error: ${e}`);
    }
  }, [loadMcps, showMessage]);

  if (isLoading) {
    return (
      <div className="panel-section">
        <div className="box-title">MCP Servers</div>
        <div className="flex items-center justify-center p-4 text-xs text-muted">
          <RefreshCw size={14} className="animate-spin mr-2" />
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-section">
        <div className="box-title">MCP Servers</div>
        <div className="p-4 bg-red-900/20 text-red-400 rounded text-xs flex items-center gap-2" style={{ color: 'var(--error)' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      </div>
    );
  }

  const totalMcps = desktopMcps.length + codeMcps.length;

  return (
    <div className="mcp-manager">
      <div
        className="mcp-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="mcp-title">
          MCP Servers ({totalMcps})
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

          {/* Desktop Section */}
          <div className="mcp-section">
            <div className="mcp-section-title">
              <span>Desktop ({desktopMcps.length})</span>
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
                  placeholder={`Example:\n{\n  "sequential": {\n    "command": "docker",\n    "args": ["run", "--rm", "-i", "mcp/sequentialthinking"]\n  }\n}`}
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
              {desktopMcps.length === 0 ? (
                <div className="mcp-empty">No MCPs</div>
              ) : (
                desktopMcps.map(server => {
                  const isSelected = selectedServers.includes(server.name);
                  const isMarkedForRemoval = serversToRemove.includes(server.name);
                  const isInCode = codeMcps.some(c => c.name === server.name);
                  return (
                    <div key={`desktop-${server.name}`} className="mcp-item group">
                      <div
                        className="mcp-item-content"
                        onClick={() => handleSingleClick(server.name)}
                        title="Click: inject | Double click: remove"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleDoubleClick(server.name);
                        }}
                      >
                        <Server size={14} style={{ color: isMarkedForRemoval ? 'var(--error)' : isSelected ? 'var(--success)' : 'var(--text-muted)' }} />
                        <span className={`mcp-name ${isMarkedForRemoval ? 'line-through opacity-70' : ''}`}>
                          {server.name}
                        </span>
                        {isSelected && !isMarkedForRemoval && <Check size={12} style={{ color: 'var(--success)' }} />}
                        {isMarkedForRemoval && <X size={12} style={{ color: 'var(--error)' }} />}
                      </div>

                      <div className="mcp-actions">
                        {!isInCode && (
                          <button
                            className="btn-icon-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleImportToCode(server);
                            }}
                            title="Import to Code"
                          >
                            <Import size={12} />
                          </button>
                        )}
                        <button
                          className="btn-icon-sm danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveDesktop(server.name);
                          }}
                          title="Remove from Desktop"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Code Section */}
          <div className="mcp-section">
            <div className="mcp-section-title">
              <span>Code ({codeMcps.length})</span>
              <span className="mcp-section-badge">default</span>
            </div>

            <div className="mcp-list">
              {codeMcps.length === 0 ? (
                <div className="mcp-empty">No MCPs</div>
              ) : (
                codeMcps.map(server => (
                  <div key={`code-${server.name}`} className="mcp-item group">
                    <div className="mcp-item-content">
                      <Server size={14} style={{ color: 'var(--accent)' }} />
                      <span className="mcp-name">{server.name}</span>
                    </div>
                    <div className="mcp-actions">
                      <button
                        className="btn-icon-sm danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCode(server.name);
                        }}
                        title="Remove from Code"
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
