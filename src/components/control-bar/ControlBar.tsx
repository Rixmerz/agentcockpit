/**
 * ControlBar - Main top bar with dropdown controls
 * Contains: Workflow, MCPs, Ports, Git
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Workflow,
  Server,
  Globe,
  GitBranch,
  RefreshCw,
  Check,
  AlertCircle,
  X,
  ArrowUp,
  ArrowDown,
  Camera,
  RotateCcw,
  Loader2,
  Download,
  Trash2,
  Settings,
  Database,
  Puzzle,
} from 'lucide-react';
import { DropdownPanel, DropdownItem, DropdownSection } from './DropdownPanel';
import { Modal } from '../common/Modal';
import { GitSettings } from '../sidebar-right/GitSettings';

// Import services
import { workflowService, copyAllAssetsToProject } from '../../services/workflowService';
import { loadMcpConfig } from '../../services/mcpConfigService';
import {
  isWorkflowHooksInstalled,
  installWorkflowHooks,
  uninstallWorkflowHooks,
} from '../../services/hookService';
import { McpManagerModal } from '../mcp/McpManagerModal';
import { gitPush, type SyncStatus } from '../../services/gitService';
import { useGitWatcherEvent } from '../../core/utils/gitWatcherEventBus';
import { gitWatcherService } from '../../services/gitWatcherService';
import {
  getHistory,
  restoreSnapshot,
  getCurrentVersion,
  type HistoryItem,
} from '../../services/snapshotService';
import { useSnapshotEvent, snapshotEvents } from '../../core/utils/eventBus';
import { useIndexEvent } from '../../core/utils/indexEventBus';
import {
  isDeltaCodeCubeInstalled,
  getIndexStats,
  reindexProject,
  type IndexStats,
} from '../../services/deltacodecubeService';
import {
  getLspStatus,
  detectProjectLsps,
  installLsp,
  uninstallLsp,
  autoSetupLsps,
  type LspStatus,
  type LspDetection,
} from '../../services/lspService';

// Helper function for relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

interface ControlBarProps {
  projectPath: string | null;
  onWorkflowChange?: (workflowName: string | null) => void;
}

interface WorkflowInfo {
  name: string;
  currentNode: string | null;
  isActive: boolean;
}

interface McpStatus {
  name: string;
  connected: boolean;
}

interface PortInfo {
  port: number;
  process: string;
  pid?: number;
}

interface GitInfo {
  branch: string | null;
  hasChanges: boolean;
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
  syncStatus: SyncStatus | null;
  hasRepo: boolean;
}

// Common dev ports to check
const PORTS_TO_CHECK = [
  1420, 3000, 3001, 3002, 3003, 4000, 4173, 5000, 5173, 5174,
  8000, 8080, 8888, 5432, 6379, 27017
];

export function ControlBar({ projectPath, onWorkflowChange }: ControlBarProps) {
  // Workflow state
  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowInfo | null>(null);
  const [, setWorkflowLoading] = useState(false);
  const [isWorkflowInstalled, setIsWorkflowInstalled] = useState(false);
  const [isInstallingWorkflow, setIsInstallingWorkflow] = useState(false);

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpStatus[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [showMcpManager, setShowMcpManager] = useState(false);

  // Port state
  const [activePorts, setActivePorts] = useState<PortInfo[]>([]);
  const [portsLoading, setPortsLoading] = useState(false);

  // Git state
  const [gitInfo, setGitInfo] = useState<GitInfo>({
    branch: null,
    hasChanges: false,
    modifiedCount: 0,
    stagedCount: 0,
    untrackedCount: 0,
    syncStatus: null,
    hasRepo: false,
  });
  const [isPushing, setIsPushing] = useState(false);
  const [showGitSettings, setShowGitSettings] = useState(false);

  // Snapshot state
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState<number | null>(null);

  // Index state (DeltaCodeCube) — with per-project cache
  const [dccInstalled, setDccInstalled] = useState(false);
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const indexCacheRef = useRef<Map<string, IndexStats>>(new Map());

  // LSP state
  const [lspStatuses, setLspStatuses] = useState<LspStatus[]>([]);
  const [lspDetection, setLspDetection] = useState<LspDetection | null>(null);
  const [lspInstalling, setLspInstalling] = useState<string | null>(null);

  // Check DCC install only (lazy — stats loaded on-demand via dropdown)
  useEffect(() => {
    if (!projectPath) {
      setDccInstalled(false);
      setIndexStats(null);
      setIndexError(null);
      return;
    }
    setIndexError(null);
    const delay = setTimeout(() => {
      isDeltaCodeCubeInstalled().then(setDccInstalled).catch(() => setDccInstalled(false));
    }, 3000);
    return () => clearTimeout(delay);
  }, [projectPath]);

  // Listen for index events — update stats when indexing completes
  useIndexEvent('indexed', (data) => {
    if (data.projectPath === projectPath && dccInstalled) {
      getIndexStats(projectPath).then(stats => {
        if (stats) {
          setIndexStats(stats);
          indexCacheRef.current.set(projectPath, stats);
        }
      }).catch(() => {});
    }
  }, [projectPath, dccInstalled]);

  // Load index info on-demand (when dropdown opens)
  const loadIndexInfo = useCallback(async () => {
    if (!projectPath) return;
    try {
      const installed = await isDeltaCodeCubeInstalled();
      setDccInstalled(installed);
      if (installed) {
        const stats = await getIndexStats(projectPath);
        if (stats) {
          setIndexStats(stats);
          indexCacheRef.current.set(projectPath, stats);
        }
      }
    } catch (err) {
      console.warn('[ControlBar] Failed to load index info:', err);
    }
  }, [projectPath]);

  // Handle reindex (explicit user action — starts DCC server if needed)
  const handleReindex = useCallback(async () => {
    if (!projectPath) return;
    setIndexLoading(true);
    setIndexError(null);
    try {
      const stats = await reindexProject(projectPath);
      if (stats) {
        setIndexStats(stats);
        indexCacheRef.current.set(projectPath, stats);
      } else {
        setIndexError('Indexing returned no results');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ControlBar] Reindex failed:', msg);
      setIndexError(msg);
    } finally {
      setIndexLoading(false);
    }
  }, [projectPath]);

  // Auto-setup LSPs on project change: detect → install → enable → refresh
  useEffect(() => {
    if (!projectPath) {
      setLspStatuses([]);
      setLspDetection(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Run auto-setup (installs missing binaries + registers + enables plugins)
        const result = await autoSetupLsps(projectPath);
        if (cancelled) return;
        if (result.actions.length > 0) {
          console.log('[ControlBar] LSP auto-setup:', result.actions);
        }
        // Refresh statuses after setup
        const [statuses, detection] = await Promise.all([
          getLspStatus(),
          detectProjectLsps(projectPath),
        ]);
        if (cancelled) return;
        setLspStatuses(statuses);
        setLspDetection(detection);
      } catch (err) {
        if (cancelled) return;
        console.warn('[ControlBar] LSP auto-setup failed:', err);
        // Fallback to just detection
        detectProjectLsps(projectPath).then(setLspDetection).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  // Load LSP info on-demand (when dropdown opens)
  const loadLspInfo = useCallback(async () => {
    try {
      const statuses = await getLspStatus();
      setLspStatuses(statuses);
      if (projectPath) {
        const detection = await detectProjectLsps(projectPath);
        setLspDetection(detection);
      }
    } catch (err) {
      console.warn('[ControlBar] Failed to load LSP info:', err);
    }
  }, [projectPath]);

  // Handle LSP install
  const handleInstallLsp = useCallback(async (plugin: string) => {
    setLspInstalling(plugin);
    try {
      await installLsp(plugin);
      await loadLspInfo();
    } catch (err) {
      console.error('[ControlBar] Failed to install LSP:', err);
    } finally {
      setLspInstalling(null);
    }
  }, [loadLspInfo]);

  // Handle LSP uninstall
  const handleUninstallLsp = useCallback(async (plugin: string) => {
    setLspInstalling(plugin);
    try {
      await uninstallLsp(plugin);
      await loadLspInfo();
    } catch (err) {
      console.error('[ControlBar] Failed to uninstall LSP:', err);
    } finally {
      setLspInstalling(null);
    }
  }, [loadLspInfo]);

  // Handle install all missing LSPs
  const handleInstallAllMissing = useCallback(async () => {
    if (!lspDetection?.missing.length) return;
    for (const plugin of lspDetection.missing) {
      setLspInstalling(plugin);
      try {
        await installLsp(plugin);
      } catch (err) {
        console.error(`[ControlBar] Failed to install ${plugin}:`, err);
      }
    }
    setLspInstalling(null);
    await loadLspInfo();
  }, [lspDetection, loadLspInfo]);

  // Load workflows
  useEffect(() => {
    if (!projectPath) {
      setAvailableWorkflows([]);
      setActiveWorkflow(null);
      setIsWorkflowInstalled(false);
      return;
    }

    setActiveWorkflow(null);

    const loadWorkflows = async () => {
      try {
        const workflows = await workflowService.listAvailableWorkflows(projectPath);
        setAvailableWorkflows(workflows);

        const status = await workflowService.getStatus(projectPath);
        if (status) {
          setActiveWorkflow({
            name: status.graphName || 'Unknown',
            currentNode: status.currentNode,
            isActive: true,
          });
        }

        const installed = await isWorkflowHooksInstalled(projectPath);
        setIsWorkflowInstalled(installed);
      } catch (err) {
        console.warn('[ControlBar] Failed to load workflows:', err);
      }
    };

    loadWorkflows();
  }, [projectPath]);

  // Load MCPs
  const loadMcps = useCallback(async () => {
    setMcpLoading(true);
    try {
      const config = await loadMcpConfig();
      const servers: McpStatus[] = Object.keys(config.mcpServers || {}).map(name => ({
        name,
        connected: false, // Would need to check actual connection status
      }));
      setMcpServers(servers);
    } catch (err) {
      console.warn('[ControlBar] Failed to load MCPs:', err);
    } finally {
      setMcpLoading(false);
    }
  }, []);

  // Load MCPs on mount
  useEffect(() => {
    loadMcps();
  }, [loadMcps]);

  // Load Ports
  const loadPorts = useCallback(async () => {
    setPortsLoading(true);
    const portInfos: PortInfo[] = [];

    const checkPort = async (port: number): Promise<PortInfo | null> => {
      try {
        const result = await invoke<string>('execute_command', {
          cmd: `lsof -ti:${port} 2>/dev/null`,
          cwd: '/',
        });

        if (result.trim()) {
          const pid = parseInt(result.trim().split('\n')[0], 10);
          let processName = 'Unknown';
          try {
            const processResult = await invoke<string>('execute_command', {
              cmd: `ps -p ${pid} -o comm= 2>/dev/null`,
              cwd: '/',
            });
            processName = processResult.trim() || 'Unknown';
          } catch {
            // Ignore
          }
          return { port, process: processName, pid };
        }
        return null;
      } catch {
        return null;
      }
    };

    try {
      const results = await Promise.all(PORTS_TO_CHECK.map(checkPort));
      results.forEach(info => {
        if (info) portInfos.push(info);
      });
      portInfos.sort((a, b) => a.port - b.port);
      setActivePorts(portInfos);
    } catch (error) {
      console.warn('[ControlBar] Error checking ports:', error);
    } finally {
      setPortsLoading(false);
    }
  }, []);

  // Kill port (optimistic UI)
  const handleKillPort = useCallback(async (port: number) => {
    // Optimistic: remove from UI immediately
    setActivePorts(prev => prev.filter(p => p.port !== port));
    // Kill in background
    try {
      const result = await invoke<string>('execute_command', {
        cmd: `lsof -ti:${port} 2>/dev/null`,
        cwd: '/',
      });
      const pid = result.trim().split('\n')[0];
      if (pid) {
        await invoke<string>('execute_command', {
          cmd: `kill -9 ${pid} 2>/dev/null || true`,
          cwd: '/',
        });
      }
    } catch (error) {
      console.warn(`[ControlBar] Error killing port ${port}:`, error);
    }
    // Delayed refresh to catch respawned processes
    setTimeout(loadPorts, 2000);
  }, [loadPorts]);

  // Open port in browser
  const handleOpenPort = useCallback((port: number) => {
    window.open(`http://localhost:${port}`, '_blank');
  }, []);

  // Subscribe to git watcher status events
  useGitWatcherEvent('status', (data) => {
    if (data.projectPath !== projectPath) return;
    setGitInfo({
      branch: data.branch,
      hasChanges: data.hasChanges,
      modifiedCount: data.modifiedFiles.length,
      stagedCount: data.stagedFiles.length,
      untrackedCount: data.untrackedFiles.length,
      syncStatus: data.syncStatus,
      hasRepo: data.hasRepo,
    });
  }, [projectPath]);

  // Handle git push
  const handlePush = useCallback(async () => {
    if (!projectPath) return;
    setIsPushing(true);
    try {
      await gitPush(projectPath);
      gitWatcherService.pollNow();
    } catch (error) {
      console.error('[ControlBar] Push failed:', error);
    } finally {
      setIsPushing(false);
    }
  }, [projectPath]);

  // Load snapshots
  const loadSnapshots = useCallback(async () => {
    if (!projectPath) {
      setHistoryItems([]);
      setCurrentVersion(null);
      return;
    }

    setSnapshotLoading(true);
    try {
      const [history, current] = await Promise.all([
        getHistory(projectPath, 20),
        getCurrentVersion(projectPath),
      ]);
      setHistoryItems(history.filter(i => i.type === 'snapshot'));
      setCurrentVersion(current);
    } catch (err) {
      console.warn('[ControlBar] Failed to load snapshots:', err);
    } finally {
      setSnapshotLoading(false);
    }
  }, [projectPath]);

  // Handle snapshot restore
  const handleRestoreSnapshot = useCallback(async (item: HistoryItem) => {
    if (!projectPath || item.type !== 'snapshot' || !item.version) return;
    if (item.version === currentVersion) return;

    setIsRestoring(item.version);
    try {
      await restoreSnapshot(projectPath, item.version, true);
      snapshotEvents.emit('restored', {
        version: item.version,
        projectPath,
      });
      setCurrentVersion(item.version);
    } catch (err) {
      console.error('[ControlBar] Failed to restore snapshot:', err);
    } finally {
      setIsRestoring(null);
    }
  }, [projectPath, currentVersion]);

  // Listen for snapshot events
  useSnapshotEvent('created', (data) => {
    if (data.projectPath === projectPath) {
      setTimeout(() => loadSnapshots(), 500);
    }
  }, [projectPath, loadSnapshots]);

  useSnapshotEvent('restored', (data) => {
    if (data.projectPath === projectPath) {
      setCurrentVersion(data.version);
      loadSnapshots();
    }
  }, [projectPath, loadSnapshots]);

  useSnapshotEvent('cleanup', (data) => {
    if (data.projectPath === projectPath) {
      loadSnapshots();
    }
  }, [projectPath, loadSnapshots]);

  // Ports: on-demand only (loaded when dropdown opens)

  // Load snapshots on mount
  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // Handle workflow selection
  const handleSelectWorkflow = useCallback(async (workflowName: string) => {
    if (!projectPath) return;

    setWorkflowLoading(true);
    try {
      await workflowService.activateWorkflow(projectPath, workflowName);
      const status = await workflowService.getStatus(projectPath);
      setActiveWorkflow({
        name: workflowName,
        currentNode: status?.currentNode || null,
        isActive: true,
      });
      onWorkflowChange?.(workflowName);
    } catch (err) {
      console.error('[ControlBar] Failed to activate workflow:', err);
    } finally {
      setWorkflowLoading(false);
    }
  }, [projectPath, onWorkflowChange]);

  // Handle workflow reset
  const handleResetWorkflow = useCallback(async () => {
    if (!projectPath) return;

    try {
      await workflowService.resetWorkflow(projectPath);
      const status = await workflowService.getStatus(projectPath);
      if (activeWorkflow) {
        setActiveWorkflow({
          ...activeWorkflow,
          currentNode: status?.currentNode || null,
        });
      }
    } catch (err) {
      console.error('[ControlBar] Failed to reset workflow:', err);
    }
  }, [projectPath, activeWorkflow]);

  // Handle workflow install
  const handleInstallWorkflow = useCallback(async () => {
    if (!projectPath) return;

    setIsInstallingWorkflow(true);
    try {
      const result = await installWorkflowHooks(projectPath, []);
      if (result.success) {
        // Copy all assets to project
        await copyAllAssetsToProject(projectPath);
        setIsWorkflowInstalled(true);
      } else {
        console.error('[ControlBar] Install failed:', result.error);
      }
    } catch (err) {
      console.error('[ControlBar] Failed to install workflow:', err);
    } finally {
      setIsInstallingWorkflow(false);
    }
  }, [projectPath]);

  // Handle workflow uninstall
  const handleUninstallWorkflow = useCallback(async () => {
    if (!projectPath) return;

    setIsInstallingWorkflow(true);
    try {
      const result = await uninstallWorkflowHooks(projectPath);
      if (result.success) {
        setIsWorkflowInstalled(false);
      } else {
        console.error('[ControlBar] Uninstall failed:', result.error);
      }
    } catch (err) {
      console.error('[ControlBar] Failed to uninstall workflow:', err);
    } finally {
      setIsInstallingWorkflow(false);
    }
  }, [projectPath]);

  return (
    <div className="control-bar">
      <div className="control-bar__section control-bar__section--left">
        {/* Workflow Dropdown */}
        <DropdownPanel
          trigger={activeWorkflow?.name || 'Workflow'}
          triggerIcon={<Workflow size={12} />}
          label="Workflow"
          statusDot={activeWorkflow?.isActive ? 'active' : 'none'}
          width="wide"
        >
          <DropdownSection title="Available Workflows">
            {availableWorkflows.length === 0 ? (
              <div className="dropdown__empty">No workflows found</div>
            ) : (
              availableWorkflows.map(name => (
                <DropdownItem
                  key={name}
                  icon={<Workflow size={14} />}
                  label={name}
                  active={activeWorkflow?.name === name}
                  onClick={() => handleSelectWorkflow(name)}
                />
              ))
            )}
          </DropdownSection>

          {activeWorkflow && (
            <DropdownSection title="Actions">
              <DropdownItem
                icon={<RefreshCw size={14} />}
                label="Reset Workflow"
                description="Return to start node"
                onClick={handleResetWorkflow}
              />
            </DropdownSection>
          )}

          {projectPath && (
            <DropdownSection title="Installation">
              {!isWorkflowInstalled ? (
                <DropdownItem
                  icon={isInstallingWorkflow ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  label={isInstallingWorkflow ? "Installing..." : "Install Controller"}
                  description="Install workflow hooks to project"
                  onClick={handleInstallWorkflow}
                  disabled={isInstallingWorkflow}
                />
              ) : (
                <DropdownItem
                  icon={isInstallingWorkflow ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  label={isInstallingWorkflow ? "Removing..." : "Uninstall Controller"}
                  description="Remove workflow hooks from project"
                  onClick={handleUninstallWorkflow}
                  disabled={isInstallingWorkflow}
                />
              )}
            </DropdownSection>
          )}
        </DropdownPanel>

        {/* MCPs Dropdown */}
        <DropdownPanel
          trigger="MCPs"
          triggerIcon={<Server size={12} />}
          label="MCP Servers"
          badge={mcpServers.length || undefined}
          statusDot={mcpServers.length > 0 ? 'active' : 'none'}
          onOpen={loadMcps}
        >
          {mcpLoading ? (
            <div className="dropdown__empty">Loading...</div>
          ) : mcpServers.length === 0 ? (
            <div className="dropdown__empty">No MCP servers configured</div>
          ) : (
            <DropdownSection title={`Configured (${mcpServers.length})`}>
              {mcpServers.map(mcp => (
                <DropdownItem
                  key={mcp.name}
                  icon={<Server size={14} />}
                  label={mcp.name}
                />
              ))}
            </DropdownSection>
          )}
          <DropdownSection title="Actions">
            <DropdownItem
              icon={<Settings size={14} />}
              label="Manage MCPs"
              description="Add, remove, or configure servers"
              onClick={() => setShowMcpManager(true)}
            />
            <DropdownItem
              icon={<RefreshCw size={14} />}
              label="Refresh"
              onClick={loadMcps}
            />
          </DropdownSection>
        </DropdownPanel>

        {/* Ports Dropdown */}
        <DropdownPanel
          trigger="Ports"
          triggerIcon={<Globe size={12} />}
          label="Active Ports"
          badge={activePorts.length || undefined}
          statusDot={activePorts.length > 0 ? 'active' : 'none'}
          onOpen={loadPorts}
        >
          <DropdownSection title="Active Ports">
            {portsLoading ? (
              <div className="dropdown__empty">Scanning...</div>
            ) : activePorts.length === 0 ? (
              <div className="dropdown__empty">No active ports</div>
            ) : (
              activePorts.map(port => (
                <div key={port.port} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <DropdownItem
                    icon={<Globe size={14} />}
                    label={`:${port.port}`}
                    description={port.process}
                    onClick={() => handleOpenPort(port.port)}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleKillPort(port.port);
                    }}
                    title="Kill process"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--color-status-error)',
                      cursor: 'pointer',
                      padding: '4px',
                      opacity: 0.7,
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </DropdownSection>
          <DropdownSection>
            <DropdownItem
              icon={<RefreshCw size={14} />}
              label="Refresh Ports"
              onClick={loadPorts}
            />
          </DropdownSection>
        </DropdownPanel>

        <div className="control-bar__divider" />

        {/* Git Dropdown */}
        <DropdownPanel
          trigger={gitInfo.branch || 'Git'}
          triggerIcon={<GitBranch size={12} />}
          label="Git Status"
          badge={gitInfo.hasChanges ? (gitInfo.modifiedCount + gitInfo.stagedCount + gitInfo.untrackedCount) : undefined}
          statusDot={gitInfo.hasChanges ? 'warning' : gitInfo.hasRepo ? 'active' : 'none'}
        >
          {!gitInfo.hasRepo ? (
            <>
              <div className="dropdown__empty">No git repository</div>
              <DropdownSection title="Actions">
                <DropdownItem
                  icon={<Settings size={14} />}
                  label="Git Settings"
                  description="Initialize repo & configure remote"
                  onClick={() => setShowGitSettings(true)}
                />
              </DropdownSection>
            </>
          ) : (
            <>
              <DropdownSection title="Branch">
                <DropdownItem
                  icon={<GitBranch size={14} />}
                  label={gitInfo.branch || 'No branch'}
                  active
                />
              </DropdownSection>

              {gitInfo.hasChanges && (
                <DropdownSection title="Changes">
                  {gitInfo.stagedCount > 0 && (
                    <DropdownItem
                      icon={<Check size={14} />}
                      label={`${gitInfo.stagedCount} staged`}
                    />
                  )}
                  {gitInfo.modifiedCount > 0 && (
                    <DropdownItem
                      icon={<AlertCircle size={14} />}
                      label={`${gitInfo.modifiedCount} modified`}
                    />
                  )}
                  {gitInfo.untrackedCount > 0 && (
                    <DropdownItem
                      icon={<AlertCircle size={14} />}
                      label={`${gitInfo.untrackedCount} untracked`}
                    />
                  )}
                </DropdownSection>
              )}

              {gitInfo.syncStatus?.hasRemote && (
                <DropdownSection title="Sync">
                  {gitInfo.syncStatus.ahead === 0 && gitInfo.syncStatus.behind === 0 ? (
                    <DropdownItem
                      icon={<Check size={14} />}
                      label="Up to date"
                      description={gitInfo.syncStatus.remoteBranch || undefined}
                    />
                  ) : (
                    <>
                      {gitInfo.syncStatus.ahead > 0 && (
                        <DropdownItem
                          icon={<ArrowUp size={14} />}
                          label={`${gitInfo.syncStatus.ahead} to push`}
                          onClick={handlePush}
                          badge={isPushing ? '...' : 'Push'}
                        />
                      )}
                      {gitInfo.syncStatus.behind > 0 && (
                        <DropdownItem
                          icon={<ArrowDown size={14} />}
                          label={`${gitInfo.syncStatus.behind} to pull`}
                        />
                      )}
                    </>
                  )}
                </DropdownSection>
              )}

              <DropdownSection>
                <DropdownItem
                  icon={<Settings size={14} />}
                  label="Git Settings"
                  description="Remote URL, sync & config"
                  onClick={() => setShowGitSettings(true)}
                />
                <DropdownItem
                  icon={<RefreshCw size={14} />}
                  label="Refresh"
                  onClick={() => gitWatcherService.pollNow()}
                />
              </DropdownSection>
            </>
          )}
        </DropdownPanel>

        {/* Snapshots Dropdown */}
        <DropdownPanel
          trigger="Snaps"
          triggerIcon={<Camera size={12} />}
          label="Version Snapshots"
          badge={historyItems.length || undefined}
          statusDot={currentVersion ? 'active' : 'none'}
        >
          {snapshotLoading ? (
            <div className="dropdown__empty">Loading...</div>
          ) : historyItems.length === 0 ? (
            <div className="dropdown__empty">No snapshots</div>
          ) : (
            <DropdownSection title={`Snapshots (${historyItems.length})`}>
              {historyItems.map((item) => {
                const isCurrent = item.version === currentVersion;
                return (
                  <DropdownItem
                    key={item.commitHash}
                    icon={isRestoring === item.version ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : isCurrent ? (
                      <Check size={14} />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    label={`V${item.version}`}
                    description={formatRelativeTime(item.timestamp)}
                    active={isCurrent}
                    onClick={() => !isCurrent && handleRestoreSnapshot(item)}
                  />
                );
              })}
            </DropdownSection>
          )}
          <DropdownSection>
            <DropdownItem
              icon={<RefreshCw size={14} />}
              label="Refresh"
              onClick={loadSnapshots}
            />
          </DropdownSection>
        </DropdownPanel>

        {/* Index Dropdown (DeltaCodeCube) */}
        {dccInstalled && (
          <DropdownPanel
            trigger={indexError ? 'Index Error' : indexLoading ? 'Indexing...' : indexStats ? `Index ${indexStats.grade}` : 'Index'}
            triggerIcon={<Database size={12} />}
            label={`Codebase Index${projectPath ? ` — ${projectPath.split('/').pop()}` : ''}`}
            statusDot={indexError ? 'error' : indexStats ? 'active' : 'none'}
            onOpen={loadIndexInfo}
          >
            {indexStats ? (
              <>
                <DropdownSection title="Codebase Health">
                  <DropdownItem
                    icon={<Database size={14} />}
                    label={`Score: ${indexStats.codebaseScore}`}
                    description={`Grade ${indexStats.grade} - ${indexStats.totalFiles} files | ${projectPath?.split('/').pop() || ''}`}
                  />
                </DropdownSection>

                <DropdownSection title="Distribution">
                  {Object.entries(indexStats.distribution).map(([grade, count]) => (
                    count > 0 && (
                      <DropdownItem
                        key={grade}
                        icon={<Check size={14} />}
                        label={`Grade ${grade}`}
                        badge={String(count)}
                      />
                    )
                  ))}
                </DropdownSection>

                <DropdownSection title="Actions">
                  <DropdownItem
                    icon={indexLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    label={indexLoading ? 'Reindexing...' : 'Reindex'}
                    description="Re-scan project files"
                    onClick={handleReindex}
                    disabled={indexLoading}
                  />
                </DropdownSection>
              </>
            ) : (
              <>
                <div className="dropdown__empty">No index data for {projectPath?.split('/').pop() || 'project'}</div>
                {indexError && (
                  <DropdownSection title="Error">
                    <DropdownItem
                      icon={<AlertCircle size={14} />}
                      label="Index failed"
                      description={indexError.length > 80 ? indexError.slice(0, 80) + '...' : indexError}
                    />
                  </DropdownSection>
                )}
                <DropdownSection title="Actions">
                  <DropdownItem
                    icon={indexLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    label={indexLoading ? `Indexing ${projectPath?.split('/').pop() || ''}...` : 'Index Now'}
                    description={`Index ${projectPath?.split('/').pop() || 'project'} files`}
                    onClick={handleReindex}
                    disabled={indexLoading}
                  />
                </DropdownSection>
              </>
            )}
          </DropdownPanel>
        )}

        {/* LSP Dropdown */}
        <DropdownPanel
          trigger="LSP"
          triggerIcon={<Puzzle size={12} />}
          label="Language Server Protocols"
          badge={(() => {
            const active = lspStatuses.filter(s => s.hasBinary && s.hasPlugin).length;
            return active > 0 ? `${active}/${lspStatuses.length}` : undefined;
          })()}
          statusDot={
            !projectPath ? 'none'
            : lspDetection?.missing.length ? 'warning'
            : lspDetection?.installed.length ? 'active'
            : 'none'
          }
          onOpen={loadLspInfo}
        >
          {lspStatuses.length === 0 ? (
            <div className="dropdown__empty">Loading...</div>
          ) : (
            <>
              {/* Active (installed) LSPs */}
              {(() => {
                const active = lspStatuses.filter(s => s.hasBinary && s.hasPlugin);
                if (active.length === 0) return null;
                return (
                  <DropdownSection title={`Active (${active.length})`}>
                    {active.map(lsp => (
                      <div key={lsp.plugin} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <DropdownItem
                          icon={<Check size={14} />}
                          label={lsp.displayName}
                          description={lsp.binaryType}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUninstallLsp(lsp.plugin);
                          }}
                          disabled={lspInstalling !== null}
                          title="Uninstall"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--color-status-error)',
                            cursor: lspInstalling ? 'not-allowed' : 'pointer',
                            padding: '4px',
                            opacity: lspInstalling === lsp.plugin ? 1 : 0.7,
                          }}
                        >
                          {lspInstalling === lsp.plugin ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                      </div>
                    ))}
                  </DropdownSection>
                );
              })()}

              {/* Missing for project */}
              {lspDetection && lspDetection.missing.length > 0 && (
                <DropdownSection title="Missing for Project">
                  <DropdownItem
                    icon={lspInstalling ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    label="Install All Missing"
                    description={`${lspDetection.missing.length} LSPs needed`}
                    onClick={handleInstallAllMissing}
                    disabled={lspInstalling !== null}
                  />
                  {lspDetection.missing.map(plugin => {
                    const lsp = lspStatuses.find(s => s.plugin === plugin);
                    return (
                      <DropdownItem
                        key={plugin}
                        icon={lspInstalling === plugin ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        label={lsp?.displayName || plugin}
                        badge="Install"
                        onClick={() => handleInstallLsp(plugin)}
                        disabled={lspInstalling !== null}
                      />
                    );
                  })}
                </DropdownSection>
              )}

              {/* Available (not installed, not detected) */}
              {(() => {
                const detectedSet = new Set(lspDetection?.detected || []);
                const available = lspStatuses.filter(
                  s => !(s.hasBinary && s.hasPlugin) && !detectedSet.has(s.plugin)
                );
                if (available.length === 0) return null;
                return (
                  <DropdownSection title="Available">
                    {available.map(lsp => (
                      <DropdownItem
                        key={lsp.plugin}
                        icon={lspInstalling === lsp.plugin ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        label={lsp.displayName}
                        badge="Install"
                        onClick={() => handleInstallLsp(lsp.plugin)}
                        disabled={lspInstalling !== null}
                      />
                    ))}
                  </DropdownSection>
                );
              })()}

              <DropdownSection title="Actions">
                <DropdownItem
                  icon={<RefreshCw size={14} />}
                  label="Refresh"
                  onClick={loadLspInfo}
                />
              </DropdownSection>
            </>
          )}
        </DropdownPanel>

      </div>

      {/* MCP Manager Modal */}
      <McpManagerModal
        isOpen={showMcpManager}
        onClose={() => setShowMcpManager(false)}
        onMcpsChanged={loadMcps}
      />

      {/* Git Settings Modal */}
      <Modal
        isOpen={showGitSettings}
        onClose={() => setShowGitSettings(false)}
        title="Git Settings"
      >
        <GitSettings
          projectPath={projectPath}
          onGitInit={() => gitWatcherService.pollNow()}
        />
      </Modal>
    </div>
  );
}
