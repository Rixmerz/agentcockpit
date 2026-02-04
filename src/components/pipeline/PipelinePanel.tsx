import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getPipelineState,
  getPipelineSteps,
  resetPipeline,
  advancePipeline,
  savePipelineSteps,
  listGlobalPipelines,
  getActivePipelineName,
  activatePipeline,
  deactivatePipeline,
  getGlobalPipelineSteps,
  getEnforcerEnabled,
  getAvailableEdges,
  traverseEdge,
  getGraphState,
  copyAllAssetsToProject,
  invalidateHubConfigCache,
} from '../../services/pipelineService';

// Polling interval in milliseconds (2 seconds)
const POLLING_INTERVAL = 2000;
import type { PipelineState, PipelineStep, GlobalPipelineInfo, AvailableEdge, GraphState } from '../../services/pipelineService';
import {
  updateProjectPipelineConfig,
} from '../../services/projectSessionService';
import {
  isPipelineHooksInstalled,
  installPipelineHooks,
  uninstallPipelineHooks,
  syncPipelineHooks,
} from '../../services/hookService';
import { PipelineModal } from './PipelineModal';
import {
  Workflow,
  Play,
  RotateCcw,
  ChevronRight,
  Settings,
  CheckCircle2,
  Circle,
  AlertCircle,
  Download,
  Trash2,
  Power,
  ChevronDown,
  GitBranch,
  X,
  ArrowRight,
  Repeat,
} from 'lucide-react';

interface PipelinePanelProps {
  projectPath: string | null;
  terminalId?: string | null;
  onModalStateChange?: (isOpen: boolean) => void;
}

export function PipelinePanel({ projectPath, onModalStateChange }: PipelinePanelProps) {
  const [state, setState] = useState<PipelineState | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
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

  // Global pipelines state
  const [globalPipelines, setGlobalPipelines] = useState<GlobalPipelineInfo[]>([]);
  const [activePipelineName, setActivePipelineName] = useState<string | null>(null);
  const [pipelineDropdownOpen, setPipelineDropdownOpen] = useState(false);
  const [changingPipeline, setChangingPipeline] = useState(false);
  const [refreshingDropdown, setRefreshingDropdown] = useState(false);

  // Graph-specific state
  const [availableEdges, setAvailableEdges] = useState<AvailableEdge[]>([]);
  const [graphState, setGraphState] = useState<GraphState | null>(null);
  const [showEdges, setShowEdges] = useState(false);

  // Refs for polling optimization
  const lastStateRef = useRef<string | null>(null);
  const pollingEnabledRef = useRef(true);
  const activePipelineRef = useRef<string | null>(null);
  const enabledRef = useRef<boolean>(true);

  // Keep refs in sync with state
  useEffect(() => {
    activePipelineRef.current = activePipelineName;
  }, [activePipelineName]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[PipelinePanel] Loading data for project:', projectPath);

      // Load global pipelines list
      const globalList = await listGlobalPipelines();
      setGlobalPipelines(globalList);
      console.log('[PipelinePanel] Global pipelines:', globalList);

      // Load pipeline state first (contains active_pipeline from MCP)
      const pipelineState = await getPipelineState(projectPath);
      console.log('[PipelinePanel] State loaded:', pipelineState);

      // Use active_pipeline from state (set by MCP pipeline-manager)
      const activeName = pipelineState.active_pipeline || await getActivePipelineName(projectPath);
      setActivePipelineName(activeName);
      console.log('[PipelinePanel] Active pipeline:', activeName);

      // If there's an active global pipeline, load its steps
      let pipelineSteps: PipelineStep[];
      if (activeName) {
        pipelineSteps = await getGlobalPipelineSteps(activeName);
        console.log('[PipelinePanel] Global pipeline steps loaded:', pipelineSteps.length);
        // Fallback to local if global pipeline file not found
        if (pipelineSteps.length === 0) {
          console.log('[PipelinePanel] Global pipeline empty, falling back to local');
          pipelineSteps = await getPipelineSteps(projectPath);
        }
      } else {
        pipelineSteps = await getPipelineSteps(projectPath);
        console.log('[PipelinePanel] Local steps loaded:', pipelineSteps);
      }

      setState(pipelineState);
      setSteps(pipelineSteps);

      // Load graph-specific data
      const edges = await getAvailableEdges(projectPath);
      setAvailableEdges(edges);
      const gState = await getGraphState(projectPath);
      setGraphState(gState);
      console.log('[PipelinePanel] Graph state:', gState.current_nodes, 'edges:', edges.length);

      // Load project-specific pipeline config if we have a project
      if (projectPath) {
        // Read enforcer enabled state from config.json (same source as polling)
        const enforcerEnabled = await getEnforcerEnabled(projectPath);
        setEnabled(enforcerEnabled);

        const hooksInstalled = await isPipelineHooksInstalled(projectPath);
        setIsInstalled(hooksInstalled);
      } else {
        setEnabled(false);
        setIsInstalled(false);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[PipelinePanel] Error:', errorMsg);
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
      // Get pipeline state and enforcer enabled status
      const [newState, newEnabled] = await Promise.all([
        getPipelineState(projectPath),
        getEnforcerEnabled(projectPath)
      ]);

      const newStateStr = JSON.stringify({
        current_step: newState.current_step,
        active_pipeline: newState.active_pipeline,
        completed_steps: newState.completed_steps?.length || 0,
        enabled: newEnabled
      });

      // Only update if state actually changed
      if (lastStateRef.current !== newStateStr) {
        console.log('[PipelinePanel] State changed externally, updating UI');
        lastStateRef.current = newStateStr;

        // Update state
        setState(newState);

        // Check if enabled state changed
        if (newEnabled !== enabledRef.current) {
          console.log('[PipelinePanel] Enabled changed:', enabledRef.current, '->', newEnabled);
          setEnabled(newEnabled);
        }

        // Check if active pipeline changed (use ref to avoid stale closure)
        const newActiveName = newState.active_pipeline || null;
        if (newActiveName !== activePipelineRef.current) {
          console.log('[PipelinePanel] Active pipeline changed:', activePipelineRef.current, '->', newActiveName);
          setActivePipelineName(newActiveName);

          // Reload steps if pipeline changed
          let newSteps: PipelineStep[];
          if (newActiveName) {
            newSteps = await getGlobalPipelineSteps(newActiveName);
            if (newSteps.length === 0) {
              newSteps = await getPipelineSteps(projectPath);
            }
          } else {
            newSteps = await getPipelineSteps(projectPath);
          }
          setSteps(newSteps);
        }

        // Update graph-specific state
        const edges = await getAvailableEdges(projectPath);
        setAvailableEdges(edges);
        const gState = await getGraphState(projectPath);
        setGraphState(gState);
      }
    } catch (e) {
      // Silently ignore polling errors to avoid spam
      console.debug('[PipelinePanel] Poll error:', e);
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
      await resetPipeline(projectPath);
      await loadData();
    } catch (e) {
      console.error('[PipelinePanel] Reset error:', e);
    } finally {
      resumePolling();
    }
  };

  const handleAdvance = async () => {
    pausePolling();
    try {
      await advancePipeline(projectPath);
      await loadData();
    } catch (e) {
      console.error('[PipelinePanel] Advance error:', e);
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
      console.error('[PipelinePanel] Traverse error:', e);
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
        await syncPipelineHooks(projectPath, newEnabled, steps);
      }
    } catch (e) {
      console.error('[PipelinePanel] Toggle error:', e);
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
      await savePipelineSteps(steps, projectPath);

      // Install hooks
      const result = await installPipelineHooks(projectPath, steps);

      if (result.success) {
        // Copy all agents and skills to project
        const assetsResult = await copyAllAssetsToProject(projectPath);
        if (!assetsResult.success) {
          console.warn('[PipelinePanel] Some assets failed to copy:', assetsResult.errors);
        }

        setIsInstalled(true);
        // Enable pipeline after installation (hooks write to config.json)
        setEnabled(true);
        await updateProjectPipelineConfig(projectPath, {
          installedAt: Date.now()
        });
      } else {
        setError(result.error || 'Installation failed');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[PipelinePanel] Install error:', errorMsg);
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
      const result = await uninstallPipelineHooks(projectPath);

      if (result.success) {
        setIsInstalled(false);
        setEnabled(false);
        await updateProjectPipelineConfig(projectPath, {
          installedAt: null
        });
      } else {
        setError(result.error || 'Uninstallation failed');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[PipelinePanel] Uninstall error:', errorMsg);
      setError(errorMsg);
    } finally {
      setInstalling(false);
      resumePolling();
    }
  };

  // Handle selecting a global pipeline
  const handleSelectPipeline = async (pipelineName: string) => {
    if (!projectPath) return;

    pausePolling();
    setChangingPipeline(true);
    setPipelineDropdownOpen(false);

    try {
      const success = await activatePipeline(projectPath, pipelineName);
      if (success) {
        setActivePipelineName(pipelineName);
        // Reload data to get new steps
        await loadData();
      } else {
        setError('Failed to activate pipeline');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[PipelinePanel] Activate pipeline error:', errorMsg);
      setError(errorMsg);
    } finally {
      setChangingPipeline(false);
      resumePolling();
    }
  };

  // Handle deactivating pipeline (use local)
  const handleDeactivatePipeline = async () => {
    if (!projectPath) return;

    pausePolling();
    setChangingPipeline(true);
    setPipelineDropdownOpen(false);

    try {
      const success = await deactivatePipeline(projectPath);
      if (success) {
        setActivePipelineName(null);
        // Also disable the pipeline enforcer when deactivating
        setEnabled(false);
        if (isInstalled) {
          await syncPipelineHooks(projectPath, false, steps);
        }
        await loadData();
      } else {
        setError('Failed to deactivate pipeline');
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[PipelinePanel] Deactivate pipeline error:', errorMsg);
      setError(errorMsg);
    } finally {
      setChangingPipeline(false);
      resumePolling();
    }
  };

  // Handle opening dropdown - refresh data to catch external changes (MCP)
  const handleToggleDropdown = async () => {
    if (pipelineDropdownOpen) {
      // Just close and resume polling
      setPipelineDropdownOpen(false);
      resumePolling();
      return;
    }

    // Opening - pause polling and refresh global pipelines and active pipeline
    pausePolling();
    setPipelineDropdownOpen(true);
    setRefreshingDropdown(true);

    try {
      // Invalidate cache to pick up config changes (new pipelines, etc.)
      invalidateHubConfigCache();

      // Refresh global pipelines list
      const globalList = await listGlobalPipelines();
      setGlobalPipelines(globalList);

      // Refresh active pipeline from state (may have changed via MCP)
      const pipelineState = await getPipelineState(projectPath);
      const activeName = pipelineState.active_pipeline || await getActivePipelineName(projectPath);
      setActivePipelineName(activeName);

      console.log('[PipelinePanel] Dropdown refreshed - pipelines:', globalList.length, 'active:', activeName);
    } catch (e) {
      console.error('[PipelinePanel] Dropdown refresh error:', e);
    } finally {
      setRefreshingDropdown(false);
    }
  };

  const currentStep = state && steps.length > 0 ? steps[state.current_step] : null;
  const progress = state && steps.length > 1
    ? (state.current_step / (steps.length - 1)) * 100
    : 0;

  return (
    <>
      <div className="pipeline-panel">
        <div className="pipeline-panel-header">
          <Workflow size={16} />
          <span>Pipeline Control</span>
          <div className="pipeline-header-actions">
            {/* Enable/Disable Toggle */}
            {projectPath && isInstalled && (
              <label className="pipeline-toggle" title={enabled ? 'Disable Pipeline' : 'Enable Pipeline'}>
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
              className="btn-icon-sm"
              onClick={() => setModalOpen(true)}
              title="Configure Pipeline"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Pipeline Selector */}
        {projectPath && globalPipelines.length > 0 && (
          <div className="pipeline-selector">
            <div
              className={`pipeline-selector-trigger ${pipelineDropdownOpen ? 'open' : ''}`}
              onClick={handleToggleDropdown}
            >
              <GitBranch size={14} />
              <span className="pipeline-selector-label">
                {changingPipeline ? 'Changing...' : refreshingDropdown ? 'Loading...' : (activePipelineName || 'Local Pipeline')}
              </span>
              <ChevronDown size={14} className={`pipeline-selector-arrow ${pipelineDropdownOpen ? 'open' : ''}`} />
            </div>

            {pipelineDropdownOpen && (
              <div className="pipeline-selector-dropdown">
                {/* Option to use local pipeline */}
                <div
                  className={`pipeline-selector-option ${!activePipelineName ? 'active' : ''}`}
                  onClick={handleDeactivatePipeline}
                >
                  <div className="pipeline-option-info">
                    <span className="pipeline-option-name">Local Pipeline</span>
                    <span className="pipeline-option-desc">Use project's local steps.yaml</span>
                  </div>
                  {!activePipelineName && <CheckCircle2 size={14} />}
                </div>

                {/* Global pipelines */}
                {globalPipelines.map((pipeline) => (
                  <div
                    key={pipeline.name}
                    className={`pipeline-selector-option ${activePipelineName === pipeline.name ? 'active' : ''}`}
                    onClick={() => handleSelectPipeline(pipeline.name)}
                  >
                    <div className="pipeline-option-info">
                      <span className="pipeline-option-name">{pipeline.displayName}</span>
                      <span className="pipeline-option-desc">
                        {pipeline.stepsCount} steps
                        {pipeline.description && ` • ${pipeline.description}`}
                      </span>
                    </div>
                    {activePipelineName === pipeline.name && <CheckCircle2 size={14} />}
                  </div>
                ))}

                {/* Close button */}
                <div
                  className="pipeline-selector-close"
                  onClick={() => {
                    setPipelineDropdownOpen(false);
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

        <div className="pipeline-panel-content">
          {/* Loading state */}
          {loading && (
            <div className="pipeline-panel-loading">Loading...</div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div style={{
              padding: '12px',
              color: '#ef4444',
              fontSize: '11px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '6px',
              marginBottom: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <AlertCircle size={14} />
                <span>Error loading pipeline</span>
              </div>
              <div style={{ opacity: 0.8, fontSize: '10px', marginBottom: '8px' }}>{error}</div>
              <button
                className="pipeline-action-btn"
                onClick={loadData}
                style={{ width: '100%' }}
              >
                <RotateCcw size={14} />
                Retry
              </button>
            </div>
          )}

          {/* Success state */}
          {!loading && !error && (
            <>
              {/* Progress bar */}
              <div className="pipeline-progress">
                <div className="pipeline-progress-bar">
                  <div
                    className="pipeline-progress-fill"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="pipeline-progress-text">
                  {state?.current_step ?? 0} / {Math.max(steps.length - 1, 0)}
                </span>
              </div>

              {/* Current step/node */}
              {currentStep ? (
                <div className="pipeline-current-step">
                  <div className="pipeline-current-icon">
                    <Play size={16} />
                  </div>
                  <div className="pipeline-current-info">
                    <span className="pipeline-current-name">{currentStep.name}</span>
                    <span className="pipeline-current-mcps">
                      {Array.isArray(currentStep.mcps_enabled)
                        ? (currentStep.mcps_enabled.join(', ') || 'none')
                        : 'delegated'}
                    </span>
                    {/* Show visit count for current node */}
                    {graphState && state?.current_node && (
                      <span className="pipeline-node-visits">
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
                <div className="pipeline-quick-steps">
                  {steps.map((step, index) => {
                    const isCompleted = state && index < state.current_step;
                    const isCurrent = state && index === state.current_step;
                    const visits = graphState?.node_visits[step.id] || 0;
                    return (
                      <div
                        key={step.id || index}
                        className={`pipeline-quick-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
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
                <div className="pipeline-edges-section">
                  <button
                    className="pipeline-edges-toggle"
                    onClick={() => setShowEdges(!showEdges)}
                  >
                    <GitBranch size={12} />
                    <span>{availableEdges.length} edge{availableEdges.length > 1 ? 's' : ''}</span>
                    <ChevronDown size={12} className={showEdges ? 'open' : ''} />
                  </button>

                  {showEdges && (
                    <div className="pipeline-edges-list">
                      {availableEdges.map((edge) => (
                        <div
                          key={edge.id}
                          className="pipeline-edge-item"
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

              {/* Actions */}
              <div className="pipeline-panel-actions">
                <button
                  className="pipeline-action-btn"
                  onClick={handleReset}
                  title="Reset Pipeline"
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
                <button
                  className="pipeline-action-btn"
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
                <div className="pipeline-install-section">
                  {!isInstalled ? (
                    <button
                      className="pipeline-install-btn"
                      onClick={handleInstall}
                      disabled={installing}
                      title="Install pipeline hooks to this project"
                    >
                      <Download size={14} />
                      {installing ? 'Installing...' : 'Install to Project'}
                    </button>
                  ) : (
                    <div className="pipeline-installed-badge">
                      <CheckCircle2 size={12} />
                      <span>Installed</span>
                      <button
                        className="pipeline-uninstall-btn"
                        onClick={handleUninstall}
                        disabled={installing}
                        title="Remove pipeline hooks from project"
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

      <PipelineModal isOpen={modalOpen} onClose={() => setModalOpen(false)} projectPath={projectPath} />
    </>
  );
}
