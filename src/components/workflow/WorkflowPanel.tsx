import { useState, useEffect } from 'react';
import { useWorkflowPanel } from '../../hooks/useWorkflowPanel';
import { WorkflowModal } from './WorkflowModal';
import { WorkflowTimeline } from './WorkflowTimeline';
import { ErrorBanner } from '../common/ErrorBanner';
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
  // UI-only local state
  const [modalOpen, setModalOpen] = useState(false);
  const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);
  const [showEdges, setShowEdges] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  // Notify parent when modal opens/closes
  useEffect(() => {
    onModalStateChange?.(modalOpen);
  }, [modalOpen, onModalStateChange]);

  // Reset UI-only state on project switch
  useEffect(() => {
    setShowEdges(false);
    setWorkflowDropdownOpen(false);
  }, [projectPath]);

  const {
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
    resumePolling,
    dismissError,
  } = useWorkflowPanel(projectPath);

  const onToggleDropdown = async () => {
    if (workflowDropdownOpen) {
      setWorkflowDropdownOpen(false);
      await handleToggleDropdown(true);
    } else {
      setWorkflowDropdownOpen(true);
      await handleToggleDropdown(false);
    }
  };

  const onTraverseEdge = async (edgeId: string) => {
    await handleTraverseEdge(edgeId);
    setShowEdges(false);
  };

  const onSelectWorkflow = async (workflowName: string) => {
    setWorkflowDropdownOpen(false);
    await handleSelectWorkflow(workflowName);
  };

  const onDeactivateWorkflow = async () => {
    setWorkflowDropdownOpen(false);
    await handleDeactivateWorkflow();
  };

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
              onClick={onToggleDropdown}
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
                  onClick={onDeactivateWorkflow}
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
                    onClick={() => onSelectWorkflow(workflow.name)}
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
            <ErrorBanner message={error} onClose={dismissError} />
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
                          onClick={() => onTraverseEdge(edge.id)}
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
