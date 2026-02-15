/**
 * PipelineStepsBar - Horizontal bar showing pipeline nodes
 * Shows current progress through the pipeline
 */

import { useEffect, useState, useCallback } from 'react';
import { pipelineService } from '../../services/pipelineService';

interface PipelineNode {
  id: string;
  name: string;
  visits: number;
  maxVisits: number;
}

interface PipelineStepsBarProps {
  projectPath: string | null;
  refreshKey?: number;
  onNodeClick?: (nodeId: string) => void;
}

export function PipelineStepsBar({ projectPath, refreshKey, onNodeClick }: PipelineStepsBarProps) {
  const [pipelineName, setPipelineName] = useState<string | null>(null);
  const [nodes, setNodes] = useState<PipelineNode[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [completedNodes, setCompletedNodes] = useState<Set<string>>(new Set());

  // Load pipeline status — RE-ENABLED for diagnostic V4
  useEffect(() => {
    setNodes([]);
    setCurrentNodeId(null);
    setPipelineName(null);
    setCompletedNodes(new Set());

    if (!projectPath) {
      return;
    }

    const loadStatus = async () => {
      try {
        const status = await pipelineService.getStatus(projectPath);
        if (!status || !status.nodes) {
          setNodes([]);
          setCurrentNodeId(null);
          setPipelineName(null);
          return;
        }

        setPipelineName(status.graphName || null);
        setCurrentNodeId(status.currentNode);

        const nodeList: PipelineNode[] = status.nodes.map((n: any) => ({
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
        console.warn('[PipelineStepsBar] Failed to load status:', err);
        setNodes([]);
        setCurrentNodeId(null);
        setPipelineName(null);
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
  const getNodeStatus = (node: PipelineNode): 'current' | 'completed' | 'pending' => {
    if (node.id === currentNodeId) return 'current';
    if (completedNodes.has(node.id)) return 'completed';
    return 'pending';
  };

  // Don't render if no pipeline
  if (!pipelineName || nodes.length === 0) {
    return (
      <div className="pipeline-steps-bar pipeline-steps-bar--empty">
        No active pipeline
      </div>
    );
  }

  return (
    <div className="pipeline-steps-bar">
      {/* Steps */}
      {nodes.map((node, index) => {
        const status = getNodeStatus(node);
        const isLast = index === nodes.length - 1;
        const showVisits = node.visits > 1;
        const isNearMax = node.visits >= node.maxVisits - 2;

        return (
          <div key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className={`pipeline-step pipeline-step--${status}`}
              onClick={() => handleNodeClick(node.id)}
              title={`${node.name} (${node.visits}/${node.maxVisits} visits)`}
            >
              <span className="pipeline-step__indicator" />
              <span className="pipeline-step__label">{node.name}</span>
              {showVisits && (
                <span className={`pipeline-step__visits ${isNearMax ? 'pipeline-step__visits--warning' : ''}`}>
                  {node.visits}
                </span>
              )}
            </button>

            {/* Connector arrow */}
            {!isLast && (
              <div className={`pipeline-step-connector ${status === 'completed' ? 'pipeline-step-connector--active' : ''}`}>
                <div className="pipeline-step-connector__arrow" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
