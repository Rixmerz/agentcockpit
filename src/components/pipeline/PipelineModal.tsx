import { useState, useEffect, lazy, Suspense } from 'react';
import { Modal } from '../common/Modal';
import {
  getPipelineState,
  getPipelineSteps,
  savePipelineSteps,
  resetPipeline,
  advancePipeline,
  getPipelineSettings,
  savePipelineSettings,
  getAvailableMcps,
  STANDARD_TOOLS,
  getAvailableEdges,
  getGraphState,
  getGraphVisualization,
} from '../../services/pipelineService';
import type { GraphVisualization } from '../../services/pipelineService';

// Lazy load MermaidRenderer to avoid loading mermaid (~700kB) until needed
const MermaidRenderer = lazy(() => import('./MermaidRenderer').then(m => ({ default: m.MermaidRenderer })));
import type {
  PipelineState,
  PipelineStep,
  PipelineSettings,
  AvailableMcp,
  AvailableEdge,
  GraphState,
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
  CheckCircle2,
  Circle,
  ArrowRight,
  Settings2,
  Zap,
  Repeat,
  GitBranch,
} from 'lucide-react';

interface PipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath?: string | null;
}

type ViewMode = 'status' | 'graph' | 'steps' | 'edit-step' | 'settings';

export function PipelineModal({ isOpen, onClose, projectPath }: PipelineModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('status');
  const [state, setState] = useState<PipelineState | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [settings, setSettings] = useState<PipelineSettings | null>(null);
  const [availableMcps, setAvailableMcps] = useState<AvailableMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingStep, setEditingStep] = useState<PipelineStep | null>(null);
  const [editingIndex, setEditingIndex] = useState<number>(-1);

  // Graph-specific state
  const [graphState, setGraphState] = useState<GraphState | null>(null);
  const [availableEdges, setAvailableEdges] = useState<AvailableEdge[]>([]);
  const [graphViz, setGraphViz] = useState<GraphVisualization | null>(null);
  // selectedNode will be used for future node detail panel
  const [_selectedNode, setSelectedNode] = useState<string | null>(null);

  // Load data when modal opens
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pipelineState, pipelineSteps, pipelineSettings, mcps, gState, edges, viz] = await Promise.all([
        getPipelineState(projectPath),
        getPipelineSteps(projectPath),
        getPipelineSettings(projectPath),
        getAvailableMcps(),
        getGraphState(projectPath),
        getAvailableEdges(projectPath),
        getGraphVisualization(projectPath)
      ]);
      setState(pipelineState);
      setSteps(pipelineSteps);
      setSettings(pipelineSettings);
      setAvailableMcps(mcps);
      setGraphState(gState);
      setAvailableEdges(edges);
      setGraphViz(viz);
    } catch (e) {
      console.error('[PipelineModal] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await resetPipeline(projectPath);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleAdvance = async () => {
    setSaving(true);
    try {
      await advancePipeline(projectPath);
      await loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSteps = async () => {
    setSaving(true);
    try {
      await savePipelineSteps(steps, projectPath);
      await loadData();
      setViewMode('status');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await savePipelineSettings(settings, projectPath);
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

  const toggleMcp = (mcpName: string) => {
    if (!editingStep) return;
    const enabled = editingStep.mcps_enabled || [];

    // Special handling for "*" (All) - select/deselect all MCPs
    if (mcpName === '*') {
      if (enabled.includes('*')) {
        // Deselect all
        setEditingStep({
          ...editingStep,
          mcps_enabled: [],
          gate_tool: ''  // Clear gate_tool since no MCPs are enabled
        });
      } else {
        // Select all - add "*" and all individual MCPs
        const allMcpNames = availableMcps.map(m => m.name);
        setEditingStep({
          ...editingStep,
          mcps_enabled: allMcpNames
        });
      }
      return;
    }

    // Regular MCP toggle
    if (enabled.includes(mcpName)) {
      // When disabling an MCP, also clear gate_tool if it was using this MCP
      const newGateTool = editingStep.gate_tool?.includes(`mcp__${mcpName}__`)
        ? ''
        : editingStep.gate_tool;
      // Also remove "*" if it was selected (since we're now not selecting all)
      setEditingStep({
        ...editingStep,
        mcps_enabled: enabled.filter(m => m !== mcpName && m !== '*'),
        gate_tool: newGateTool
      });
    } else {
      setEditingStep({
        ...editingStep,
        mcps_enabled: [...enabled, mcpName]
      });
    }
  };

  const toggleTool = (toolName: string) => {
    if (!editingStep) return;
    const blocked = editingStep.tools_blocked || [];
    if (blocked.includes(toolName)) {
      setEditingStep({
        ...editingStep,
        tools_blocked: blocked.filter(t => t !== toolName)
      });
    } else {
      setEditingStep({
        ...editingStep,
        tools_blocked: [...blocked, toolName]
      });
    }
  };

  const getStepStatus = (index: number): 'completed' | 'current' | 'pending' => {
    if (!state) return 'pending';
    if (index < state.current_step) return 'completed';
    if (index === state.current_step) return 'current';
    return 'pending';
  };

  const renderStatusView = () => (
    <>
      <div className="pipeline-status-header">
        <h3>Pipeline Status</h3>
        <div className="pipeline-actions">
          <button
            className="btn-icon"
            onClick={() => setViewMode('settings')}
            title="Settings"
          >
            <Settings2 size={18} />
          </button>
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
          const visits = graphState?.node_visits[step.id] || 0;
          return (
            <div key={step.id} className={`pipeline-step-status pipeline-step-${status}`}>
              <div className="pipeline-step-icon">
                {status === 'completed' && <CheckCircle2 size={20} />}
                {status === 'current' && <Play size={20} />}
                {status === 'pending' && <Circle size={20} />}
              </div>
              <div className="pipeline-step-info">
                <span className="pipeline-step-name">{step.name}</span>
                <span className="pipeline-step-desc">
                  {step.description || (Array.isArray(step.mcps_enabled) ? step.mcps_enabled.join(', ') : '') || 'No description'}
                </span>
                {/* Show visit count for graph nodes */}
                {visits > 0 && (
                  <span className="pipeline-step-visits">
                    <Repeat size={10} />
                    {visits}/{step.max_visits || 10}
                  </span>
                )}
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

      {/* Available edges for current node */}
      {availableEdges.length > 0 && (
        <div className="pipeline-edges-modal">
          <h4><GitBranch size={14} /> Available Transitions</h4>
          <div className="pipeline-edges-grid">
            {availableEdges.map((edge) => (
              <div key={edge.id} className="pipeline-edge-card">
                <span className="edge-target">{edge.toName}</span>
                <span className="edge-condition-type">{edge.conditionType}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {settings && (
        <div className="pipeline-config-summary">
          <span className="config-badge">{settings.reset_policy}</span>
          {settings.reset_policy === 'timeout' && (
            <span className="config-badge">{settings.timeout_minutes}min</span>
          )}
          {settings.force_sequential && (
            <span className="config-badge">sequential</span>
          )}
        </div>
      )}

      {state?.last_activity && (
        <div className="pipeline-info">
          <span>Last: {new Date(state.last_activity).toLocaleString()}</span>
        </div>
      )}

      <div className="pipeline-mode-switch">
        <button className="btn-secondary" onClick={() => setViewMode('graph')}>
          <GitBranch size={16} />
          View Graph
        </button>
        <button className="btn-secondary" onClick={() => setViewMode('steps')}>
          <Edit3 size={16} />
          Edit Steps
        </button>
      </div>
    </>
  );

  const handleNodeClick = (nodeId: string) => {
    setSelectedNode(nodeId);
    // Find the step/node by id
    const step = steps.find(s => s.id === nodeId);
    if (step) {
      const index = steps.indexOf(step);
      handleEditStep(step, index);
    }
  };

  const renderGraphView = () => (
    <>
      <div className="pipeline-graph-header">
        <h3>
          <GitBranch size={18} />
          Graph View
          {graphViz?.graphName && <span className="graph-name">{graphViz.graphName}</span>}
        </h3>
        <div className="pipeline-actions">
          <button
            className="btn-icon"
            onClick={handleReset}
            disabled={saving}
            title="Reset to start"
          >
            <RotateCcw size={18} />
          </button>
          <button
            className="btn-icon"
            onClick={() => setViewMode('settings')}
            title="Settings"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </div>

      <div className="pipeline-graph-container">
        {graphViz?.mermaid && (
          <Suspense fallback={<div className="mermaid-loading">Loading graph...</div>}>
            <MermaidRenderer
              chart={graphViz.mermaid}
              onNodeClick={handleNodeClick}
            />
          </Suspense>
        )}
      </div>

      {/* Current node info */}
      {graphViz?.currentNode && (
        <div className="pipeline-current-node-info">
          <span className="current-node-label">Current:</span>
          <span className="current-node-name">
            {steps.find(s => s.id === graphViz.currentNode)?.name || graphViz.currentNode}
          </span>
          {graphState && (
            <span className="current-node-visits">
              <Repeat size={12} />
              {graphState.node_visits[graphViz.currentNode] || 0} visits
            </span>
          )}
        </div>
      )}

      {/* Available transitions */}
      {availableEdges.length > 0 && (
        <div className="pipeline-edges-section">
          <h4>Available Transitions</h4>
          <div className="pipeline-edges-list">
            {availableEdges.map((edge) => (
              <div key={edge.id} className="pipeline-edge-item">
                <ArrowRight size={14} />
                <span className="edge-target">{edge.toName}</span>
                <span className={`edge-condition edge-${edge.conditionType}`}>
                  {edge.conditionType}
                  {edge.conditionType === 'tool' && edge.conditionTool && (
                    <small>{edge.conditionTool.split('__').pop()}</small>
                  )}
                  {edge.conditionType === 'phrase' && edge.conditionPhrases?.[0] && (
                    <small>"{edge.conditionPhrases[0]}"</small>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pipeline-mode-switch">
        <button className="btn-secondary" onClick={() => setViewMode('status')}>
          <Play size={16} />
          Status View
        </button>
        <button className="btn-secondary" onClick={() => setViewMode('steps')}>
          <Edit3 size={16} />
          Edit Nodes
        </button>
      </div>
    </>
  );

  const renderSettingsView = () => {
    if (!settings) return null;

    return (
      <>
        <div className="pipeline-edit-header">
          <h3>Pipeline Settings</h3>
        </div>

        <div className="settings-section">
          <label className="settings-label">Reset Policy</label>
          <div className="settings-radio-group">
            <label className="settings-radio-item">
              <input
                type="radio"
                name="reset-policy"
                checked={settings.reset_policy === 'manual'}
                onChange={() => setSettings({ ...settings, reset_policy: 'manual' })}
              />
              <div>
                <span>Manual</span>
                <small>Only reset with explicit command</small>
              </div>
            </label>
            <label className="settings-radio-item">
              <input
                type="radio"
                name="reset-policy"
                checked={settings.reset_policy === 'timeout'}
                onChange={() => setSettings({ ...settings, reset_policy: 'timeout' })}
              />
              <div>
                <span>Timeout</span>
                <small>Reset after inactivity period</small>
              </div>
            </label>
            <label className="settings-radio-item">
              <input
                type="radio"
                name="reset-policy"
                checked={settings.reset_policy === 'per_session'}
                onChange={() => setSettings({ ...settings, reset_policy: 'per_session' })}
              />
              <div>
                <span>Per Session</span>
                <small>Reset on each new Claude session</small>
              </div>
            </label>
          </div>
        </div>

        {settings.reset_policy === 'timeout' && (
          <div className="settings-section">
            <label className="settings-label">Timeout (minutes)</label>
            <input
              type="number"
              className="settings-input"
              value={settings.timeout_minutes}
              onChange={(e) => setSettings({
                ...settings,
                timeout_minutes: parseInt(e.target.value, 10) || 30
              })}
              min={1}
              max={1440}
            />
          </div>
        )}

        <div className="settings-section">
          <label className="settings-checkbox-item">
            <input
              type="checkbox"
              checked={settings.force_sequential}
              onChange={(e) => setSettings({
                ...settings,
                force_sequential: e.target.checked
              })}
            />
            <div>
              <span>Force Sequential</span>
              <small>Complete all steps in one turn</small>
            </div>
          </label>
        </div>

        <div className="settings-actions">
          <button className="btn-secondary" onClick={() => setViewMode('status')}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSaveSettings} disabled={saving}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </>
    );
  };

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
                  {Array.isArray(step.mcps_enabled) && step.mcps_enabled.length > 0 ? step.mcps_enabled.join(', ') : 'none'}
                </span>
              </div>
              <div className="pipeline-step-details">
                <span className="detail-label">Blocked:</span>
                <span className="detail-value">
                  {Array.isArray(step.tools_blocked) && step.tools_blocked.length > 0 ? step.tools_blocked.join(', ') : 'none'}
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
            rows={4}
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">
            <Zap size={14} style={{ marginRight: '4px' }} />
            MCPs Enabled
          </label>
          <div className="pipeline-checkbox-grid">
            {availableMcps.map(mcp => (
              <label key={mcp.name} className="pipeline-checkbox-item">
                <input
                  type="checkbox"
                  checked={(editingStep.mcps_enabled || []).includes(mcp.name)}
                  onChange={() => toggleMcp(mcp.name)}
                />
                <span className={mcp.name === '*' ? 'mcp-wildcard' : ''}>
                  {mcp.name === '*' ? '* (All)' : mcp.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <label className="settings-label">Tools Blocked</label>
          <div className="pipeline-checkbox-grid">
            {STANDARD_TOOLS.map(tool => (
              <label key={tool} className="pipeline-checkbox-item">
                <input
                  type="checkbox"
                  checked={(editingStep.tools_blocked || []).includes(tool)}
                  onChange={() => toggleTool(tool)}
                />
                <span>{tool}</span>
              </label>
            ))}
          </div>
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
              <div>
                <span>Any</span>
                <small>Advance when tool used OR phrase detected</small>
              </div>
            </label>
            <label className="settings-radio-item">
              <input
                type="radio"
                name="gate-type"
                checked={editingStep.gate_type === 'tool'}
                onChange={() => setEditingStep({ ...editingStep, gate_type: 'tool' })}
              />
              <div>
                <span>Tool</span>
                <small>Advance only when specific tool is used</small>
              </div>
            </label>
            <label className="settings-radio-item">
              <input
                type="radio"
                name="gate-type"
                checked={editingStep.gate_type === 'phrase'}
                onChange={() => setEditingStep({ ...editingStep, gate_type: 'phrase' })}
              />
              <div>
                <span>Phrase</span>
                <small>Advance only when phrase is detected</small>
              </div>
            </label>
            <label className="settings-radio-item">
              <input
                type="radio"
                name="gate-type"
                checked={editingStep.gate_type === 'always'}
                onChange={() => setEditingStep({ ...editingStep, gate_type: 'always' })}
              />
              <div>
                <span>Always</span>
                <small>Final step, no advancement</small>
              </div>
            </label>
          </div>
        </div>

        {(editingStep.gate_type === 'any' || editingStep.gate_type === 'tool') && (
          <div className="settings-section">
            <label className="settings-label">Gate Tool</label>
            <select
              className="settings-input"
              value={editingStep.gate_tool}
              onChange={(e) => setEditingStep({ ...editingStep, gate_tool: e.target.value })}
            >
              <option value="">Select a tool...</option>
              {availableMcps
                .filter(m => m.name !== '*' && (editingStep.mcps_enabled || []).includes(m.name))
                .map(mcp => (
                  <option key={mcp.name} value={`mcp__${mcp.name}__`}>
                    mcp__{mcp.name}__
                  </option>
                ))}
            </select>
            <small className="settings-hint">
              Tool prefix that triggers advancement when used (only shows enabled MCPs)
            </small>
          </div>
        )}

        {(editingStep.gate_type === 'any' || editingStep.gate_type === 'phrase') && (
          <div className="settings-section">
            <label className="settings-label">Gate Phrases</label>
            <input
              type="text"
              className="settings-input"
              value={(editingStep.gate_phrases || []).join(', ')}
              onChange={(e) => setEditingStep({
                ...editingStep,
                gate_phrases: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              })}
              placeholder="tarea simple, procedo directamente"
            />
            <small className="settings-hint">
              Comma-separated phrases that trigger advancement
            </small>
          </div>
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
            {viewMode === 'graph' && renderGraphView()}
            {viewMode === 'settings' && renderSettingsView()}
            {viewMode === 'steps' && renderStepsView()}
            {viewMode === 'edit-step' && renderEditStepView()}
          </>
        )}
      </div>
    </Modal>
  );
}
