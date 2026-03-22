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
} from '../services/workflowService';
import type { WorkflowState, WorkflowStep, GlobalWorkflowInfo, AvailableEdge, GraphState } from '../services/workflowService';
import { updateProjectWorkflowConfig } from '../services/projectSessionService';
import {
  isWorkflowHooksInstalled,
  installWorkflowHooks,
  uninstallWorkflowHooks,
  syncWorkflowHooks,
} from '../services/hookService';
import { reindexProject, isDeltaCodeCubeInstalled, isIndexing } from '../services/deltacodecubeService';

// Polling interval in milliseconds (2 seconds)
const POLLING_INTERVAL = 2000;

export interface UseWorkflowPanelResult {
  // Data state
  state: WorkflowState | null;
  steps: WorkflowStep[];
  loading: boolean;
  error: string | null;
  enabled: boolean;
  isInstalled: boolean;
  installing: boolean;
  globalWorkflows: GlobalWorkflowInfo[];
  activeWorkflowName: string | null;
  changingWorkflow: boolean;
  refreshingDropdown: boolean;
  refreshing: boolean;
  availableEdges: AvailableEdge[];
  graphState: GraphState | null;
  // Derived
  currentStep: WorkflowStep | null;
  progress: number;
  // Handlers
  handleReset: () => Promise<void>;
  handleAdvance: () => Promise<void>;
  handleTraverseEdge: (edgeId: string) => Promise<void>;
  handleToggleEnabled: () => Promise<void>;
  handleInstall: () => Promise<void>;
  handleUninstall: () => Promise<void>;
  handleSelectWorkflow: (workflowName: string) => Promise<void>;
  handleDeactivateWorkflow: () => Promise<void>;
  handleToggleDropdown: (currentlyOpen: boolean) => Promise<void>;
  handleRefresh: () => Promise<void>;
  // Polling control (for UI interactions that need to pause polling)
  pausePolling: () => void;
  resumePolling: () => void;
  // Error dismiss
  dismissError: () => void;
}

export function useWorkflowPanel(projectPath: string | null): UseWorkflowPanelResult {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Global workflows state
  const [globalWorkflows, setGlobalWorkflows] = useState<GlobalWorkflowInfo[]>([]);
  const [activeWorkflowName, setActiveWorkflowName] = useState<string | null>(null);
  const [changingWorkflow, setChangingWorkflow] = useState(false);
  const [refreshingDropdown, setRefreshingDropdown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Graph-specific state
  const [availableEdges, setAvailableEdges] = useState<AvailableEdge[]>([]);
  const [graphState, setGraphState] = useState<GraphState | null>(null);

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
      // Load global workflows list (include project-local workflows)
      const globalList = await listGlobalWorkflows(projectPath);
      setGlobalWorkflows(globalList);

      // Load workflow state first (contains active_workflow from MCP)
      const workflowState = await getWorkflowState(projectPath);

      // Use active_workflow from state (set by MCP workflow-manager)
      const activeName = workflowState.active_workflow || await getActiveWorkflowName(projectPath);
      setActiveWorkflowName(activeName);

      // If there's an active global workflow, load its steps
      let workflowSteps: WorkflowStep[];
      if (activeName) {
        workflowSteps = await getGlobalWorkflowSteps(activeName);
        // Fallback to local if global workflow file not found
        if (workflowSteps.length === 0) {
          workflowSteps = await getWorkflowSteps(projectPath);
        }
      } else {
        workflowSteps = await getWorkflowSteps(projectPath);
      }

      setState(workflowState);
      setSteps(workflowSteps);

      // Load graph-specific data
      const edges = await getAvailableEdges(projectPath);
      setAvailableEdges(edges);
      const gState = await getGraphState(projectPath);
      setGraphState(gState);

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
      console.error('[useWorkflowPanel] Error:', errorMsg);
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
        lastStateRef.current = newStateStr;

        // Update state
        setState(newState);

        // Check if enabled state changed
        if (newEnabled !== enabledRef.current) {
          setEnabled(newEnabled);
        }

        // Check if active workflow changed (use ref to avoid stale closure)
        const newActiveName = newState.active_workflow || null;
        if (newActiveName !== activeWorkflowRef.current) {
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
      console.debug('[useWorkflowPanel] Poll error:', e);
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

  // Pause/resume polling during user interactions
  const pausePolling = useCallback(() => {
    pollingEnabledRef.current = false;
  }, []);

  const resumePolling = useCallback(() => {
    pollingEnabledRef.current = true;
  }, []);

  const handleReset = useCallback(async () => {
    pausePolling();
    try {
      await resetWorkflow(projectPath);
      await loadData();
    } catch (e) {
      console.error('[useWorkflowPanel] Reset error:', e);
    } finally {
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath, loadData]);

  const handleAdvance = useCallback(async () => {
    pausePolling();
    try {
      await advanceWorkflow(projectPath);
      await loadData();
    } catch (e) {
      console.error('[useWorkflowPanel] Advance error:', e);
    } finally {
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath, loadData]);

  const handleTraverseEdge = useCallback(async (edgeId: string) => {
    pausePolling();
    try {
      await traverseEdge(edgeId, projectPath, 'Manual UI traverse');
      await loadData();
    } catch (e) {
      console.error('[useWorkflowPanel] Traverse error:', e);
    } finally {
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath, loadData]);

  const handleToggleEnabled = useCallback(async () => {
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
      console.error('[useWorkflowPanel] Toggle error:', e);
      setEnabled(!newEnabled); // Revert on error
    } finally {
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath, enabled, isInstalled, steps]);

  const handleInstall = useCallback(async () => {
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
          console.warn('[useWorkflowPanel] Some assets failed to copy:', assetsResult.errors);
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
      console.error('[useWorkflowPanel] Install error:', errorMsg);
      setError(errorMsg);
    } finally {
      setInstalling(false);
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath, steps]);

  const handleUninstall = useCallback(async () => {
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
      console.error('[useWorkflowPanel] Uninstall error:', errorMsg);
      setError(errorMsg);
    } finally {
      setInstalling(false);
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath]);

  const handleSelectWorkflow = useCallback(async (workflowName: string) => {
    if (!projectPath) return;

    pausePolling();
    setChangingWorkflow(true);

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
      console.error('[useWorkflowPanel] Activate workflow error:', errorMsg);
      setError(errorMsg);
    } finally {
      setChangingWorkflow(false);
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath, loadData]);

  const handleDeactivateWorkflow = useCallback(async () => {
    if (!projectPath) return;

    pausePolling();
    setChangingWorkflow(true);

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
      console.error('[useWorkflowPanel] Deactivate workflow error:', errorMsg);
      setError(errorMsg);
    } finally {
      setChangingWorkflow(false);
      resumePolling();
    }
  }, [pausePolling, resumePolling, projectPath, isInstalled, steps, loadData]);

  // Handle opening dropdown - refresh data to catch external changes (MCP)
  const handleToggleDropdown = useCallback(async (currentlyOpen: boolean) => {
    if (currentlyOpen) {
      // Just close and resume polling — caller manages the open state
      resumePolling();
      return;
    }

    // Opening - pause polling and refresh global workflows and active workflow
    pausePolling();
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

    } catch (e) {
      console.error('[useWorkflowPanel] Dropdown refresh error:', e);
    } finally {
      setRefreshingDropdown(false);
    }
  }, [pausePolling, resumePolling, projectPath]);

  // Manual refresh handler - invalidates cache and reloads everything
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      invalidateHubConfigCache();
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  // Derived values
  const currentStep = state && steps.length > 0 ? steps[state.current_step] : null;
  const progress = state && steps.length > 1
    ? (state.current_step / (steps.length - 1)) * 100
    : 0;

  return {
    state,
    steps,
    loading,
    error,
    enabled,
    isInstalled,
    installing,
    globalWorkflows,
    activeWorkflowName,
    changingWorkflow,
    refreshingDropdown,
    refreshing,
    availableEdges,
    graphState,
    currentStep,
    progress,
    handleReset,
    handleAdvance,
    handleTraverseEdge,
    handleToggleEnabled,
    handleInstall,
    handleUninstall,
    handleSelectWorkflow,
    handleDeactivateWorkflow,
    handleToggleDropdown,
    handleRefresh,
    pausePolling,
    resumePolling,
    dismissError,
  };
}
