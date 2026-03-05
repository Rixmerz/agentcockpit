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
  Info,
  Settings,
  GitBranch,
  Database,
  Loader2,
  ExternalLink,
  Network
} from 'lucide-react';
import {
  loadMcpConfig,
  loadDesktopMcps,
  loadCodeMcps,
  loadGeminiMcps,
  addMcp,
  removeMcp,
  toggleMcpDisabled,
  importFromDesktop,
  importFromCode,
  importFromGemini,
  importAllFromDesktop,
  importAllFromCode,
  importAllFromGemini,
  openConfigInEditor,
  getConfigFilePath,
  isWorkflowManagerInstalled,
  installWorkflowManagerMcp,
  uninstallWorkflowManagerMcp,
  getAgentcockpitPath,
  setAgentcockpitPath,
  getProxyMcps,
  openFileInEditor,
  getWorkflowManagerSourcePath,
  type ManagedMcp,
  type McpServerConfig
} from '../../services/mcpConfigService';
import {
  isDeltaCodeCubeInstalled,
  installDeltaCodeCubeMcp,
  uninstallDeltaCodeCubeMcp,
} from '../../services/deltacodecubeService';
interface McpManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMcpsChanged?: () => void;
}

type TabType = 'active' | 'import' | 'add' | 'settings';

export function McpManagerModal({ isOpen, onClose, onMcpsChanged }: McpManagerModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [activeMcps, setActiveMcps] = useState<ManagedMcp[]>([]);
  const [desktopMcps, setDesktopMcps] = useState<Record<string, McpServerConfig>>({});
  const [codeMcps, setCodeMcps] = useState<Record<string, McpServerConfig>>({});
  const [geminiMcps, setGeminiMcps] = useState<Record<string, McpServerConfig>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [configPath, setConfigPath] = useState<string>('');

  // Manual add state
  const [manualJson, setManualJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Workflow Manager state
  const [workflowManagerInstalled, setWorkflowManagerInstalled] = useState(false);
  const [workflowManagerLoading, setWorkflowManagerLoading] = useState(false);
  const [agentcockpitPath, setAgentcockpitPathState] = useState<string>('');
  const [showPathInput, setShowPathInput] = useState(false);

  // DeltaCodeCube state
  const [dccInstalled, setDccInstalled] = useState(false);
  const [dccLoading, setDccLoading] = useState(false);

  // Proxy MCPs state
  const [proxyMcps, setProxyMcps] = useState<ManagedMcp[]>([]);
  const [proxySourcePath, setProxySourcePath] = useState<string | null>(null);

  // Show temporary message
  const showMessage = useCallback((type: 'success' | 'error' | 'warning', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  // Load all data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [config, desktop, code, gemini, path, workflowInstalled, acPath, dccInstalledResult, proxy, wmSourcePath] = await Promise.all([
        loadMcpConfig(),
        loadDesktopMcps(),
        loadCodeMcps(),
        loadGeminiMcps(),
        getConfigFilePath(),
        isWorkflowManagerInstalled(),
        getAgentcockpitPath(),
        isDeltaCodeCubeInstalled(),
        getProxyMcps(),
        getWorkflowManagerSourcePath()
      ]);

      setActiveMcps(Object.values(config.mcpServers));
      setDesktopMcps(desktop);
      setCodeMcps(code);
      setGeminiMcps(gemini);
      setConfigPath(path);
      setWorkflowManagerInstalled(workflowInstalled);
      setAgentcockpitPathState(acPath || '');
      setDccInstalled(dccInstalledResult);
      setProxyMcps(proxy);
      setProxySourcePath(wmSourcePath);
    } catch (e) {
      console.error('[McpManager] Load error:', e);
      showMessage('error', `Error loading MCPs: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [showMessage]);

  // Handle install Workflow Manager (auto-detects path)
  const handleInstallWorkflowManager = useCallback(async (pathOverride?: string) => {
    setWorkflowManagerLoading(true);
    try {
      // First try to auto-detect path if not provided
      let pathToUse = pathOverride || agentcockpitPath;

      if (!pathToUse) {
        // Try auto-detection
        const detected = await getAgentcockpitPath();
        if (detected) {
          pathToUse = detected;
          setAgentcockpitPathState(detected);
        }
      }

      // If still no path, show manual input
      if (!pathToUse) {
        setShowPathInput(true);
        setWorkflowManagerLoading(false);
        return;
      }

      const result = await installWorkflowManagerMcp(pathToUse);
      if (result.success) {
        showMessage('success', result.message);
        setWorkflowManagerInstalled(true);
        setShowPathInput(false);
        loadData();
        onMcpsChanged?.();
      } else {
        // If failed because path not found, show input
        if (result.message.includes('not found') || result.message.includes('not configured')) {
          setShowPathInput(true);
        }
        showMessage('error', result.message);
      }
    } finally {
      setWorkflowManagerLoading(false);
    }
  }, [agentcockpitPath, showMessage, loadData, onMcpsChanged]);

  // Handle save AgentCockpit path (manual fallback)
  const handleSaveAgentcockpitPath = useCallback(async () => {
    if (!agentcockpitPath.trim()) {
      showMessage('error', 'Please enter a valid path');
      return;
    }

    const saved = await setAgentcockpitPath(agentcockpitPath.trim());
    if (saved) {
      handleInstallWorkflowManager(agentcockpitPath.trim());
    } else {
      showMessage('error', 'Failed to save path');
    }
  }, [agentcockpitPath, handleInstallWorkflowManager, showMessage]);

  // Handle uninstall Workflow Manager
  const handleUninstallWorkflowManager = useCallback(async () => {
    setWorkflowManagerLoading(true);
    try {
      const result = await uninstallWorkflowManagerMcp();
      if (result.success) {
        showMessage('success', result.message);
        setWorkflowManagerInstalled(false);
        loadData();
        onMcpsChanged?.();
      } else {
        showMessage('error', result.message);
      }
    } finally {
      setWorkflowManagerLoading(false);
    }
  }, [showMessage, loadData, onMcpsChanged]);

  // Handle install DeltaCodeCube
  const handleInstallDcc = useCallback(async () => {
    setDccLoading(true);
    try {
      const pathToUse = agentcockpitPath || (await getAgentcockpitPath()) || undefined;
      const result = await installDeltaCodeCubeMcp(pathToUse);
      if (result.success) {
        showMessage('success', result.message);
        setDccInstalled(true);
        loadData();
        onMcpsChanged?.();
      } else {
        showMessage('error', result.message);
      }
    } finally {
      setDccLoading(false);
    }
  }, [agentcockpitPath, showMessage, loadData, onMcpsChanged]);

  // Handle uninstall DeltaCodeCube
  const handleUninstallDcc = useCallback(async () => {
    setDccLoading(true);
    try {
      const result = await uninstallDeltaCodeCubeMcp();
      if (result.success) {
        showMessage('success', result.message);
        setDccInstalled(false);
        loadData();
        onMcpsChanged?.();
      } else {
        showMessage('error', result.message);
      }
    } finally {
      setDccLoading(false);
    }
  }, [showMessage, loadData, onMcpsChanged]);

  // Handle remove proxy MCP
  const handleRemoveProxyMcp = useCallback(async (name: string) => {
    const result = await removeMcp(name);
    if (result.success) {
      showMessage('success', `Removed proxy MCP "${name}"`);
      loadData();
      onMcpsChanged?.();
    } else {
      showMessage('error', result.message);
    }
  }, [loadData, showMessage, onMcpsChanged]);

  // Handle open proxy config source
  const handleOpenProxySource = useCallback(async () => {
    if (proxySourcePath) {
      const result = await openFileInEditor(proxySourcePath);
      if (result.success) {
        showMessage('success', result.message);
      } else {
        showMessage('error', result.message);
      }
    } else {
      showMessage('error', 'Could not determine workflow-manager source path');
    }
  }, [proxySourcePath, showMessage]);

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
  const handleImportSingle = useCallback(async (name: string, source: 'desktop' | 'code' | 'gemini') => {
    let result;
    if (source === 'desktop') {
      result = await importFromDesktop(name);
    } else if (source === 'code') {
      result = await importFromCode(name);
    } else {
      result = await importFromGemini(name);
    }

    if (result.success) {
      showMessage('success', result.message);
      loadData();
      onMcpsChanged?.();
    } else {
      showMessage('error', result.message);
    }
  }, [loadData, showMessage, onMcpsChanged]);

  // Handle import all
  const handleImportAll = useCallback(async (source: 'desktop' | 'code' | 'gemini') => {
    let result;
    if (source === 'desktop') {
      result = await importAllFromDesktop();
    } else if (source === 'code') {
      result = await importAllFromCode();
    } else {
      result = await importAllFromGemini();
    }

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
            This is your centralized MCP configuration. The workflow system reads from this config.
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
          <button
            className={`mcp-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={14} />
            Settings
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
                      {Object.entries(desktopMcps).map(([name, _config]) => {
                        const imported = isAlreadyImported(name);
                        return (
                          <div key={name} className={`mcp-import-item ${imported ? 'imported' : ''}`}>
                            <div className="mcp-import-item-info">
                              <Server size={14} />
                              <span>{name}</span>
                              {imported && <span className="mcp-badge">imported</span>}
                            </div>
                            <div className="mcp-import-item-actions">
                              {imported ? (
                                <button
                                  className="btn-icon-sm danger"
                                  onClick={() => handleRemove(name)}
                                  title="Remove from config"
                                >
                                  <X size={14} />
                                </button>
                              ) : (
                                <button
                                  className="btn-icon-sm"
                                  onClick={() => handleImportSingle(name, 'desktop')}
                                  title="Import"
                                >
                                  <Download size={14} />
                                </button>
                              )}
                            </div>
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
                      {Object.entries(codeMcps).map(([name, _config]) => {
                        const imported = isAlreadyImported(name);
                        return (
                          <div key={name} className={`mcp-import-item ${imported ? 'imported' : ''}`}>
                            <div className="mcp-import-item-info">
                              <Server size={14} />
                              <span>{name}</span>
                              {imported && <span className="mcp-badge">imported</span>}
                            </div>
                            <div className="mcp-import-item-actions">
                              {imported ? (
                                <button
                                  className="btn-icon-sm danger"
                                  onClick={() => handleRemove(name)}
                                  title="Remove from config"
                                >
                                  <X size={14} />
                                </button>
                              ) : (
                                <button
                                  className="btn-icon-sm"
                                  onClick={() => handleImportSingle(name, 'code')}
                                  title="Import"
                                >
                                  <Download size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Gemini Section */}
                <div className="mcp-import-section">
                  <div className="mcp-section-header">
                    <span>Gemini CLI ({Object.keys(geminiMcps).length})</span>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => handleImportAll('gemini')}
                      disabled={Object.keys(geminiMcps).length === 0}
                    >
                      Import All
                    </button>
                  </div>

                  {Object.keys(geminiMcps).length === 0 ? (
                    <div className="mcp-empty-small">No MCPs in Gemini config</div>
                  ) : (
                    <div className="mcp-import-list">
                      {Object.entries(geminiMcps).map(([name, _config]) => {
                        const imported = isAlreadyImported(name);
                        return (
                          <div key={name} className={`mcp-import-item ${imported ? 'imported' : ''}`}>
                            <div className="mcp-import-item-info">
                              <Server size={14} />
                              <span>{name}</span>
                              {imported && <span className="mcp-badge">imported</span>}
                            </div>
                            <div className="mcp-import-item-actions">
                              {imported ? (
                                <button
                                  className="btn-icon-sm danger"
                                  onClick={() => handleRemove(name)}
                                  title="Remove from config"
                                >
                                  <X size={14} />
                                </button>
                              ) : (
                                <button
                                  className="btn-icon-sm"
                                  onClick={() => handleImportSingle(name, 'gemini')}
                                  title="Import"
                                >
                                  <Download size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mcp-import-note">
                  <AlertTriangle size={14} />
                  <span>
                    Import copies the MCP configuration. The original config is NOT removed.
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

            {/* Settings Tab */}
            {activeTab === 'settings' && (
              <div className="mcp-settings-tab">
                <div className="mcp-section-header">
                  <span>Plugin Settings</span>
                </div>

                {/* Workflow Manager Section */}
                <div className="mcp-section-header" style={{ marginTop: '1.5rem' }}>
                  <span>Workflow Manager MCP</span>
                </div>

                <div className="mcp-workflow-section">
                  <div className="mcp-workflow-info">
                    <GitBranch size={20} style={{ color: workflowManagerInstalled ? 'var(--accent)' : 'var(--text-muted)' }} />
                    <div className="mcp-workflow-details">
                      <span className="mcp-workflow-title">Workflow Manager</span>
                      <span className="mcp-workflow-description">
                        Required for workflow flow control. Manages step-based workflows
                        with gates, MCP restrictions, and automatic advancement.
                      </span>
                      <span className={`mcp-workflow-status ${workflowManagerInstalled ? 'installed' : 'not-installed'}`}>
                        {workflowManagerInstalled ? (
                          <><Check size={12} /> Installed</>
                        ) : (
                          <><AlertTriangle size={12} /> Not installed</>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="mcp-workflow-actions">
                    {workflowManagerInstalled ? (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={handleUninstallWorkflowManager}
                        disabled={workflowManagerLoading}
                      >
                        {workflowManagerLoading ? (
                          <><Loader2 size={14} className="animate-spin" /> Removing...</>
                        ) : (
                          <><Trash2 size={14} /> Uninstall</>
                        )}
                      </button>
                    ) : (
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => handleInstallWorkflowManager()}
                        disabled={workflowManagerLoading}
                      >
                        {workflowManagerLoading ? (
                          <><Loader2 size={14} className="animate-spin" /> Installing...</>
                        ) : (
                          <><Download size={14} /> Install</>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Path configuration input */}
                {showPathInput && !workflowManagerInstalled && (
                  <div className="mcp-path-config" style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      AgentCockpit project path (where .workflow-manager is located):
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        value={agentcockpitPath}
                        onChange={(e) => setAgentcockpitPathState(e.target.value)}
                        placeholder="/path/to/agentcockpit"
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '4px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-primary)',
                          color: 'var(--text-primary)'
                        }}
                      />
                      <button
                        className="btn-primary btn-sm"
                        onClick={handleSaveAgentcockpitPath}
                        disabled={workflowManagerLoading || !agentcockpitPath.trim()}
                      >
                        {workflowManagerLoading ? <Loader2 size={14} className="animate-spin" /> : 'Save & Install'}
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => setShowPathInput(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* DeltaCodeCube Section */}
                <div className="mcp-section-header" style={{ marginTop: '1.5rem' }}>
                  <span>DeltaCodeCube MCP</span>
                </div>

                <div className="mcp-workflow-section">
                  <div className="mcp-workflow-info">
                    <Database size={20} style={{ color: dccInstalled ? 'var(--accent)' : 'var(--text-muted)' }} />
                    <div className="mcp-workflow-details">
                      <span className="mcp-workflow-title">DeltaCodeCube</span>
                      <span className="mcp-workflow-description">
                        Multi-dimensional code indexing for similarity search, impact analysis,
                        tension detection, and technical debt scoring (grades A-F).
                      </span>
                      <span className={`mcp-workflow-status ${dccInstalled ? 'installed' : 'not-installed'}`}>
                        {dccInstalled ? (
                          <><Check size={12} /> Installed</>
                        ) : (
                          <><AlertTriangle size={12} /> Not installed</>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="mcp-workflow-actions">
                    {dccInstalled ? (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={handleUninstallDcc}
                        disabled={dccLoading}
                      >
                        {dccLoading ? (
                          <><Loader2 size={14} className="animate-spin" /> Removing...</>
                        ) : (
                          <><Trash2 size={14} /> Uninstall</>
                        )}
                      </button>
                    ) : (
                      <button
                        className="btn-primary btn-sm"
                        onClick={handleInstallDcc}
                        disabled={dccLoading}
                      >
                        {dccLoading ? (
                          <><Loader2 size={14} className="animate-spin" /> Installing...</>
                        ) : (
                          <><Download size={14} /> Install</>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Proxy MCPs Section */}
                {workflowManagerInstalled && (
                  <>
                    <div className="mcp-section-header" style={{ marginTop: '1.5rem' }}>
                      <span>Proxy MCPs (execute_mcp_tool)</span>
                      <div className="mcp-section-actions">
                        <button
                          className="btn-icon-sm"
                          onClick={handleOpenProxySource}
                          title="Open proxy source code"
                        >
                          <ExternalLink size={14} />
                        </button>
                        <button
                          className="btn-icon-sm"
                          onClick={handleOpenConfig}
                          title="Edit mcps.json config"
                        >
                          <FileEdit size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="mcp-workflow-section" style={{ flexDirection: 'column', gap: '0.5rem' }}>
                      <span className="mcp-workflow-description" style={{ marginBottom: '0.25rem' }}>
                        MCPs accessible via workflow-manager's execute_mcp_tool proxy.
                        Remove deprecated or unused MCPs here.
                      </span>

                      {proxyMcps.length === 0 ? (
                        <div className="mcp-empty-small">
                          No proxy MCPs configured. Import MCPs in the Active tab to make them available.
                        </div>
                      ) : (
                        <div className="mcp-list">
                          {proxyMcps.map(mcp => (
                            <div
                              key={mcp.name}
                              className={`mcp-item ${mcp.config.disabled ? 'disabled' : ''}`}
                            >
                              <div className="mcp-item-main">
                                <Network
                                  size={16}
                                  style={{ color: mcp.config.disabled ? 'var(--text-muted)' : 'var(--accent)' }}
                                />
                                <div className="mcp-item-info">
                                  <span className="mcp-item-name">{mcp.name}</span>
                                  <span className="mcp-item-meta">
                                    {mcp.config.command && `${mcp.config.command} ${(mcp.config.args || []).slice(0, 2).join(' ')}...`}
                                    {mcp.config.disabled && ' (disabled)'}
                                  </span>
                                </div>
                              </div>
                              <div className="mcp-item-actions">
                                <button
                                  className="btn-icon-sm danger"
                                  onClick={() => handleRemoveProxyMcp(mcp.name)}
                                  title={`Remove "${mcp.name}" from proxy`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div className="mcp-settings-note">
                  <Info size={14} />
                  <span>
                    Settings are stored in ~/.agentcockpit/plugins.json
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
