/**
 * Phase 6: Demo Execution Launcher
 *
 * UI component to trigger demo executions for testing and demonstration.
 * Shows progress and results in the ExecutionMonitorPanel.
 */

import { useState } from 'react';
import { Play, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { integrationExecutionDemo } from '../../services/integrationExecutionDemo';
import './DemoExecutionLauncher.css';

interface DemoExecutionLauncherProps {
  projectPath: string | null;
}

type DemoType = 'quick' | 'full' | 'failed' | 'timeout';

interface DemoOption {
  type: DemoType;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const DEMO_OPTIONS: DemoOption[] = [
  {
    type: 'quick',
    label: 'Quick Test',
    description: 'Fast demo (1.2s) - Good for validation',
    icon: <Play size={14} />
  },
  {
    type: 'full',
    label: 'Full Demo',
    description: 'Complete workflow (6s) - Shows all stages',
    icon: <Play size={14} />
  },
  {
    type: 'failed',
    label: 'Failed Execution',
    description: 'Demo error handling and recovery',
    icon: <AlertCircle size={14} />
  },
  {
    type: 'timeout',
    label: 'Timeout Demo',
    description: 'Demo timeout handling (2s)',
    icon: <AlertCircle size={14} />
  }
];

export function DemoExecutionLauncher({ projectPath }: DemoExecutionLauncherProps) {
  const [running, setRunning] = useState(false);
  const [selectedDemo, setSelectedDemo] = useState<DemoType | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);

  const handleRunDemo = async (demoType: DemoType) => {
    if (!projectPath) {
      alert('Please select a project first');
      return;
    }

    setRunning(true);
    setSelectedDemo(demoType);

    try {
      let result;

      switch (demoType) {
        case 'full':
          result = await integrationExecutionDemo.fullDemo(projectPath);
          break;
        case 'failed':
          result = await integrationExecutionDemo.failedExecutionDemo(projectPath);
          break;
        case 'timeout':
          result = await integrationExecutionDemo.timeoutExecutionDemo(projectPath);
          break;
        case 'quick':
        default:
          result = await integrationExecutionDemo.quickTest(projectPath);
          break;
      }

      setLastResult({
        ...result,
        timestamp: new Date().toLocaleTimeString()
      });

      console.log('[DemoLauncher] Demo completed:', result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[DemoLauncher] Demo failed:', msg);
      setLastResult({
        success: false,
        executionId: 'error',
        duration: 0,
        message: `Demo failed: ${msg}`,
        stages: [],
        timestamp: new Date().toLocaleTimeString()
      });
    } finally {
      setRunning(false);
      setSelectedDemo(null);
    }
  };

  return (
    <div className="demo-execution-launcher">
      <div className="launcher-header">
        <button
          className="launcher-title-btn"
          onClick={() => setExpanded(!expanded)}
        >
          <Play size={14} className="launcher-icon" />
          <span>Demo Executions</span>
          <span className={`expand-indicator ${expanded ? 'open' : ''}`}>▼</span>
        </button>
        <span className="launcher-hint">Test the full workflow</span>
      </div>

      {expanded && (
        <>
          <div className="demo-options">
            {DEMO_OPTIONS.map(option => (
              <button
                key={option.type}
                className={`demo-option ${
                  running && selectedDemo === option.type ? 'running' : ''
                } ${lastResult?.success && !running ? 'completed' : ''}`}
                onClick={() => handleRunDemo(option.type)}
                disabled={running || !projectPath}
                title={!projectPath ? 'Select a project first' : undefined}
              >
                <div className="demo-option-icon">
                  {running && selectedDemo === option.type ? (
                    <Loader size={14} className="spin" />
                  ) : (
                    option.icon
                  )}
                </div>
                <div className="demo-option-content">
                  <div className="demo-option-label">{option.label}</div>
                  <div className="demo-option-desc">{option.description}</div>
                </div>
                {running && selectedDemo === option.type && (
                  <span className="demo-status-badge">Running...</span>
                )}
              </button>
            ))}
          </div>

          {lastResult && (
            <div className={`demo-result ${lastResult.success ? 'success' : 'error'}`}>
              <div className="result-header">
                <div className="result-icon">
                  {lastResult.success ? (
                    <CheckCircle size={14} />
                  ) : (
                    <AlertCircle size={14} />
                  )}
                </div>
                <div className="result-title">
                  {lastResult.success ? 'Demo Completed' : 'Demo Failed'}
                </div>
                <span className="result-time">{lastResult.timestamp}</span>
              </div>

              <div className="result-details">
                <div className="result-row">
                  <span className="result-label">ID:</span>
                  <code className="result-value">
                    {lastResult.executionId.substring(0, 30)}...
                  </code>
                </div>
                <div className="result-row">
                  <span className="result-label">Duration:</span>
                  <span className="result-value">
                    {(lastResult.duration / 1000).toFixed(2)}s
                  </span>
                </div>
                <div className="result-row">
                  <span className="result-label">Stages:</span>
                  <span className="result-value">
                    {lastResult.stages.length} executed
                  </span>
                </div>
                <div className="result-row full">
                  <span className="result-label">Message:</span>
                  <span className="result-value">{lastResult.message}</span>
                </div>
              </div>

              <div className="result-hint">
                💡 Check the Execution Monitor above to view full details
              </div>
            </div>
          )}

          <div className="launcher-info">
            <div className="info-item">
              <span className="info-label">Purpose:</span>
              <span className="info-text">
                Run demo executions to test the wrapper system and verify state persistence
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">What Happens:</span>
              <span className="info-text">
                Demos simulate the full 6-stage wrapper execution and save state to
                ~/.agentcockpit/executions/
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Next Step:</span>
              <span className="info-text">
                After running a demo, check the Execution Monitor panel above to see
                results in real-time
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
