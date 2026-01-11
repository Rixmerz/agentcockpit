import { useState, useEffect } from 'react';
import {
  getPipelineState,
  getPipelineSteps,
  resetPipeline,
  advancePipeline,
} from '../../services/pipelineService';
import type { PipelineState, PipelineStep } from '../../services/pipelineService';
import { PipelineModal } from './PipelineModal';
import {
  Workflow,
  Play,
  RotateCcw,
  ChevronRight,
  Settings,
  CheckCircle2,
  Circle
} from 'lucide-react';

export function PipelinePanel() {
  const [state, setState] = useState<PipelineState | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    loadData();
    // Refresh every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      setError(null);
      const [pipelineState, pipelineSteps] = await Promise.all([
        getPipelineState(),
        getPipelineSteps()
      ]);
      setState(pipelineState);
      setSteps(pipelineSteps);
    } catch (e) {
      console.error('[PipelinePanel] Failed to load:', e);
      setError(e instanceof Error ? e.message : 'Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    await resetPipeline();
    await loadData();
  };

  const handleAdvance = async () => {
    await advancePipeline();
    await loadData();
  };

  const getCurrentStep = (): PipelineStep | null => {
    if (!state || !steps.length) return null;
    return steps[state.current_step] || null;
  };

  const currentStep = getCurrentStep();
  const progress = state ? ((state.current_step) / Math.max(steps.length - 1, 1)) * 100 : 0;

  if (loading) {
    return (
      <div className="pipeline-panel">
        <div className="pipeline-panel-header">
          <Workflow size={16} />
          <span>Pipeline</span>
        </div>
        <div className="pipeline-panel-loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pipeline-panel">
        <div className="pipeline-panel-header">
          <Workflow size={16} />
          <span>Pipeline Control</span>
        </div>
        <div className="pipeline-panel-content">
          <div style={{ color: 'var(--error)', fontSize: '11px', padding: '8px' }}>
            Error: {error}
          </div>
          <button className="pipeline-action-btn" onClick={loadData}>
            <RotateCcw size={14} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pipeline-panel">
        <div className="pipeline-panel-header">
          <Workflow size={16} />
          <span>Pipeline Control</span>
          <button
            className="btn-icon-sm"
            onClick={() => setModalOpen(true)}
            title="Configure Pipeline"
          >
            <Settings size={14} />
          </button>
        </div>

        <div className="pipeline-panel-content">
          {/* Progress bar */}
          <div className="pipeline-progress">
            <div className="pipeline-progress-bar">
              <div
                className="pipeline-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="pipeline-progress-text">
              Step {state?.current_step || 0} / {steps.length - 1}
            </span>
          </div>

          {/* Current step */}
          {currentStep && (
            <div className="pipeline-current-step">
              <div className="pipeline-current-icon">
                <Play size={16} />
              </div>
              <div className="pipeline-current-info">
                <span className="pipeline-current-name">{currentStep.name}</span>
                <span className="pipeline-current-mcps">
                  {currentStep.mcps_enabled.join(', ')}
                </span>
              </div>
            </div>
          )}

          {/* Quick steps view */}
          <div className="pipeline-quick-steps">
            {steps.map((step, index) => {
              const isCompleted = state && index < state.current_step;
              const isCurrent = state && index === state.current_step;
              return (
                <div
                  key={step.id}
                  className={`pipeline-quick-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
                  title={step.name}
                >
                  {isCompleted ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                </div>
              );
            })}
          </div>

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
        </div>
      </div>

      <PipelineModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
