import { useState, useEffect, useCallback } from 'react';
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

// Read JSON file using cat command
async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    console.log('[MCP] Reading file:', path);
    const result = await invoke<string>('execute_command', {
      cmd: `cat "${path}"`,
      cwd: '/',
    });
    const parsed = JSON.parse(result);
    console.log('[MCP] Parsed successfully');
    return parsed;
  } catch (e) {
    console.error('[MCP] Read error:', e);
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

// Write JSON file
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

  // Show temporary message
  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // Load MCPs
  const loadMcps = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const home = await homeDir();
      console.log('[MCP] Home directory:', home);

      if (!home) {
        setError('No home directory');
        setIsLoading(false);
        return;
      }

      // Normalize home path (remove trailing slash if present)
      const normalizedHome = home.endsWith('/') ? home.slice(0, -1) : home;
      setHomePath(normalizedHome);
      console.log('[MCP] Normalized home:', normalizedHome);

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
          console.log('[MCP] Desktop MCPs loaded:', desktopServers.length);
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
          console.log('[MCP] Code MCPs loaded:', codeServers.length);
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
        showMessage('error', `"${name}" no encontrado`);
        return;
      }

      const { [name]: _, ...remainingServers } = config.mcpServers;
      const newConfig = { ...config, mcpServers: remainingServers };

      const success = await writeJsonFile(desktopPath, newConfig);
      if (success) {
        showMessage('success', `"${name}" eliminado de Desktop`);
        // Remove from selection if selected
        if (selectedServers.includes(name)) {
          onSelectionChange(selectedServers.filter(s => s !== name));
        }
        loadMcps();
      } else {
        showMessage('error', 'Error al eliminar');
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
      showMessage('success', `"${name}" eliminado de Code`);
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

      showMessage('success', `"${server.name}" importado a Code`);
      loadMcps();
    } catch (e) {
      console.error('[MCP] Import to Code error:', e);
      showMessage('error', `Error: ${e}`);
    }
  }, [loadMcps, showMessage]);

  if (isLoading) {
    return (
      <div className="mcp-panel">
        <div className="mcp-panel-header">
          <span className="mcp-panel-title">MCP Servers</span>
        </div>
        <div className="mcp-loading">Cargando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mcp-panel">
        <div className="mcp-panel-header">
          <span className="mcp-panel-title">MCP Servers</span>
        </div>
        <div className="mcp-error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="mcp-panel">
      <div className="mcp-panel-header">
        <span className="mcp-panel-title">MCP Servers</span>
        <button
          className="mcp-refresh-btn"
          onClick={loadMcps}
          title="Recargar"
        >
          ↻
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className={`mcp-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Desktop Section */}
      <div className="mcp-section">
        <div className="mcp-section-header">
          <span className="mcp-section-title">Desktop ({desktopMcps.length})</span>
        </div>
        <div className="mcp-server-list">
          {desktopMcps.length === 0 ? (
            <div className="mcp-empty">Sin MCPs</div>
          ) : (
            desktopMcps.map(server => {
              const isSelected = selectedServers.includes(server.name);
              const isMarkedForRemoval = serversToRemove.includes(server.name);
              const isInCode = codeMcps.some(c => c.name === server.name);
              return (
                <div key={`desktop-${server.name}`} className="mcp-server-item">
                  <div
                    className={`mcp-server-main ${isSelected ? 'selected' : ''} ${isMarkedForRemoval ? 'marked-remove' : ''}`}
                    onClick={() => handleSingleClick(server.name)}
                    title="Click: inyectar MCP"
                  >
                    <span className="mcp-server-name">{server.name}</span>
                    <span className={`mcp-check ${isSelected ? 'checked' : ''} ${isMarkedForRemoval ? 'remove' : ''}`}>
                      {isMarkedForRemoval ? '✗' : isSelected ? '✓' : ''}
                    </span>
                  </div>
                  <div className="mcp-server-actions">
                    <button
                      className={`mcp-action-btn mark-remove ${isMarkedForRemoval ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDoubleClick(server.name);
                      }}
                      title="Marcar para remover del proyecto"
                    >
                      −
                    </button>
                    {!isInCode && (
                      <button
                        className="mcp-action-btn import"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleImportToCode(server);
                        }}
                        title="Importar a Code"
                      >
                        →C
                      </button>
                    )}
                    <button
                      className="mcp-action-btn remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveDesktop(server.name);
                      }}
                      title="Eliminar de Desktop"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Code Section - No checkboxes, MCPs go by default */}
      <div className="mcp-section">
        <div className="mcp-section-header">
          <span className="mcp-section-title">Code ({codeMcps.length})</span>
          <span className="mcp-section-hint">van por defecto</span>
        </div>
        <div className="mcp-server-list">
          {codeMcps.length === 0 ? (
            <div className="mcp-empty">Sin MCPs</div>
          ) : (
            codeMcps.map(server => (
              <div key={`code-${server.name}`} className="mcp-server-item">
                <div className="mcp-server-main">
                  <span className="mcp-server-name">{server.name}</span>
                </div>
                <div className="mcp-server-actions">
                  <button
                    className="mcp-action-btn remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveCode(server.name);
                    }}
                    title="Eliminar"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
