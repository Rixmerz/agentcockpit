import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getWorkflowState,
  getWorkflowSteps,
  resetWorkflow,
  advanceWorkflow,
  saveWorkflowSteps,
  listGlobalWorkflows,
  getActiveWorkflowName,
  activateWorkflow,
  deactivateWorkflow,
  getGlobalWorkflowSteps,
  getEnforcerEnabled,
  getAvailableEdges,
  traverseEdge,
  getGraphState,
  copyAllAssetsToProject,
  invalidateHubConfigCache,
} from '../../services/workflowService';

// Polling interval in milliseconds (2 seconds)
const POLLING_INTERVAL = 2000;
import type { WorkflowState, WorkflowStep, GlobalWorkflowInfo, AvailableEdge, GraphState } from '../../services/workflowService';
import {
  updateProjectWorkflowConfig,
} from '../../services/projectSessionService';
import {
  isWorkflowHooksInstalled,
  installWorkflowHooks,
  uninstallWorkflowHooks,
  syncWorkflowHooks,
} from '../../services/hookService';
import { WorkflowModal } from './WorkflowModal';
import { WorkflowTimeline } from './WorkflowTimeline';
import { ErrorBanner } from '../common/ErrorBanner';
import { reindexProject, isDeltaCodeCubeInstalled, isIndexing } from '../../services/deltacodecubeService';
import {
  Workflow,
  Play,
  RotateCcw,
  ChevronRight,
  Settings,
  CheckCircle2,
  Circle,
  Download,
  Trash2,
  Power,
  ChevronDown,
  GitBranch,
  X,
  ArrowRight,
  Repeat,
  RefreshCw,
  Clock,
} from 'lucide-react';

interface WorkflowPanelProps {
  projectPath: string | null;
  terminalId?: string | null;
  onModalStateChange?: (isOpen: boolean) => void;
}

export function WorkflowPanel({ projectPath, onModalStateChange }: WorkflowPanelProps) {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Notify parent when modal opens/closes
  useEffect(() => {
    onModalStateChange?.(modalOpen);
  }, [modalOpen, onModalStateChange]);
  const [enabled, setEnabled] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Global workflows state
  const [globalWorkflows, setGlobalWorkflows] = useState<GlobalWorkflowInfo[]>([]);
  const [activeWorkflowName, setActiveWorkflowName] = useState<string | null>(null);
  const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);
  const [changingWorkflow, setChangingWorkflow] = useState(false);
  const [refreshingDropdown, setRefreshingDropdown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Graph-specific state
  const [availableEdges, setAvailableEdges] = useState<AvailableEdge[]>([]);
  const [graphState, setGraphState] = useState<GraphState | null>(null);
  const [showEdges, setShowEdges] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  // Refs for polling optimization
  const lastStateRef = useRef<string | null>(null);
  const pollingEnabledRef = useRef(true);
  const activeWorkflowRef = useRef<string | null>(null);
  const enabledRef = useRef<boolean>(true);
  const lastTransitionsRef = useRef<number>(-1);
  const dccInstalledRef = useRef<boolean | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    activeWorkflowRef.current = activeWorkflowName;
  }, [activeWorkflowName]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Reset all state immediately on project switch
  useEffect(() => {
    setState(null);
    setSteps([]);
    setActiveWorkflowName(null);
    setGraphState(null);
    setAvailableEdges([]);
    setEnabled(false);
    setIsInstalled(false);
    setError(null);
    setShowEdges(false);
    setWorkflowDropdownOpen(false);
    // Reset polling refs to prevent stale comparisons
    lastStateRef.current = null;
    activeWorkflowRef.current = null;
    enabledRef.current = true;
    lastTransitionsRef.current = -1;
    dccInstalledRef.current = null;
  }, [projectPath]);

  // Cache DCC installed status once per project switch — avoids await in polling hot path
  useEffect(() => {
    isDeltaCodeCubeInstalled().then(v => { dccInstalledRef.current = v; });
  }, [projectPath]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[WorkflowPanel] Loading data for project:', projectPath);

      // Load global workflows list (include project-local workflows)
      const globalList = await listGlobalWorkflows(projectPath);
      setGlobalWorkflows(globalList);
      console.log('[WorkflowPanel] Global workflows:', globalList);

      // Load workflow state first (contains active_workflow from MCP)
      const workflowState = await getWorkflowState(projectPath);
      console.log('[WorkflowPanel] State loaded:', workflowState);

      // Use active_workflow from state (set by MCP workflow-manager)
      const activeName = workflowState.active_workflow || await getActiveWorkflowName(projectPath);
      setActiveWorkflowName(activeName);
      console.log('[WorkflowPanel] Active workflow:', activeName);

      // If there's an active global workflow, load its steps
      let workflowSteps: WorkflowStep[];
      if (activeName) {
        workflowSteps = await getGlobalWorkflowSteps(activeName);
        console.log('[WorkflowPanel] Global workflow steps loaded:', workflowSteps.length);
        // Fallback to local if global workflow file not found
        if (workflowSteps.length === 0) {
          console.log('[WorkflowPanel] Global workflow empty, falling back to local');
          workflowSteps = await getWorkflowSteps(projectPath);
        }
      } else {
        workflowSteps = await getWorkflowSteps(projectPath);
        console.log('[WorkflowPanel] Local steps loaded:', workflowSteps);
      }

      setState(workflowState);
      setSteps(workflowSteps);

      // Load graph-specific data
      const edges = await getAvailableEdges(projectPath);
      setAvailableEdges(edges);
      const gState = await getGraphState(projectPath);
      setGraphState(gState);
      console.log('[WorkflowPanel] Graph state:', gState.current_nodes, 'edges:', edges.length);

      // Load project-specific workflow config if we have a project
      if (projectPath) {
        // Read enforcer enabled state from config.json (same source as polling)
        const enforcerEnabled = await getEnforcerEnabled(projectPath);
        setEnabled(enforcerEnabled);

        const hooksInstalled = await isWorkflowHooksInstalled(projectPath);
        setIsInstalled(hooksInstalled);
      } else {
        setEnabled(false);
        setIsInstalled(false);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[WorkflowPanel] Error:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lightweight polling function - only updates state if changed
  const pollState = useCallback(async () => {
    if (!pollingEnabledRef.current || !projectPath) return;

    try {
      // Get workflow state and enforcer enabled status
      const [newState, newEnabled] = await Promise.all([
        getWorkflowState(projectPath),
        getEnforcerEnabled(projectPath)
      ]);

      const newStateStr = JSON.stringify({
        current_step: newState.current_step,
        active_workflow: newState.active_workflow,
        completed_steps: newState.completed_steps?.length || 0,
        enabled: newEnabled
      });

      // Only update if state actually changed
      if (lastStateRef.current !== newStateStr) {
        console.log('[WorkflowPanel] State changed externally, updating UI');
        lastStateRef.current = newStateStr;

        // Update state
        setState(newState);

        // Check if enabled state changed
        if (newEnabled !== enabledRef.current) {
          console.log('[WorkflowPanel] Enabled changed:', enabledRef.current, '->', newEnabled);
          setEnabled(newEnabled);
        }

        // Check if active workflow changed (use ref to avoid stale closure)
        const newActiveName = newState.active_workflow || null;
        if (newActiveName !== activeWorkflowRef.current) {
          console.log('[WorkflowPanel] Active workflow changed:', activeWorkflowRef.current, '->', newActiveName);
          setActiveWorkflowName(newActiveName);

          // Reload steps if workflow changed
          let newSteps: WorkflowStep[];
          if (newActiveName) {
            newSteps = await getGlobalWorkflowSteps(newActiveName);
            if (newSteps.length === 0) {
              newSteps = await getWorkflowSteps(projectPath);
            }
          } else {
            newSteps = await getWorkflowSteps(projectPath);
          }
          setSteps(newSteps);
        }

        // Update graph-specific state
        const edges = await getAvailableEdges(projectPath);
        setAvailableEdges(edges);
        const gState = await getGraphState(projectPath);
        setGraphState(gState);

        // If total_transitions increased → a workflow traverse happened → trigger DCC reindex
        const newTransitions = gState.total_transitions ?? 0;
        if (lastTransitionsRef.current >= 0 && newTransitions > lastTransitionsRef.current) {
          if (dccInstalledRef.current === true && !isIndexing()) {
            reindexProject(projectPath).catch(() => {/* silent */});
          }
        }
        lastTransitionsRef.current = newTransitions;
      }
    } catch (e) {
      // Silently ignore polling errors to avoid spam
      console.debug('[WorkflowPanel] Poll error:', e);
    }
  }, [projectPath]); // Using refs to avoid stale closures

  // Polling effect - runs every POLLING_INTERVAL ms
  useEffect(() => {
    if (!projectPath) return;

    const intervalId = setInterval(pollState, POLLING_INTERVAL);

    // Cleanup on unmount
    return () => {
      clearInterval(intervalId);
    };
  }, [projectPath, pollState]);

  // Pause polling during user interactions
  const pausePolling = useCallback(() => {
    pollingEnabledRef.current = false;
  }, []);

  const resumePolling = useCallback(() => {
    pollingEnabledRef.current = true;
  }, []);

  const handleReset = async () => {
    pausePolling();
    try {
      await resetWorkflow(projectPath);
      await loadData();
    } catch (e) {
      console.error('[WorkflowPanel] Reset error:', e);
    } finally {
      resumePolling();
    }
  };

  const handleAdvance = async () => {
    pausePolling();
    try {
      await advanceWorkflow(projectPath);
      await loadData();
    } catch (e) {
      console.error('[WorkflowPanel] Advance error:', e);
    } finally {
      resumePolling();
    }
  };

  const handleTraverseEdge = async (edgeId: string) => {
    pausePolling();
    try {
      await traverseEdge(edgeId, projectPath, 'Manual UI traverse');
      await loadData();
      setShowEdges(false);
    } catch (e) {
      console.error('[WorkflowPanel] Traverse error:', e);
    } finally {
      resumePolling();
    }
  };

  const handleToggleEnabled = async () => {
    if (!projectPath) return;

    pausePolling();
    const newEnabled = !enabled;
    setEnabled(newEnabled);

    try {
      // Sync hooks - this writes enforcer_enabled to config.json
      if (isInstalled) {
        await syncWorkflowHooks(projectPath, newEnabled, steps);
      }
    } catch (e) {
      console.error('[WorkflowPanel] Toggle error:', e);
      setEnabled(!newEnabled); // Revert on error
    } finally {
      resumePolling();
    }
  };

  const handleInstall = async () => {
    if (!projectPath) return;

    pausePolling();
    setInstalling(true);
    try {
      // Save default steps to project if not already present
      await saveWorkflowSteps(steps, projectPath);

      // Install hooks
      const result = await installWorkflowHooks(projectPath, steps);

      if (result.success) {
        // Copy all agents and skills to project
        const assetsResult = await copyAllAssetsToProject(projectPath);
        if (!assetsResult.success) {
          console.warn('[WorkflowPanel] Some assets failed to copy:', assetsResult.errors);
        }

        setIsInstalled(true);
        // Enable workflow after installation (hooks write to config.json)
        setEnabled(true);
        await updateProjectWorkflowConfig(projectPath, {
          installedAt: Date.now()
        });
      } else {
        setError(result.error || 'Installation failed');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[WorkflowPanel] Install error:', errorMsg);
      setError(errorMsg);
    } finally {
      setInstalling(false);
      resumePolling();
    }
  };

  const handleUninstall = async () => {
    if (!projectPath) return;

    pausePolling();
    setInstalling(true);
    try {
      const result = await uninstallWorkflowHooks(projectPath);

      if (result.success) {
        setIsInstalled(false);
        setEnabled(false);
        await updateProjectWorkflowConfig(projectPath, {
          installedAt: null
        });
      } else {
        setError(result.error || 'Uninstallation failed');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[WorkflowPanel] Uninstall error:', errorMsg);
      setError(errorMsg);
    } finally {
      setInstalling(false);
      resumePolling();
    }
  };

  // Handle selecting a global workflow
  const handleSelectWorkflow = async (workflowName: string) => {
    if (!projectPath) return;

    pausePolling();
    setChangingWorkflow(true);
    setWorkflowDropdownOpen(false);

    try {
      const success = await activateWorkflow(projectPath, workflowName);
      if (success) {
        setActiveWorkflowName(workflowName);
        // Reload data to get new steps
        await loadData();
      } else {
        setError('Failed to activate workflow');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[WorkflowPanel] Activate workflow error:', errorMsg);
      setError(errorMsg);
    } finally {
      setChangingWorkflow(false);
      resumePolling();
    }
  };

  // Handle deactivating workflow (use local)
  const handleDeactivateWorkflow = async () => {
    if (!projectPath) return;

    pausePolling();
    setChangingWorkflow(true);
    setWorkflowDropdownOpen(false);

    try {
      const success = await deactivateWorkflow(projectPath);
      if (success) {
        setActiveWorkflowName(null);
        // Also disable the workflow enforcer when deactivating
        setEnabled(false);
        if (isInstalled) {
          await syncWorkflowHooks(projectPath, false, steps);
        }
        await loadData();
      } else {
        setError('Failed to deactivate workflow');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[WorkflowPanel] Deactivate workflow error:', errorMsg);
      setError(errorMsg);
    } finally {
      setChangingWorkflow(false);
      resumePolling();
    }
  };

  // Handle opening dropdown - refresh data to catch external changes (MCP)
  const handleToggleDropdown = async () => {
    if (workflowDropdownOpen) {
      // Just close and resume polling
      setWorkflowDropdownOpen(false);
      resumePolling();
      return;
    }

    // Opening - pause polling and refresh global workflows and active workflow
    pausePolling();
    setWorkflowDropdownOpen(true);
    setRefreshingDropdown(true);

    try {
      // Invalidate cache to pick up config changes (new workflows, etc.)
      invalidateHubConfigCache();

      // Refresh global workflows list (include project-local workflows)
      const globalList = await listGlobalWorkflows(projectPath);
      setGlobalWorkflows(globalList);

      // Refresh active workflow from state (may have changed via MCP)
      const workflowState = await getWorkflowState(projectPath);
      const activeName = workflowState.active_workflow || await getActiveWorkflowName(projectPath);
      setActiveWorkflowName(activeName);

      console.log('[WorkflowPanel] Dropdown refreshed - workflows:', globalList.length, 'active:', activeName);
    } catch (e) {
      console.error('[WorkflowPanel] Dropdown refresh error:', e);
    } finally {
      setRefreshingDropdown(false);
    }
  };

  // Manual refresh handler - invalidates cache and reloads everything
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      invalidateHubConfigCache();
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const currentStep = state && steps.length > 0 ? steps[state.current_step] : null;
  const progress = state && steps.length > 1
    ? (state.current_step / (steps.length - 1)) * 100
    : 0;

  return (
    <>
      <div className="workflow-panel">
        <div className="workflow-panel-header">
          <Workflow size={16} />
          <span>Workflow Control</span>
          <div className="workflow-header-actions">
            {/* Enable/Disable Toggle */}
            {projectPath && isInstalled && (
              <label className="workflow-toggle" title={enabled ? 'Disable Workflow' : 'Enable Workflow'}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={handleToggleEnabled}
                />
                <span className="toggle-slider">
                  <Power size={10} />
                </span>
              </label>
            )}
            <button
              className={`btn-icon-sm${refreshing ? ' spinning' : ''}`}
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh workflows"
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="btn-icon-sm"
              onClick={() => setModalOpen(true)}
              title="Configure Workflow"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Workflow Selector */}
        {projectPath && globalWorkflows.length > 0 && (
          <div className="workflow-selector">
            <div
              className={`workflow-selector-trigger ${workflowDropdownOpen ? 'open' : ''}`}
              onClick={handleToggleDropdown}
            >
              <GitBranch size={14} />
              <span className="workflow-selector-label">
                {changingWorkflow ? 'Changing...' : refreshingDropdown ? 'Loading...' : (activeWorkflowName || 'Local Workflow')}
              </span>
              <ChevronDown size={14} className={`workflow-selector-arrow ${workflowDropdownOpen ? 'open' : ''}`} />
            </div>

            {workflowDropdownOpen && (
              <div className="workflow-selector-dropdown">
                {/* Pipeline ON/OFF toggle */}
                <div
                  className="workflow-selector-option"
                  style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
                  onClick={(e) => { e.stopPropagation(); handleToggleEnabled(); }}
                >
                  <div className="workflow-option-info">
                    <span className="workflow-option-name">
                      {enabled ? 'Pipeline ON' : 'Pipeline OFF'}
                    </span>
                    <span className="workflow-option-desc">
                      {enabled ? 'Click to disable enforcement' : 'Click to enable enforcement'}
                    </span>
                  </div>
                  <label className="workflow-toggle" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={enabled} onChange={handleToggleEnabled} />
                    <span className="toggle-slider"><Power size={10} /></span>
                  </label>
                </div>
                {/* Option to use local workflow */}
                <div
                  className={`workflow-selector-option ${!activeWorkflowName ? 'active' : ''}`}
                  onClick={handleDeactivateWorkflow}
                >
                  <div className="workflow-option-info">
                    <span className="workflow-option-name">Local Workflow</span>
                    <span className="workflow-option-desc">Use project's local steps.yaml</span>
                  </div>
                  {!activeWorkflowName && <CheckCircle2 size={14} />}
                </div>

                {/* Global workflows */}
                {globalWorkflows.map((workflow) => (
                  <div
                    key={workflow.name}
                    className={`workflow-selector-option ${activeWorkflowName === workflow.name ? 'active' : ''}`}
                    onClick={() => handleSelectWorkflow(workflow.name)}
                  >
                    <div className="workflow-option-info">
                      <span className="workflow-option-name">{workflow.displayName}</span>
                      <span className="workflow-option-desc">
                        {workflow.stepsCount} steps
                        {workflow.description && ` • ${workflow.description}`}
                      </span>
                    </div>
                    {activeWorkflowName === workflow.name && <CheckCircle2 size={14} />}
                  </div>
                ))}

                {/* Close button */}
                <div
                  className="workflow-selector-close"
                  onClick={() => {
                    setWorkflowDropdownOpen(false);
                    resumePolling();
                  }}
                >
                  <X size={14} />
                  Close
                </div>
              </div>
            )}
          </div>
        )}

        <div className="workflow-panel-content">
          {/* Loading state */}
          {loading && (
            <div className="workflow-panel-loading">Loading...</div>
          )}

          {/* Error state */}
          {!loading && error && (
            <ErrorBanner message={error} onClose={() => setError(null)} />
          )}

          {/* Success state */}
          {!loading && !error && (
            <>
              {/* Progress bar */}
              <div className="workflow-progress">
                <div className="workflow-progress-bar">
                  <div
                    className="workflow-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="workflow-progress-text">
                  {state?.current_step ?? 0} / {Math.max(steps.length - 1, 0)}
                </span>
              </div>

              {/* Current step/node */}
              {currentStep ? (
                <div className="workflow-current-step">
                  <div className="workflow-current-icon">
                    <Play size={16} />
                  </div>
                  <div className="workflow-current-info">
                    <span className="workflow-current-name">{currentStep.name}</span>
                    <span className="workflow-current-mcps">
                      {Array.isArray(currentStep.mcps_enabled)
                        ? (currentStep.mcps_enabled.join(', ') || 'none')
                        : 'delegated'}
                    </span>
                    {/* Show visit count for current node */}
                    {graphState && state?.current_node && (
                      <span className="workflow-node-visits">
                        <Repeat size={10} />
                        {graphState.node_visits[state.current_node] || 1}/{currentStep.max_visits || 10}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '8px 0' }}>
                  No steps configured
                </div>
              )}

              {/* Quick steps view with visit counts */}
              {steps.length > 0 && (
                <div className="workflow-quick-steps">
                  {steps.map((step, index) => {
                    const isCompleted = state && index < state.current_step;
                    const isCurrent = state && index === state.current_step;
                    const visits = graphState?.node_visits[step.id] || 0;
                    return (
                      <div
                        key={step.id || index}
                        className={`workflow-quick-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
                        title={`${step.name} (${visits}/${step.max_visits || 10} visits)`}
                      >
                        {isCompleted ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                        {visits > 1 && <span className="visit-badge">{visits}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Available edges (graph transitions) */}
              {availableEdges.length > 0 && (
                <div className="workflow-edges-section">
                  <button
                    className="workflow-edges-toggle"
                    onClick={() => setShowEdges(!showEdges)}
                  >
                    <GitBranch size={12} />
                    <span>{availableEdges.length} edge{availableEdges.length > 1 ? 's' : ''}</span>
                    <ChevronDown size={12} className={showEdges ? 'open' : ''} />
                  </button>

                  {showEdges && (
                    <div className="workflow-edges-list">
                      {availableEdges.map((edge) => (
                        <div
                          key={edge.id}
                          className="workflow-edge-item"
                          onClick={() => handleTraverseEdge(edge.id)}
                        >
                          <ArrowRight size={12} />
                          <div className="edge-info">
                            <span className="edge-target">{edge.toName}</span>
                            <span className="edge-condition">
                              {edge.conditionType === 'tool' && `tool: ${edge.conditionTool?.split('__').pop()}`}
                              {edge.conditionType === 'phrase' && `phrases: ${edge.conditionPhrases?.slice(0, 2).join(', ')}`}
                              {edge.conditionType === 'always' && 'always'}
                              {edge.conditionType === 'default' && 'default'}
                            </span>
                          </div>
                          <span className="edge-priority">P{edge.priority}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Timeline toggle */}
              <div className="workflow-timeline-section">
                <button
                  className={`workflow-action-btn workflow-timeline-toggle${showTimeline ? ' active' : ''}`}
                  onClick={() => setShowTimeline(v => !v)}
                  title="Toggle workflow + git timeline"
                >
                  <Clock size={14} />
                  Timeline
                  {(graphState?.execution_path?.length ?? 0) > 0 && (
                    <span className="workflow-timeline-badge">
                      {graphState!.execution_path.length}
                    </span>
                  )}
                </button>
                {showTimeline && (
                  <WorkflowTimeline projectPath={projectPath} />
                )}
              </div>

              {/* Actions */}
              <div className="workflow-panel-actions">
                <button
                  className="workflow-action-btn"
                  onClick={handleReset}
                  title="Reset Workflow"
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
                <button
                  className="workflow-action-btn"
                  onClick={handleAdvance}
                  disabled={!state || state.current_step >= steps.length - 1}
                  title="Advance to Next Step"
                >
                  <ChevronRight size={14} />
                  Advance
                </button>
              </div>

              {/* Install/Uninstall to Project */}
              {projectPath && (
                <div className="workflow-install-section">
                  {!isInstalled ? (
                    <button
                      className="workflow-install-btn"
                      onClick={handleInstall}
                      disabled={installing}
                      title="Install workflow hooks to this project"
                    >
                      <Download size={14} />
                      {installing ? 'Installing...' : 'Install to Project'}
                    </button>
                  ) : (
                    <div className="workflow-installed-badge">
                      <CheckCircle2 size={12} />
                      <span>Installed</span>
                      <button
                        className="workflow-uninstall-btn"
                        onClick={handleUninstall}
                        disabled={installing}
                        title="Remove workflow hooks from project"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <WorkflowModal isOpen={modalOpen} onClose={() => setModalOpen(false)} projectPath={projectPath} />
    </>
  );
}
