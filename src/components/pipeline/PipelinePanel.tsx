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
  Circle,
  AlertCircle
} from 'lucide-react';

export function PipelinePanel() {
  const [state, setState] = useState<PipelineState | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[PipelinePanel] Loading data...');

      const pipelineState = await getPipelineState();
      console.log('[PipelinePanel] State loaded:', pipelineState);

      const pipelineSteps = await getPipelineSteps();
      console.log('[PipelinePanel] Steps loaded:', pipelineSteps);

      setState(pipelineState);
      setSteps(pipelineSteps);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.error('[PipelinePanel] Error:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      await resetPipeline();
      await loadData();
    } catch (e) {
      console.error('[PipelinePanel] Reset error:', e);
    }
  };

  const handleAdvance = async () => {
    try {
      await advancePipeline();
      await loadData();
    } catch (e) {
      console.error('[PipelinePanel] Advance error:', e);
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
          <button
            className="btn-icon-sm"
            onClick={() => setModalOpen(true)}
            title="Configure Pipeline"
          >
            <Settings size={14} />
          </button>
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
            </>
          )}
        </div>
      </div>

      <PipelineModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
