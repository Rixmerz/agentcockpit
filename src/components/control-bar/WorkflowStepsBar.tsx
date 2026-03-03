/**
 * WorkflowStepsBar - Horizontal bar showing workflow nodes
 * Shows current progress through the workflow
 */

import { useEffect, useState, useCallback } from 'react';
import { workflowService } from '../../services/workflowService';

interface WorkflowNode {
  id: string;
  name: string;
  visits: number;
  maxVisits: number;
}

interface WorkflowStepsBarProps {
  projectPath: string | null;
  refreshKey?: number;
  onNodeClick?: (nodeId: string) => void;
}

export function WorkflowStepsBar({ projectPath, refreshKey, onNodeClick }: WorkflowStepsBarProps) {
  const [workflowName, setWorkflowName] = useState<string | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [completedNodes, setCompletedNodes] = useState<Set<string>>(new Set());

  // Load workflow status — RE-ENABLED for diagnostic V4
  useEffect(() => {
    setNodes([]);
    setCurrentNodeId(null);
    setWorkflowName(null);
    setCompletedNodes(new Set());

    if (!projectPath) {
      return;
    }

    const loadStatus = async () => {
      try {
        const status = await workflowService.getStatus(projectPath);
        if (!status || !status.nodes) {
          setNodes([]);
          setCurrentNodeId(null);
          setWorkflowName(null);
          return;
        }

        setWorkflowName(status.graphName || null);
        setCurrentNodeId(status.currentNode);

        const nodeList: WorkflowNode[] = status.nodes.map((n: any) => ({
          id: n.id,
          name: n.name || n.id,
          visits: n.visits || 0,
          maxVisits: n.maxVisits || 10,
        }));

        setNodes(nodeList);

        const completed = new Set<string>();
        nodeList.forEach(n => {
          if (n.visits > 0 && n.id !== status.currentNode) {
            completed.add(n.id);
          }
        });
        setCompletedNodes(completed);
      } catch (err) {
        console.warn('[WorkflowStepsBar] Failed to load status:', err);
        setNodes([]);
        setCurrentNodeId(null);
        setWorkflowName(null);
      }
    };

    loadStatus();

    // Poll for updates every 2 seconds
    const interval = setInterval(loadStatus, 2000);
    return () => clearInterval(interval);
  }, [projectPath, refreshKey]);

  // Handle node click
  const handleNodeClick = useCallback((nodeId: string) => {
    onNodeClick?.(nodeId);
  }, [onNodeClick]);

  // Get node status class
  const getNodeStatus = (node: WorkflowNode): 'current' | 'completed' | 'pending' => {
    if (node.id === currentNodeId) return 'current';
    if (completedNodes.has(node.id)) return 'completed';
    return 'pending';
  };

  // Don't render if no workflow
  if (!workflowName || nodes.length === 0) {
    return (
      <div className="workflow-steps-bar workflow-steps-bar--empty">
        No active workflow
      </div>
    );
  }

  return (
    <div className="workflow-steps-bar">
      {/* Steps */}
      {nodes.map((node, index) => {
        const status = getNodeStatus(node);
        const isLast = index === nodes.length - 1;
        const showVisits = node.visits > 1;
        const isNearMax = node.visits >= node.maxVisits - 2;

        return (
          <div key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className={`workflow-step workflow-step--${status}`}
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

            {/* Connector arrow */}
            {!isLast && (
              <div className={`workflow-step-connector ${status === 'completed' ? 'workflow-step-connector--active' : ''}`}>
                <div className="workflow-step-connector__arrow" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
