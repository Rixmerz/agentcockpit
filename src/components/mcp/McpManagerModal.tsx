/**
 * MCP Manager Modal
 *
 * Central modal for managing MCPs in AgentCockpit.
 * Uses ~/.agentcockpit/mcps.json as the source of truth.
 *
 * Features:
 * - View active MCPs
 * - Import from Claude Desktop / Claude Code
 * - Add manually via JSON
 * - Remove MCPs
 * - Open config in editor
 */

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../common/Modal';
import {
  Server,
  Download,
  Plus,
  Trash2,
  FileEdit,
  RefreshCw,
  AlertTriangle,
  Check,
  X,
  Power,
  PowerOff,
  Info
} from 'lucide-react';
import {
  loadMcpConfig,
  loadDesktopMcps,
  loadCodeMcps,
  addMcp,
  removeMcp,
  toggleMcpDisabled,
  importFromDesktop,
  importFromCode,
  importAllFromDesktop,
  importAllFromCode,
  openConfigInEditor,
  getConfigFilePath,
  type ManagedMcp,
  type McpServerConfig
} from '../../services/mcpConfigService';

interface McpManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMcpsChanged?: () => void;
}

type TabType = 'active' | 'import' | 'add';

export function McpManagerModal({ isOpen, onClose, onMcpsChanged }: McpManagerModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [activeMcps, setActiveMcps] = useState<ManagedMcp[]>([]);
  const [desktopMcps, setDesktopMcps] = useState<Record<string, McpServerConfig>>({});
  const [codeMcps, setCodeMcps] = useState<Record<string, McpServerConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [configPath, setConfigPath] = useState<string>('');

  // Manual add state
  const [manualJson, setManualJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Show temporary message
  const showMessage = useCallback((type: 'success' | 'error' | 'warning', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  // Load all data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [config, desktop, code, path] = await Promise.all([
        loadMcpConfig(),
        loadDesktopMcps(),
        loadCodeMcps(),
        getConfigFilePath()
      ]);

      setActiveMcps(Object.values(config.mcpServers));
      setDesktopMcps(desktop);
      setCodeMcps(code);
      setConfigPath(path);
    } catch (e) {
      console.error('[McpManager] Load error:', e);
      showMessage('error', `Error loading MCPs: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [showMessage]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Handle remove MCP
  const handleRemove = useCallback(async (name: string) => {
    const result = await removeMcp(name);
    if (result.success) {
      showMessage('success', result.message);
      loadData();
      onMcpsChanged?.();
    } else {
      showMessage('error', result.message);
    }
  }, [loadData, showMessage, onMcpsChanged]);

  // Handle toggle disabled
  const handleToggleDisabled = useCallback(async (name: string) => {
    const result = await toggleMcpDisabled(name);
    if (result.success) {
      showMessage('success', result.message);
      loadData();
      onMcpsChanged?.();
    } else {
      showMessage('error', result.message);
    }
  }, [loadData, showMessage, onMcpsChanged]);

  // Handle import single MCP
  const handleImportSingle = useCallback(async (name: string, source: 'desktop' | 'code') => {
    const result = source === 'desktop'
      ? await importFromDesktop(name)
      : await importFromCode(name);

    if (result.success) {
      showMessage('success', result.message);
      loadData();
      onMcpsChanged?.();
    } else {
      showMessage('error', result.message);
    }
  }, [loadData, showMessage, onMcpsChanged]);

  // Handle import all
  const handleImportAll = useCallback(async (source: 'desktop' | 'code') => {
    const result = source === 'desktop'
      ? await importAllFromDesktop()
      : await importAllFromCode();

    if (result.success) {
      showMessage('success', result.message);
      loadData();
      onMcpsChanged?.();
    } else {
      showMessage('error', 'Failed to import MCPs');
    }
  }, [loadData, showMessage, onMcpsChanged]);

  // Handle open config
  const handleOpenConfig = useCallback(async () => {
    const result = await openConfigInEditor();
    if (result.success) {
      showMessage('success', result.message);
    } else {
      showMessage('error', result.message);
    }
  }, [showMessage]);

  // Parse manual JSON
  const parseManualJson = useCallback((jsonText: string): { name: string; config: McpServerConfig } | null => {
    try {
      const parsed = JSON.parse(jsonText);

      // Handle both formats
      let serversObj = parsed;
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        serversObj = parsed.mcpServers;
      }

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

      if (typeof config !== 'object' || config === null) {
        setJsonError('Configuration must be an object');
        return null;
      }

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

  // Handle add manual MCP
  const handleAddManual = useCallback(async () => {
    const parsed = parseManualJson(manualJson);
    if (!parsed) return;

    const result = await addMcp(parsed.name, parsed.config, 'manual');
    if (result.success) {
      showMessage('success', result.message);
      setManualJson('');
      setJsonError(null);
      loadData();
      onMcpsChanged?.();
    } else {
      showMessage('error', result.message);
    }
  }, [manualJson, parseManualJson, loadData, showMessage, onMcpsChanged]);

  // Check if MCP is already imported
  const isAlreadyImported = useCallback((name: string) => {
    return activeMcps.some(mcp => mcp.name === name);
  }, [activeMcps]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="MCP Manager">
      <div className="mcp-manager-modal">
        {/* Warning Banner */}
        <div className="mcp-warning-banner">
          <AlertTriangle size={16} />
          <span>
            This is your centralized MCP configuration. The pipeline system reads from this config.
            Importing copies MCPs - originals in Desktop/Code remain unchanged.
          </span>
        </div>

        {/* Tabs */}
        <div className="mcp-tabs">
          <button
            className={`mcp-tab ${activeTab === 'active' ? 'active' : ''}`}
            onClick={() => setActiveTab('active')}
          >
            <Server size={14} />
            Active ({activeMcps.length})
          </button>
          <button
            className={`mcp-tab ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <Download size={14} />
            Import
          </button>
          <button
            className={`mcp-tab ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            <Plus size={14} />
            Add Manual
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mcp-modal-message ${message.type}`}>
            {message.type === 'success' && <Check size={14} />}
            {message.type === 'error' && <X size={14} />}
            {message.type === 'warning' && <AlertTriangle size={14} />}
            {message.text}
          </div>
        )}

        {/* Loading */}
        {isLoading ? (
          <div className="mcp-loading">
            <RefreshCw size={20} className="animate-spin" />
            <span>Loading...</span>
          </div>
        ) : (
          <div className="mcp-tab-content">
            {/* Active MCPs Tab */}
            {activeTab === 'active' && (
              <div className="mcp-active-tab">
                <div className="mcp-section-header">
                  <span>Configured MCPs</span>
                  <div className="mcp-section-actions">
                    <button className="btn-icon-sm" onClick={loadData} title="Refresh">
                      <RefreshCw size={14} />
                    </button>
                    <button className="btn-icon-sm" onClick={handleOpenConfig} title="Edit config file">
                      <FileEdit size={14} />
                    </button>
                  </div>
                </div>

                {activeMcps.length === 0 ? (
                  <div className="mcp-empty-state">
                    <Server size={32} />
                    <p>No MCPs configured yet</p>
                    <p className="text-muted">Import from Desktop/Code or add manually</p>
                  </div>
                ) : (
                  <div className="mcp-list">
                    {activeMcps.map(mcp => (
                      <div
                        key={mcp.name}
                        className={`mcp-item ${mcp.config.disabled ? 'disabled' : ''}`}
                      >
                        <div className="mcp-item-main">
                          <Server
                            size={16}
                            style={{ color: mcp.config.disabled ? 'var(--text-muted)' : 'var(--accent)' }}
                          />
                          <div className="mcp-item-info">
                            <span className="mcp-item-name">{mcp.name}</span>
                            <span className="mcp-item-meta">
                              {mcp.importedFrom && `from ${mcp.importedFrom}`}
                              {mcp.config.disabled && ' (disabled)'}
                            </span>
                          </div>
                        </div>
                        <div className="mcp-item-actions">
                          <button
                            className={`btn-icon-sm ${mcp.config.disabled ? '' : 'active'}`}
                            onClick={() => handleToggleDisabled(mcp.name)}
                            title={mcp.config.disabled ? 'Enable' : 'Disable'}
                          >
                            {mcp.config.disabled ? <PowerOff size={14} /> : <Power size={14} />}
                          </button>
                          <button
                            className="btn-icon-sm danger"
                            onClick={() => handleRemove(mcp.name)}
                            title="Remove"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mcp-config-path">
                  <Info size={12} />
                  <span>{configPath}</span>
                </div>
              </div>
            )}

            {/* Import Tab */}
            {activeTab === 'import' && (
              <div className="mcp-import-tab">
                {/* Desktop Section */}
                <div className="mcp-import-section">
                  <div className="mcp-section-header">
                    <span>Claude Desktop ({Object.keys(desktopMcps).length})</span>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleImportAll('desktop')}
                      disabled={Object.keys(desktopMcps).length === 0}
                    >
                      Import All
                    </button>
                  </div>

                  {Object.keys(desktopMcps).length === 0 ? (
                    <div className="mcp-empty-small">No MCPs in Desktop config</div>
                  ) : (
                    <div className="mcp-import-list">
                      {Object.entries(desktopMcps).map(([name, config]) => {
                        const imported = isAlreadyImported(name);
                        return (
                          <div key={name} className={`mcp-import-item ${imported ? 'imported' : ''}`}>
                            <div className="mcp-import-item-info">
                              <Server size={14} />
                              <span>{name}</span>
                              {imported && <span className="mcp-badge">imported</span>}
                            </div>
                            <button
                              className="btn-icon-sm"
                              onClick={() => handleImportSingle(name, 'desktop')}
                              disabled={imported}
                              title={imported ? 'Already imported' : 'Import'}
                            >
                              <Download size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Code Section */}
                <div className="mcp-import-section">
                  <div className="mcp-section-header">
                    <span>Claude Code ({Object.keys(codeMcps).length})</span>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleImportAll('code')}
                      disabled={Object.keys(codeMcps).length === 0}
                    >
                      Import All
                    </button>
                  </div>

                  {Object.keys(codeMcps).length === 0 ? (
                    <div className="mcp-empty-small">No MCPs in Code config</div>
                  ) : (
                    <div className="mcp-import-list">
                      {Object.entries(codeMcps).map(([name, config]) => {
                        const imported = isAlreadyImported(name);
                        return (
                          <div key={name} className={`mcp-import-item ${imported ? 'imported' : ''}`}>
                            <div className="mcp-import-item-info">
                              <Server size={14} />
                              <span>{name}</span>
                              {imported && <span className="mcp-badge">imported</span>}
                            </div>
                            <button
                              className="btn-icon-sm"
                              onClick={() => handleImportSingle(name, 'code')}
                              disabled={imported}
                              title={imported ? 'Already imported' : 'Import'}
                            >
                              <Download size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mcp-import-note">
                  <AlertTriangle size={14} />
                  <span>
                    Import copies the MCP configuration. The original in Desktop/Code is NOT removed.
                    If you want to clean up duplicates, you must manually remove them from the original location.
                  </span>
                </div>
              </div>
            )}

            {/* Add Manual Tab */}
            {activeTab === 'add' && (
              <div className="mcp-add-tab">
                <div className="mcp-section-header">
                  <span>Add MCP from JSON</span>
                </div>

                <div className="mcp-manual-form">
                  <label className="mcp-manual-label">
                    MCP Server Configuration (JSON)
                  </label>
                  <textarea
                    className="mcp-manual-textarea"
                    value={manualJson}
                    onChange={(e) => {
                      setManualJson(e.target.value);
                      if (jsonError) setJsonError(null);
                    }}
                    onBlur={() => {
                      if (manualJson.trim()) {
                        parseManualJson(manualJson);
                      }
                    }}
                    placeholder={`Example:
{
  "my-mcp": {
    "command": "npx",
    "args": ["-y", "@my-org/mcp-server"]
  }
}

Or with mcpServers wrapper:
{
  "mcpServers": {
    "my-mcp": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "mcp/server"]
    }
  }
}`}
                    rows={12}
                  />

                  {jsonError && (
                    <div className="mcp-manual-error">
                      <X size={14} />
                      {jsonError}
                    </div>
                  )}

                  <div className="mcp-manual-actions">
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setManualJson('');
                        setJsonError(null);
                      }}
                    >
                      Clear
                    </button>
                    <button
                      className="btn-primary"
                      onClick={handleAddManual}
                      disabled={!manualJson.trim() || !!jsonError}
                    >
                      Add MCP
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
