/**
 * WorkflowStepsBar - Horizontal bar showing workflow nodes
 * Shows current progress through the workflow.
 * Receives status as a prop from the parent (ControlBar/MainContent) to avoid
 * a redundant polling interval — ControlBar already fetches status.
 */

import { useCallback, memo } from 'react';
import type { WorkflowStatus } from '../../services/workflow/index';

interface WorkflowStepsBarProps {
  status: WorkflowStatus | null;
  onNodeClick?: (nodeId: string) => void;
}

export const WorkflowStepsBar = memo(function WorkflowStepsBar({ status, onNodeClick }: WorkflowStepsBarProps) {
  const handleNodeClick = useCallback((nodeId: string) => {
    onNodeClick?.(nodeId);
  }, [onNodeClick]);

  const getNodeStatus = (nodeId: string, currentNodeId: string | null): 'current' | 'completed' | 'pending' => {
    if (!status) return 'pending';
    if (nodeId === currentNodeId) return 'current';
    const idx = status.nodes.findIndex(n => n.id === nodeId);
    const currentIdx = status.nodes.findIndex(n => n.id === currentNodeId);
    if (idx < currentIdx) return 'completed';
    return 'pending';
  };

  if (!status || !status.graphName || status.nodes.length === 0) {
    return (
      <div className="workflow-steps-bar workflow-steps-bar--empty">
        No active workflow
      </div>
    );
  }

  return (
    <div className="workflow-steps-bar">
      {status.nodes.map((node, index) => {
        const nodeStatus = getNodeStatus(node.id, status.currentNode);
        const isLast = index === status.nodes.length - 1;
        const showVisits = node.visits > 1;
        const isNearMax = node.visits >= node.maxVisits - 2;

        return (
          <div key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className={`workflow-step workflow-step--${nodeStatus}`}
              onClick={() => handleNodeClick(node.id)}
              title={`${node.name} (${node.visits}/${node.maxVisits} visits)`}
            >
              <span className="workflow-step__indicator" />
              <span className="workflow-step__label">{node.name}</span>
              {showVisits && (
                <span className={`workflow-step__visits ${isNearMax ? 'workflow-step__visits--warning' : ''}`}>
                  {node.visits}
                </span>
              )}
            </button>

            {!isLast && (
              <div className={`workflow-step-connector ${nodeStatus === 'completed' ? 'workflow-step-connector--active' : ''}`}>
                <div className="workflow-step-connector__arrow" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
