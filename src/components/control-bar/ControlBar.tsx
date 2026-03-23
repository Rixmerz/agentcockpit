/**
 * ControlBar - Main top bar with dropdown controls
 * Contains: Workflow, MCPs, Ports, Git, Snapshots, DCC Index, LSP
 */

import { useEffect, memo } from 'react';
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
  Power,
} from 'lucide-react';
import { DropdownPanel, DropdownItem, DropdownSection } from './DropdownPanel';
import { Modal } from '../common/Modal';
import { GitSettings } from '../sidebar-right/GitSettings';
import type { WorkflowStatus } from '../../services/workflow/index';

// Hooks
import { useWorkflowStatus } from '../../hooks/useWorkflowStatus';
import { useGitStatus } from '../../hooks/useGitStatus';
import { useMcpStatus } from '../../hooks/useMcpStatus';
import { usePortsStatus } from '../../hooks/usePortsStatus';
import { useDccStatus } from '../../hooks/useDccStatus';
import { useLspStatus } from '../../hooks/useLspStatus';
import { useSnapshotStatus } from '../../hooks/useSnapshotStatus';

// Services used directly in JSX
import { gitWatcherService } from '../../services/gitWatcherService';
import { McpManagerModal } from '../mcp/McpManagerModal';

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
  onStatusChange?: (status: WorkflowStatus | null) => void;
}

export const ControlBar = memo(function ControlBar({ projectPath, onWorkflowChange, onStatusChange }: ControlBarProps) {
  // Domain hooks
  const {
    availableWorkflows,
    activeWorkflow,
    isWorkflowInstalled,
    isInstallingWorkflow,
    workflowEnabled,
    handleSelectWorkflow,
    handleResetWorkflow,
    handleInstallWorkflow,
    handleUninstallWorkflow,
    handleToggleWorkflowEnabled,
  } = useWorkflowStatus(projectPath, onWorkflowChange, onStatusChange);

  const {
    gitInfo,
    isPushing,
    showGitSettings,
    setShowGitSettings,
    handlePush,
  } = useGitStatus(projectPath);

  const {
    mcpServers,
    mcpLoading,
    showMcpManager,
    setShowMcpManager,
    loadMcps,
  } = useMcpStatus();

  const {
    activePorts,
    portsLoading,
    loadPorts,
    handleKillPort,
    handleOpenPort,
  } = usePortsStatus();

  const {
    dccInstalled,
    indexStats,
    indexLoading,
    indexError,
    loadIndexInfo,
    handleReindex,
  } = useDccStatus(projectPath);

  const {
    lspStatuses,
    lspDetection,
    lspInstalling,
    lspLoaded,
    loadLspInfo,
    handleInstallLsp,
    handleUninstallLsp,
    handleInstallAllMissing,
  } = useLspStatus(projectPath);

  const {
    historyItems,
    currentVersion,
    snapshotLoading,
    isRestoring,
    loadSnapshots,
    handleRestoreSnapshot,
  } = useSnapshotStatus(projectPath);

  // Load MCPs on mount
  useEffect(() => {
    loadMcps();
  }, [loadMcps]);

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
            <DropdownSection title="Enforcer">
              <DropdownItem
                icon={<Power size={14} />}
                label={workflowEnabled ? 'Pipeline ON' : 'Pipeline OFF'}
                description={workflowEnabled ? 'Click to disable enforcement' : 'Click to enable enforcement'}
                active={workflowEnabled}
                onClick={handleToggleWorkflowEnabled}
              />
            </DropdownSection>
          )}

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
          {!lspLoaded ? (
            <div className="dropdown__empty">Loading...</div>
          ) : lspStatuses.length === 0 ? (
            <div className="dropdown__empty">No LSPs available</div>
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
});
