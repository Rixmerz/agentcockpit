import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';

interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  disabled?: boolean;
}

interface McpServer {
  name: string;
  source: 'desktop' | 'code';
  config: McpServerConfig;
}

interface McpPanelProps {
  selectedServers: string[];
  onSelectionChange: (servers: string[]) => void;
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

export function McpPanel({ selectedServers, onSelectionChange }: McpPanelProps) {
  const [desktopMcps, setDesktopMcps] = useState<McpServer[]>([]);
  const [codeMcps, setCodeMcps] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      console.log('[MCP] Normalized home:', normalizedHome);

      const desktopPath = `${normalizedHome}/Library/Application Support/Claude/claude_desktop_config.json`;
      const codePath = `${normalizedHome}/.claude.json`;

      console.log('[MCP] Desktop path:', desktopPath);
      console.log('[MCP] Code path:', codePath);

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
  }, []);

  useEffect(() => {
    loadMcps();
  }, [loadMcps]);

  const toggleServer = useCallback((serverName: string) => {
    if (selectedServers.includes(serverName)) {
      onSelectionChange(selectedServers.filter(s => s !== serverName));
    } else {
      onSelectionChange([...selectedServers, serverName]);
    }
  }, [selectedServers, onSelectionChange]);

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
              return (
                <div
                  key={`desktop-${server.name}`}
                  className={`mcp-server-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleServer(server.name)}
                >
                  <span className="mcp-server-name">{server.name}</span>
                  {isSelected && <span className="mcp-check">✓</span>}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Code Section */}
      <div className="mcp-section">
        <div className="mcp-section-header">
          <span className="mcp-section-title">Code ({codeMcps.length})</span>
        </div>
        <div className="mcp-server-list">
          {codeMcps.length === 0 ? (
            <div className="mcp-empty">Sin MCPs</div>
          ) : (
            codeMcps.map(server => {
              const isSelected = selectedServers.includes(server.name);
              return (
                <div
                  key={`code-${server.name}`}
                  className={`mcp-server-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleServer(server.name)}
                >
                  <span className="mcp-server-name">{server.name}</span>
                  {isSelected && <span className="mcp-check">✓</span>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
