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
} from 'lucide-react';
import { DropdownPanel, DropdownItem, DropdownSection } from './DropdownPanel';

// Import services
import { pipelineService } from '../../services/pipelineService';
import { loadMcpConfig } from '../../services/mcpConfigService';
import {
  getGitStatus,
  hasLocalGitRepo,
  getSyncStatus,
  gitPush,
  type SyncStatus,
} from '../../services/gitService';

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

  // MCP state
  const [mcpServers, setMcpServers] = useState<McpStatus[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);

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
      } catch (err) {
        console.warn('[ControlBar] Failed to load pipelines:', err);
      }
    };

    loadPipelines();
  }, [projectPath]);

  // Load MCPs
  useEffect(() => {
    const loadMcps = async () => {
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
    };

    loadMcps();
  }, []);

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

  // Kill port
  const handleKillPort = useCallback(async (port: number) => {
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
      setTimeout(loadPorts, 500);
    } catch (error) {
      console.warn(`[ControlBar] Error killing port ${port}:`, error);
      setTimeout(loadPorts, 500);
    }
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

  return (
    <div className="control-bar">
      <div className="control-bar__section control-bar__section--left">
        {/* Pipeline Dropdown */}
        <DropdownPanel
          trigger={activePipeline?.name || 'Pipeline'}
          triggerIcon={<Workflow size={14} />}
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
        </DropdownPanel>

        {/* MCPs Dropdown */}
        <DropdownPanel
          trigger="MCPs"
          triggerIcon={<Server size={14} />}
          label="MCP Servers"
          badge={mcpServers.filter(m => m.connected).length || undefined}
          statusDot={mcpServers.some(m => m.connected) ? 'active' : 'none'}
        >
          {mcpLoading ? (
            <div className="dropdown__empty">Loading...</div>
          ) : mcpServers.length === 0 ? (
            <div className="dropdown__empty">No MCP servers configured</div>
          ) : (
            mcpServers.map(mcp => (
              <DropdownItem
                key={mcp.name}
                icon={mcp.connected ? <Check size={14} /> : <Server size={14} />}
                label={mcp.name}
                badge={mcp.connected ? 'ON' : undefined}
                active={mcp.connected}
              />
            ))
          )}
        </DropdownPanel>

        {/* Ports Dropdown */}
        <DropdownPanel
          trigger="Ports"
          triggerIcon={<Globe size={14} />}
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
          triggerIcon={<GitBranch size={14} />}
          label="Git Status"
          badge={gitInfo.hasChanges ? (gitInfo.modifiedCount + gitInfo.stagedCount + gitInfo.untrackedCount) : undefined}
          statusDot={gitInfo.hasChanges ? 'warning' : gitInfo.hasRepo ? 'active' : 'none'}
        >
          {gitLoading ? (
            <div className="dropdown__empty">Loading...</div>
          ) : !gitInfo.hasRepo ? (
            <div className="dropdown__empty">No git repository</div>
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
                  icon={<RefreshCw size={14} />}
                  label="Refresh"
                  onClick={loadGitInfo}
                />
              </DropdownSection>
            </>
          )}
        </DropdownPanel>
      </div>

      <div className="control-bar__section control-bar__section--right">
        {/* Status indicator */}
        {activePipeline && (
          <div className="control-bar__status">
            <span className="control-bar__status-dot control-bar__status-dot--active" />
            <span>Node: {activePipeline.currentNode || 'start'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
