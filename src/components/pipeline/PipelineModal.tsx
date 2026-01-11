import { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import {
  getPipelineState,
  getPipelineSteps,
  savePipelineSteps,
  resetPipeline,
  advancePipeline,
  isPipelineInstalled,
  PipelineState,
  PipelineStep
} from '../../services/pipelineService';
import {
  Play,
  RotateCcw,
  ChevronRight,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ArrowRight
} from 'lucide-react';

interface PipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = 'status' | 'steps' | 'edit-step';

export function PipelineModal({ isOpen, onClose }: PipelineModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('status');
  const [state, setState] = useState<PipelineState | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [isInstalled, setIsInstalled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingStep, setEditingStep] = useState<PipelineStep | null>(null);
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  // Load data when modal opens
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [installed, pipelineState, pipelineSteps] = await Promise.all([
        isPipelineInstalled(),
        getPipelineState(),
        getPipelineSteps()
      ]);
      setIsInstalled(installed);
      setState(pipelineState);
      setSteps(pipelineSteps);
    } catch (e) {
      console.error('[PipelineModal] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await resetPipeline();
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleAdvance = async () => {
    setSaving(true);
    try {
      await advancePipeline();
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSteps = async () => {
    setSaving(true);
    try {
      await savePipelineSteps(steps);
      await loadData();
      setViewMode('status');
    } finally {
      setSaving(false);
    }
  };

  const handleAddStep = () => {
    const newStep: PipelineStep = {
      id: `step-${Date.now()}`,
      order: steps.length,
      name: 'New Step',
      description: 'Describe this step',
      prompt_injection: 'Prompt to inject...',
      mcps_enabled: [],
      tools_blocked: ['Write', 'Edit'],
      gate_type: 'any',
      gate_tool: '',
      gate_phrases: []
    };
    setEditingStep(newStep);
    setEditingIndex(steps.length);
    setViewMode('edit-step');
  };

  const handleEditStep = (step: PipelineStep, index: number) => {
    setEditingStep({ ...step });
    setEditingIndex(index);
    setViewMode('edit-step');
  };

  const handleDeleteStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    // Re-order
    newSteps.forEach((s, i) => s.order = i);
    setSteps(newSteps);
  };

  const handleSaveEditedStep = () => {
    if (!editingStep) return;

    const newSteps = [...steps];
    if (editingIndex >= steps.length) {
      newSteps.push(editingStep);
    } else {
      newSteps[editingIndex] = editingStep;
    }
    // Re-order
    newSteps.forEach((s, i) => s.order = i);
    setSteps(newSteps);
    setEditingStep(null);
    setEditingIndex(-1);
    setViewMode('steps');
  };

  const handleCancelEdit = () => {
    setEditingStep(null);
    setEditingIndex(-1);
    setViewMode('steps');
  };

  const getStepStatus = (index: number): 'completed' | 'current' | 'pending' => {
    if (!state) return 'pending';
    if (index < state.current_step) return 'completed';
    if (index === state.current_step) return 'current';
    return 'pending';
  };

  const renderStatusView = () => (
    <>
      {!isInstalled && (
        <div className="pipeline-warning">
          <AlertTriangle size={20} />
          <span>Pipeline controller not installed. Steps will be saved but won't execute.</span>
        </div>
      )}

      <div className="pipeline-status-header">
        <h3>Current Pipeline State</h3>
        <div className="pipeline-actions">
          <button
            className="btn-icon"
            onClick={handleReset}
            disabled={saving}
            title="Reset to Step 0"
          >
            <RotateCcw size={18} />
          </button>
          <button
            className="btn-icon"
            onClick={handleAdvance}
            disabled={saving || !state || state.current_step >= steps.length - 1}
            title="Advance to next step"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="pipeline-steps-status">
        {steps.map((step, index) => {
          const status = getStepStatus(index);
          return (
            <div key={step.id} className={`pipeline-step-status pipeline-step-${status}`}>
              <div className="pipeline-step-icon">
                {status === 'completed' && <CheckCircle2 size={20} />}
                {status === 'current' && <Play size={20} />}
                {status === 'pending' && <Circle size={20} />}
              </div>
              <div className="pipeline-step-info">
                <span className="pipeline-step-name">{step.name}</span>
                <span className="pipeline-step-desc">{step.description}</span>
              </div>
              {index < steps.length - 1 && (
                <div className="pipeline-step-arrow">
                  <ArrowRight size={16} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {state?.last_activity && (
        <div className="pipeline-info">
          <span>Last activity: {new Date(state.last_activity).toLocaleString()}</span>
        </div>
      )}

      <div className="pipeline-mode-switch">
        <button className="btn-secondary" onClick={() => setViewMode('steps')}>
          <Edit3 size={16} />
          Edit Steps
        </button>
      </div>
    </>
  );

  const renderStepsView = () => (
    <>
      <div className="pipeline-steps-header">
        <h3>Pipeline Steps</h3>
        <button className="btn-icon" onClick={handleAddStep} title="Add step">
          <Plus size={18} />
        </button>
      </div>

      <div className="pipeline-steps-list">
        {steps.map((step, index) => (
          <div key={step.id} className="pipeline-step-item">
            <div className="pipeline-step-order">{index}</div>
            <div className="pipeline-step-content">
              <div className="pipeline-step-header">
                <span className="pipeline-step-name">{step.name}</span>
                <span className={`pipeline-step-gate gate-${step.gate_type}`}>
                  {step.gate_type}
                </span>
              </div>
              <div className="pipeline-step-details">
                <span className="detail-label">MCPs:</span>
                <span className="detail-value">
                  {step.mcps_enabled.length > 0 ? step.mcps_enabled.join(', ') : 'none'}
                </span>
              </div>
              <div className="pipeline-step-details">
                <span className="detail-label">Blocked:</span>
                <span className="detail-value">
                  {step.tools_blocked.length > 0 ? step.tools_blocked.join(', ') : 'none'}
                </span>
              </div>
            </div>
            <div className="pipeline-step-actions">
              <button
                className="btn-icon-sm"
                onClick={() => handleEditStep(step, index)}
                title="Edit"
              >
                <Edit3 size={14} />
              </button>
              <button
                className="btn-icon-sm danger"
                onClick={() => handleDeleteStep(index)}
                title="Delete"
                disabled={steps.length <= 1}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="settings-actions">
        <button className="btn-secondary" onClick={() => setViewMode('status')}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleSaveSteps} disabled={saving}>
          {saving ? 'Saving...' : 'Save Steps'}
        </button>
      </div>
    </>
  );

  const renderEditStepView = () => {
    if (!editingStep) return null;

    return (
      <>
        <div className="pipeline-edit-header">
          <h3>{editingIndex >= steps.length ? 'Add Step' : 'Edit Step'}</h3>
        </div>

        <div className="settings-section">
          <label className="settings-label">Step ID</label>
          <input
            type="text"
            className="settings-input"
            value={editingStep.id}
            onChange={(e) => setEditingStep({ ...editingStep, id: e.target.value })}
            placeholder="unique-step-id"
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">Name</label>
          <input
            type="text"
            className="settings-input"
            value={editingStep.name}
            onChange={(e) => setEditingStep({ ...editingStep, name: e.target.value })}
            placeholder="Step Name"
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">Description</label>
          <input
            type="text"
            className="settings-input"
            value={editingStep.description}
            onChange={(e) => setEditingStep({ ...editingStep, description: e.target.value })}
            placeholder="What does this step do?"
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">Prompt Injection</label>
          <textarea
            className="settings-textarea"
            value={editingStep.prompt_injection}
            onChange={(e) => setEditingStep({ ...editingStep, prompt_injection: e.target.value })}
            placeholder="The prompt to inject when this step is active..."
            rows={5}
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">MCPs Enabled (comma-separated)</label>
          <input
            type="text"
            className="settings-input"
            value={editingStep.mcps_enabled.join(', ')}
            onChange={(e) => setEditingStep({
              ...editingStep,
              mcps_enabled: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
            })}
            placeholder="sequential-thinking, Context7, *"
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">Tools Blocked (comma-separated)</label>
          <input
            type="text"
            className="settings-input"
            value={editingStep.tools_blocked.join(', ')}
            onChange={(e) => setEditingStep({
              ...editingStep,
              tools_blocked: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
            })}
            placeholder="Write, Edit"
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">Gate Type</label>
          <div className="settings-radio-group">
            <label className="settings-radio-item">
              <input
                type="radio"
                name="gate-type"
                checked={editingStep.gate_type === 'any'}
                onChange={() => setEditingStep({ ...editingStep, gate_type: 'any' })}
              />
              <span>Any (tool OR phrase)</span>
            </label>
            <label className="settings-radio-item">
              <input
                type="radio"
                name="gate-type"
                checked={editingStep.gate_type === 'always'}
                onChange={() => setEditingStep({ ...editingStep, gate_type: 'always' })}
              />
              <span>Always (final step)</span>
            </label>
          </div>
        </div>

        {editingStep.gate_type === 'any' && (
          <>
            <div className="settings-section">
              <label className="settings-label">Gate Tool (prefix match)</label>
              <input
                type="text"
                className="settings-input"
                value={editingStep.gate_tool}
                onChange={(e) => setEditingStep({ ...editingStep, gate_tool: e.target.value })}
                placeholder="mcp__sequential-thinking__"
              />
            </div>

            <div className="settings-section">
              <label className="settings-label">Gate Phrases (comma-separated)</label>
              <input
                type="text"
                className="settings-input"
                value={editingStep.gate_phrases.join(', ')}
                onChange={(e) => setEditingStep({
                  ...editingStep,
                  gate_phrases: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                })}
                placeholder="tarea simple, procedo directamente"
              />
            </div>
          </>
        )}

        <div className="settings-actions">
          <button className="btn-secondary" onClick={handleCancelEdit}>
            <X size={16} />
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSaveEditedStep}>
            <Check size={16} />
            Save Step
          </button>
        </div>
      </>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pipeline Control">
      <div className="pipeline-modal">
        {loading ? (
          <div className="pipeline-loading">Loading pipeline...</div>
        ) : (
          <>
            {viewMode === 'status' && renderStatusView()}
            {viewMode === 'steps' && renderStepsView()}
            {viewMode === 'edit-step' && renderEditStepView()}
          </>
        )}
      </div>
    </Modal>
  );
}
