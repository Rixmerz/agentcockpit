/**
 * ControlBar - Main top bar with dropdown controls
 * Contains: Pipeline, MCPs, Ports, Git
 */

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { DropdownPanel, DropdownItem, DropdownSection } from './DropdownPanel';
import { AudioVisualizer } from './AudioVisualizer';
import { Modal } from '../common/Modal';
import { GitSettings } from '../sidebar-right/GitSettings';

// Import services
import { pipelineService, copyAllAssetsToProject } from '../../services/pipelineService';
import { loadMcpConfig } from '../../services/mcpConfigService';
import {
  isPipelineHooksInstalled,
  installPipelineHooks,
  uninstallPipelineHooks,
} from '../../services/hookService';
import { McpManagerModal } from '../mcp/McpManagerModal';
import {
  getGitStatus,
  hasLocalGitRepo,
  getSyncStatus,
  gitPush,
  type SyncStatus,
} from '../../services/gitService';
import {
  getHistory,
  restoreSnapshot,
  getCurrentVersion,
  type HistoryItem,
} from '../../services/snapshotService';
import { useSnapshotEvent, snapshotEvents } from '../../core/utils/eventBus';

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
  onPipelineChange?: (pipelineName: string | null) => void;
}

interface PipelineInfo {
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

export function ControlBar({ projectPath, onPipelineChange }: ControlBarProps) {
  // Pipeline state
  const [availablePipelines, setAvailablePipelines] = useState<string[]>([]);
  const [activePipeline, setActivePipeline] = useState<PipelineInfo | null>(null);
  const [, setPipelineLoading] = useState(false);
  const [isPipelineInstalled, setIsPipelineInstalled] = useState(false);
  const [isInstallingPipeline, setIsInstallingPipeline] = useState(false);

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
  const [gitLoading, setGitLoading] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [showGitSettings, setShowGitSettings] = useState(false);

  // Snapshot state
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState<number | null>(null);

  // Load pipelines
  useEffect(() => {
    if (!projectPath) return;

    const loadPipelines = async () => {
      try {
        const pipelines = await pipelineService.listAvailablePipelines(projectPath);
        setAvailablePipelines(pipelines);

        // Check if there's an active pipeline
        const status = await pipelineService.getStatus(projectPath);
        if (status) {
          setActivePipeline({
            name: status.graphName || 'Unknown',
            currentNode: status.currentNode,
            isActive: true,
          });
        }

        // Check if pipeline hooks are installed
        const installed = await isPipelineHooksInstalled(projectPath);
        setIsPipelineInstalled(installed);
      } catch (err) {
        console.warn('[ControlBar] Failed to load pipelines:', err);
      }
    };

    loadPipelines();
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

  // Load Git info
  const loadGitInfo = useCallback(async () => {
    if (!projectPath) {
      setGitInfo({
        branch: null,
        hasChanges: false,
        modifiedCount: 0,
        stagedCount: 0,
        untrackedCount: 0,
        syncStatus: null,
        hasRepo: false,
      });
      return;
    }

    setGitLoading(true);
    try {
      const hasRepo = await hasLocalGitRepo(projectPath);
      if (!hasRepo) {
        setGitInfo({
          branch: null,
          hasChanges: false,
          modifiedCount: 0,
          stagedCount: 0,
          untrackedCount: 0,
          syncStatus: null,
          hasRepo: false,
        });
        return;
      }

      const [status, syncStatus] = await Promise.all([
        getGitStatus(projectPath),
        getSyncStatus(projectPath),
      ]);

      const totalChanges = status.modifiedFiles.length + status.stagedFiles.length + status.untrackedFiles.length;

      setGitInfo({
        branch: status.branch,
        hasChanges: totalChanges > 0,
        modifiedCount: status.modifiedFiles.length,
        stagedCount: status.stagedFiles.length,
        untrackedCount: status.untrackedFiles.length,
        syncStatus,
        hasRepo: true,
      });
    } catch (err) {
      console.warn('[ControlBar] Failed to load git info:', err);
    } finally {
      setGitLoading(false);
    }
  }, [projectPath]);

  // Handle git push
  const handlePush = useCallback(async () => {
    if (!projectPath) return;
    setIsPushing(true);
    try {
      await gitPush(projectPath);
      await loadGitInfo();
    } catch (error) {
      console.error('[ControlBar] Push failed:', error);
    } finally {
      setIsPushing(false);
    }
  }, [projectPath, loadGitInfo]);

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

  // Load ports on mount and periodically
  useEffect(() => {
    loadPorts();
    const interval = setInterval(loadPorts, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, [loadPorts]);

  // Load git info when project changes
  useEffect(() => {
    loadGitInfo();
    const interval = setInterval(loadGitInfo, 5000); // Every 5 seconds
    return () => clearInterval(interval);
  }, [loadGitInfo]);

  // Load snapshots when project changes
  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // Handle pipeline selection
  const handleSelectPipeline = useCallback(async (pipelineName: string) => {
    if (!projectPath) return;

    setPipelineLoading(true);
    try {
      await pipelineService.activatePipeline(projectPath, pipelineName);
      const status = await pipelineService.getStatus(projectPath);
      setActivePipeline({
        name: pipelineName,
        currentNode: status?.currentNode || null,
        isActive: true,
      });
      onPipelineChange?.(pipelineName);
    } catch (err) {
      console.error('[ControlBar] Failed to activate pipeline:', err);
    } finally {
      setPipelineLoading(false);
    }
  }, [projectPath, onPipelineChange]);

  // Handle pipeline reset
  const handleResetPipeline = useCallback(async () => {
    if (!projectPath) return;

    try {
      await pipelineService.resetPipeline(projectPath);
      const status = await pipelineService.getStatus(projectPath);
      if (activePipeline) {
        setActivePipeline({
          ...activePipeline,
          currentNode: status?.currentNode || null,
        });
      }
    } catch (err) {
      console.error('[ControlBar] Failed to reset pipeline:', err);
    }
  }, [projectPath, activePipeline]);

  // Handle pipeline install
  const handleInstallPipeline = useCallback(async () => {
    if (!projectPath) return;

    setIsInstallingPipeline(true);
    try {
      const result = await installPipelineHooks(projectPath, []);
      if (result.success) {
        // Copy all assets to project
        await copyAllAssetsToProject(projectPath);
        setIsPipelineInstalled(true);
      } else {
        console.error('[ControlBar] Install failed:', result.error);
      }
    } catch (err) {
      console.error('[ControlBar] Failed to install pipeline:', err);
    } finally {
      setIsInstallingPipeline(false);
    }
  }, [projectPath]);

  // Handle pipeline uninstall
  const handleUninstallPipeline = useCallback(async () => {
    if (!projectPath) return;

    setIsInstallingPipeline(true);
    try {
      const result = await uninstallPipelineHooks(projectPath);
      if (result.success) {
        setIsPipelineInstalled(false);
      } else {
        console.error('[ControlBar] Uninstall failed:', result.error);
      }
    } catch (err) {
      console.error('[ControlBar] Failed to uninstall pipeline:', err);
    } finally {
      setIsInstallingPipeline(false);
    }
  }, [projectPath]);

  return (
    <div className="control-bar">
      <div className="control-bar__section control-bar__section--left">
        {/* Pipeline Dropdown */}
        <DropdownPanel
          trigger={activePipeline?.name || 'Pipeline'}
          triggerIcon={<Workflow size={12} />}
          label="Pipeline"
          statusDot={activePipeline?.isActive ? 'active' : 'none'}
          width="wide"
        >
          <DropdownSection title="Available Pipelines">
            {availablePipelines.length === 0 ? (
              <div className="dropdown__empty">No pipelines found</div>
            ) : (
              availablePipelines.map(name => (
                <DropdownItem
                  key={name}
                  icon={<Workflow size={14} />}
                  label={name}
                  active={activePipeline?.name === name}
                  onClick={() => handleSelectPipeline(name)}
                />
              ))
            )}
          </DropdownSection>

          {activePipeline && (
            <DropdownSection title="Actions">
              <DropdownItem
                icon={<RefreshCw size={14} />}
                label="Reset Pipeline"
                description="Return to start node"
                onClick={handleResetPipeline}
              />
            </DropdownSection>
          )}

          {projectPath && (
            <DropdownSection title="Installation">
              {!isPipelineInstalled ? (
                <DropdownItem
                  icon={isInstallingPipeline ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  label={isInstallingPipeline ? "Installing..." : "Install Controller"}
                  description="Install pipeline hooks to project"
                  onClick={handleInstallPipeline}
                  disabled={isInstallingPipeline}
                />
              ) : (
                <DropdownItem
                  icon={isInstallingPipeline ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  label={isInstallingPipeline ? "Removing..." : "Uninstall Controller"}
                  description="Remove pipeline hooks from project"
                  onClick={handleUninstallPipeline}
                  disabled={isInstallingPipeline}
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
          {gitLoading ? (
            <div className="dropdown__empty">Loading...</div>
          ) : !gitInfo.hasRepo ? (
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
                  onClick={loadGitInfo}
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

        <div className="control-bar__divider" />

        {/* Audio Visualizer - BF3 Style (at the right end) */}
        <AudioVisualizer barCount={32} />
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
          onGitInit={() => loadGitInfo()}
        />
      </Modal>
    </div>
  );
}
