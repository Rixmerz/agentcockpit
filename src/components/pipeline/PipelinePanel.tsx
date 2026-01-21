import { useState, useEffect, useCallback } from 'react';
import {
  getPipelineState,
  getPipelineSteps,
  resetPipeline,
  advancePipeline,
  savePipelineSteps,
} from '../../services/pipelineService';
import type { PipelineState, PipelineStep } from '../../services/pipelineService';
import {
  getProjectPipelineConfig,
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
  Power
} from 'lucide-react';

interface PipelinePanelProps {
  projectPath: string | null;
  terminalId?: string | null;
}

export function PipelinePanel({ projectPath }: PipelinePanelProps) {
  const [state, setState] = useState<PipelineState | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[PipelinePanel] Loading data for project:', projectPath);

      // Load pipeline state and steps
      const pipelineState = await getPipelineState(projectPath);
      console.log('[PipelinePanel] State loaded:', pipelineState);

      const pipelineSteps = await getPipelineSteps(projectPath);
      console.log('[PipelinePanel] Steps loaded:', pipelineSteps);

      setState(pipelineState);
      setSteps(pipelineSteps);

      // Load project-specific pipeline config if we have a project
      if (projectPath) {
        const pipelineConfig = await getProjectPipelineConfig(projectPath);
        setEnabled(pipelineConfig.enabled);

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

  const handleReset = async () => {
    try {
      await resetPipeline(projectPath);
      await loadData();
    } catch (e) {
      console.error('[PipelinePanel] Reset error:', e);
    }
  };

  const handleAdvance = async () => {
    try {
      await advancePipeline(projectPath);
      await loadData();
    } catch (e) {
      console.error('[PipelinePanel] Advance error:', e);
    }
  };

  const handleToggleEnabled = async () => {
    if (!projectPath) return;

    const newEnabled = !enabled;
    setEnabled(newEnabled);

    try {
      // Update project config
      await updateProjectPipelineConfig(projectPath, { enabled: newEnabled });

      // If hooks are installed, sync them
      if (isInstalled) {
        await syncPipelineHooks(projectPath, newEnabled, steps);
      }
    } catch (e) {
      console.error('[PipelinePanel] Toggle error:', e);
      setEnabled(!newEnabled); // Revert on error
    }
  };

  const handleInstall = async () => {
    if (!projectPath) return;

    setInstalling(true);
    try {
      // Save default steps to project if not already present
      await savePipelineSteps(steps, projectPath);

      // Install hooks
      const result = await installPipelineHooks(projectPath, steps);

      if (result.success) {
        setIsInstalled(true);
        // Enable pipeline after installation
        setEnabled(true);
        await updateProjectPipelineConfig(projectPath, {
          enabled: true,
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
    }
  };

  const handleUninstall = async () => {
    if (!projectPath) return;

    setInstalling(true);
    try {
      const result = await uninstallPipelineHooks(projectPath);

      if (result.success) {
        setIsInstalled(false);
        setEnabled(false);
        await updateProjectPipelineConfig(projectPath, {
          enabled: false,
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

              {/* Current step */}
              {currentStep ? (
                <div className="pipeline-current-step">
                  <div className="pipeline-current-icon">
                    <Play size={16} />
                  </div>
                  <div className="pipeline-current-info">
                    <span className="pipeline-current-name">{currentStep.name}</span>
                    <span className="pipeline-current-mcps">
                      {currentStep.mcps_enabled?.join(', ') || 'none'}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '8px 0' }}>
                  No steps configured
                </div>
              )}

              {/* Quick steps view */}
              {steps.length > 0 && (
                <div className="pipeline-quick-steps">
                  {steps.map((step, index) => {
                    const isCompleted = state && index < state.current_step;
                    const isCurrent = state && index === state.current_step;
                    return (
                      <div
                        key={step.id || index}
                        className={`pipeline-quick-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
                        title={step.name}
                      >
                        {isCompleted ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                      </div>
                    );
                  })}
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
