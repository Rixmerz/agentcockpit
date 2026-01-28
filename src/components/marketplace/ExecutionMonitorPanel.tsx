/**
 * Phase 6: Execution Monitor Dashboard
 *
 * Displays wrapper execution state and progress in real-time.
 * Shows:
 * - Current execution (if running)
 * - Past executions with status
 * - Detailed execution view with stages
 * - Progress percentage and agent status
 */

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Play, AlertCircle, CheckCircle, Clock, Loader } from 'lucide-react';
import type { WrapperExecutionState } from '../../services/wrapperStateService';
import { wrapperStateService } from '../../services/wrapperStateService';
import { agentfulIntegrationService } from '../../services/agentfulIntegrationService';
import './ExecutionMonitorPanel.css';

interface ExecutionListItemProps {
  execution: WrapperExecutionState;
  isSelected: boolean;
  onClick: () => void;
}

function ExecutionListItem({ execution, isSelected, onClick }: ExecutionListItemProps) {
  const duration = execution.endTime
    ? new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime()
    : new Date().getTime() - new Date(execution.startTime).getTime();

  const durationMin = Math.floor(duration / 60000);
  const durationSec = Math.floor((duration % 60000) / 1000);

  const getStatusIcon = () => {
    switch (execution.status) {
      case 'completed':
        return <CheckCircle size={14} className="status-icon status-completed" />;
      case 'failed':
        return <AlertCircle size={14} className="status-icon status-failed" />;
      case 'timeout':
        return <Clock size={14} className="status-icon status-timeout" />;
      case 'running':
        return <Loader size={14} className="status-icon status-running spin" />;
      default:
        return <Clock size={14} className="status-icon" />;
    }
  };

  return (
    <div
      className={`execution-list-item ${isSelected ? 'selected' : ''} status-${execution.status}`}
      onClick={onClick}
    >
      <div className="execution-item-header">
        <div className="execution-item-left">
          {getStatusIcon()}
          <span className="execution-id">{execution.executionId.substring(0, 20)}...</span>
        </div>
        <span className="execution-duration">
          {durationMin}m {durationSec}s
        </span>
      </div>
      <div className="execution-item-detail">
        <span className="execution-task">{execution.task.substring(0, 40)}</span>
        <span className="execution-stage">
          {execution.stages.length} stage{execution.stages.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}

interface ExecutionDetailProps {
  execution: WrapperExecutionState | null;
  projectPath: string | null;
}

function ExecutionDetail({ execution, projectPath }: ExecutionDetailProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-refresh progress for running executions
  useEffect(() => {
    if (!execution || execution.status !== 'running' || !projectPath) return;

    const refreshProgress = async () => {
      try {
        setRefreshing(true);
        const progressData = await agentfulIntegrationService.getAgentfulProgress();
        setProgress(progressData);
      } catch (err) {
        console.error('[ExecutionMonitor] Failed to get progress:', err);
      } finally {
        setRefreshing(false);
      }
    };

    refreshProgress();
    const interval = setInterval(refreshProgress, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, [execution, projectPath]);

  if (!execution) {
    return (
      <div className="execution-detail empty">
        <p>Select an execution to view details</p>
      </div>
    );
  }

  const duration = execution.endTime
    ? new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime()
    : new Date().getTime() - new Date(execution.startTime).getTime();

  const durationMin = Math.floor(duration / 60000);
  const durationSec = Math.floor((duration % 60000) / 1000);

  return (
    <div className="execution-detail">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-title">
          <h3>{execution.task}</h3>
          <span className={`detail-status status-${execution.status}`}>
            {execution.status.toUpperCase()}
          </span>
        </div>
        <div className="detail-meta">
          <div className="meta-row">
            <span className="meta-label">Integration:</span>
            <span className="meta-value">{execution.integrationId}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Execution ID:</span>
            <span className="meta-value font-mono">{execution.executionId}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Start:</span>
            <span className="meta-value">
              {new Date(execution.startTime).toLocaleString()}
            </span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Duration:</span>
            <span className="meta-value">
              {durationMin}m {durationSec}s
            </span>
          </div>
          {execution.exitSignal && (
            <div className="meta-row">
              <span className="meta-label">Exit Signal:</span>
              <span className="meta-value">{execution.exitSignal}</span>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar (for running executions) */}
      {execution.status === 'running' && progress && (
        <div className="progress-section">
          <div className="progress-header">
            <span className="progress-label">Execution Progress</span>
            <span className="progress-percent">{progress.percentComplete}%</span>
            {refreshing && <Loader size={12} className="spin" />}
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress.percentComplete}%` }}
            />
          </div>
          <div className="agent-status-grid">
            {Object.entries(progress.agentStatus).map(([agent, status]) => (
              <div key={agent} className="agent-status-item">
                <span className="agent-name">{agent}</span>
                <span className="agent-state">{String(status)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stages */}
      <div className="stages-section">
        <h4 className="stages-title">Execution Stages</h4>
        {execution.stages.map((stage, idx) => (
          <div key={idx} className={`stage-item stage-${stage.status}`}>
            <button
              className="stage-header"
              onClick={() =>
                setExpanded(prev => ({
                  ...prev,
                  [idx]: !prev[idx]
                }))
              }
            >
              <span className="stage-icon">
                {expanded[idx] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <span className="stage-name">{stage.stage}</span>
              <span className={`stage-status stage-status-${stage.status}`}>
                {stage.status}
              </span>
              <span className="stage-time">
                {new Date(stage.timestamp).toLocaleTimeString()}
              </span>
            </button>

            {expanded[idx] && (
              <div className="stage-details">
                {stage.details && (
                  <div className="stage-details-content">
                    <pre>{JSON.stringify(stage.details, null, 2)}</pre>
                  </div>
                )}
                {stage.error && (
                  <div className="stage-error">
                    <span className="error-label">Error:</span>
                    <span className="error-text">{stage.error}</span>
                  </div>
                )}
                {stage.duration && (
                  <div className="stage-duration">
                    Duration: {(stage.duration / 1000).toFixed(2)}s
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error (if failed) */}
      {execution.error && (
        <div className="error-section">
          <div className="error-header">
            <AlertCircle size={16} className="error-icon" />
            <span>Execution Error</span>
          </div>
          <div className="error-content">
            <pre>{execution.error}</pre>
          </div>
        </div>
      )}

      {/* Output */}
      {execution.output && (
        <div className="output-section">
          <h4 className="output-title">Execution Output</h4>
          <div className="output-content">
            <pre>{execution.output}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

interface ExecutionMonitorPanelProps {
  projectPath: string | null;
}

export function ExecutionMonitorPanel({ projectPath }: ExecutionMonitorPanelProps) {
  const [executions, setExecutions] = useState<WrapperExecutionState[]>([]);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load executions on mount and periodically refresh
  useEffect(() => {
    const loadExecutions = async () => {
      try {
        setLoading(true);
        setError(null);

        const executionIds = await wrapperStateService.listExecutions();
        const states: WrapperExecutionState[] = [];

        // Load state for each execution (newest first)
        for (const id of executionIds.reverse()) {
          const state = await wrapperStateService.loadState(id);
          if (state) {
            states.push(state);
          }
        }

        setExecutions(states);

        // Auto-select first running execution if available
        const running = states.find(s => s.status === 'running');
        if (running && !selectedExecutionId) {
          setSelectedExecutionId(running.executionId);
        } else if (states.length > 0 && !selectedExecutionId) {
          setSelectedExecutionId(states[0].executionId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load executions';
        setError(msg);
        console.error('[ExecutionMonitor] Error loading executions:', err);
      } finally {
        setLoading(false);
      }
    };

    loadExecutions();

    // Refresh every 5 seconds
    const interval = setInterval(loadExecutions, 5000);
    return () => clearInterval(interval);
  }, [selectedExecutionId]);

  const selectedExecution = executions.find(e => e.executionId === selectedExecutionId) || null;

  return (
    <div className="execution-monitor-panel">
      <div className="monitor-header">
        <div className="monitor-title">
          <Play size={16} className="title-icon" />
          <h3>Execution Monitor</h3>
        </div>
        <span className="monitor-count">
          {executions.length} execution{executions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {error && (
        <div className="monitor-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="monitor-content">
        {/* Executions List */}
        <div className="executions-list">
          <div className="list-header">Recent Executions</div>
          {loading && executions.length === 0 ? (
            <div className="list-loading">
              <Loader size={16} className="spin" />
              <span>Loading executions...</span>
            </div>
          ) : executions.length === 0 ? (
            <div className="list-empty">
              <p>No executions yet</p>
              <p className="list-hint">Run an integration workflow to see results here</p>
            </div>
          ) : (
            executions.map(execution => (
              <ExecutionListItem
                key={execution.executionId}
                execution={execution}
                isSelected={selectedExecution?.executionId === execution.executionId}
                onClick={() => setSelectedExecutionId(execution.executionId)}
              />
            ))
          )}
        </div>

        {/* Detail View */}
        <div className="execution-detail-panel">
          <ExecutionDetail execution={selectedExecution} projectPath={projectPath} />
        </div>
      </div>
    </div>
  );
}
