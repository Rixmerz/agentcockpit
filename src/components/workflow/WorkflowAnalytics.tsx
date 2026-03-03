import { useState, useEffect } from 'react';
import {
  BarChart3,
  Clock,
  Repeat,
  AlertTriangle,
  Activity,
  TrendingUp,
} from 'lucide-react';
import type { WorkflowGraph, GraphState, GraphNode } from '../../services/workflowService';
import { getGraph, getGraphState } from '../../services/workflowService';

export interface WorkflowAnalytics {
  totalTransitions: number;
  totalDuration: number;
  nodeStats: Array<{
    id: string;
    name: string;
    visits: number;
    maxVisits: number;
    avgDuration: number;
    toolCalls?: number;
    maxToolCalls?: number;
  }>;
  transitionHistory: Array<{
    from: string | null;
    to: string;
    timestamp: string;
    reason: string;
    duration: number;
  }>;
  loops: Array<{
    nodeId: string;
    name: string;
    visits: number;
    isExcessive: boolean;
  }>;
}

function computeAnalytics(graph: WorkflowGraph, state: GraphState): WorkflowAnalytics | null {
  if (!state.execution_path || state.execution_path.length === 0) return null;

  const transitionHistory = state.execution_path.map((entry, i) => {
    const nextEntry = state.execution_path[i + 1];
    const currentTime = new Date(entry.timestamp).getTime();
    const nextTime = nextEntry ? new Date(nextEntry.timestamp).getTime() : Date.now();
    return {
      from: entry.from_node,
      to: entry.to_node,
      timestamp: entry.timestamp,
      reason: entry.reason,
      duration: nextTime - currentTime,
    };
  });

  const nodeStats = graph.nodes.map(node => {
    const visits = state.node_visits[node.id] || 0;
    const nodeTransitions = transitionHistory.filter(t => t.to === node.id);
    const totalTime = nodeTransitions.reduce((sum, t) => sum + t.duration, 0);
    return {
      id: node.id,
      name: node.name,
      visits,
      maxVisits: node.max_visits || 10,
      avgDuration: nodeTransitions.length > 0 ? totalTime / nodeTransitions.length : 0,
      toolCalls: (state as GraphState & { node_tool_calls?: Record<string, number> }).node_tool_calls?.[node.id],
      maxToolCalls: (node as GraphNode & { max_tool_calls?: number }).max_tool_calls,
    };
  });

  const loops = nodeStats
    .filter(n => n.visits > 1)
    .map(n => ({
      nodeId: n.id,
      name: n.name,
      visits: n.visits,
      isExcessive: n.visits > n.maxVisits * 0.5,
    }));

  const firstTime = new Date(state.execution_path[0].timestamp).getTime();
  const lastTime = state.last_activity
    ? new Date(state.last_activity).getTime()
    : Date.now();

  return {
    totalTransitions: state.total_transitions,
    totalDuration: lastTime - firstTime,
    nodeStats,
    transitionHistory,
    loops,
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function getHeatColor(ratio: number): string {
  if (ratio <= 0.2) return '#22c55e';
  if (ratio <= 0.5) return '#eab308';
  if (ratio <= 0.8) return '#f97316';
  return '#ef4444';
}

interface WorkflowAnalyticsViewProps {
  projectPath?: string | null;
}

export function WorkflowAnalyticsView({ projectPath }: WorkflowAnalyticsViewProps) {
  const [analytics, setAnalytics] = useState<WorkflowAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const graph = await getGraph(projectPath);
        const state = await getGraphState(projectPath);
        if (graph && state) {
          setAnalytics(computeAnalytics(graph, state));
          setCurrentNodeId(state.current_nodes?.[0] || null);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    }
    load();
  }, [projectPath]);

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading analytics...</div>;
  }

  if (!analytics) {
    return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No workflow data available yet.</div>;
  }

  const maxVisitsInNodes = Math.max(...analytics.nodeStats.map(n => n.visits), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        <div style={{
          background: 'var(--bg-secondary, #1e1e2e)',
          borderRadius: '8px',
          padding: '12px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary, #cdd6f4)' }}>
            {analytics.totalTransitions}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted, #6c7086)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Activity size={10} /> Transitions
          </div>
        </div>
        <div style={{
          background: 'var(--bg-secondary, #1e1e2e)',
          borderRadius: '8px',
          padding: '12px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary, #cdd6f4)' }}>
            {formatDuration(analytics.totalDuration)}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted, #6c7086)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Clock size={10} /> Total Duration
          </div>
        </div>
        <div style={{
          background: 'var(--bg-secondary, #1e1e2e)',
          borderRadius: '8px',
          padding: '12px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '20px', fontWeight: 600, color: analytics.loops.some(l => l.isExcessive) ? '#f97316' : 'var(--text-primary, #cdd6f4)' }}>
            {analytics.loops.length}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted, #6c7086)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Repeat size={10} /> Loops Detected
          </div>
        </div>
      </div>

      {/* Node Heatmap */}
      <div>
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary, #cdd6f4)' }}>
          <BarChart3 size={14} /> Node Activity
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {analytics.nodeStats.map(node => {
            const visitRatio = node.visits / node.maxVisits;
            const barWidth = (node.visits / maxVisitsInNodes) * 100;
            const isCurrent = node.id === currentNodeId;
            return (
              <div key={node.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                borderRadius: '4px',
                background: isCurrent ? 'rgba(137, 180, 250, 0.1)' : 'transparent',
                border: isCurrent ? '1px solid rgba(137, 180, 250, 0.3)' : '1px solid transparent',
              }}>
                <div style={{
                  width: '120px',
                  fontSize: '11px',
                  color: isCurrent ? '#89b4fa' : 'var(--text-secondary, #a6adc8)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flexShrink: 0,
                }} title={node.name}>
                  {node.name}
                </div>
                <div style={{ flex: 1, height: '14px', background: 'var(--bg-tertiary, #313244)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(barWidth, 2)}%`,
                    height: '100%',
                    background: getHeatColor(visitRatio),
                    borderRadius: '3px',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                <div style={{ width: '48px', fontSize: '10px', color: 'var(--text-muted, #6c7086)', textAlign: 'right', flexShrink: 0 }}>
                  {node.visits}/{node.maxVisits}
                </div>
                {node.toolCalls != null && node.maxToolCalls != null && node.maxToolCalls > 0 && (
                  <div style={{ width: '48px', fontSize: '10px', color: '#89b4fa', textAlign: 'right', flexShrink: 0 }} title="Tool calls">
                    T:{node.toolCalls}/{node.maxToolCalls}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Loops Warning */}
      {analytics.loops.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary, #cdd6f4)' }}>
            <AlertTriangle size={14} /> Loop Analysis
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {analytics.loops.map(loop => (
              <div key={loop.nodeId} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: loop.isExcessive ? 'rgba(249, 115, 22, 0.1)' : 'rgba(234, 179, 8, 0.05)',
                border: `1px solid ${loop.isExcessive ? 'rgba(249, 115, 22, 0.3)' : 'rgba(234, 179, 8, 0.15)'}`,
                fontSize: '11px',
              }}>
                <Repeat size={12} style={{ color: loop.isExcessive ? '#f97316' : '#eab308', flexShrink: 0 }} />
                <span style={{ color: 'var(--text-secondary, #a6adc8)', flex: 1 }}>{loop.name}</span>
                <span style={{ color: loop.isExcessive ? '#f97316' : '#eab308', fontWeight: 600 }}>{loop.visits}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transition Timeline */}
      <div>
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary, #cdd6f4)' }}>
          <TrendingUp size={14} /> Transition Timeline
        </div>
        <div style={{
          maxHeight: '250px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}>
          {analytics.transitionHistory.map((t, i) => {
            const time = new Date(t.timestamp);
            const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
            const isLast = i === analytics.transitionHistory.length - 1;
            return (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                fontSize: '10px',
                padding: '3px 0',
              }}>
                {/* Timeline dot and line */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: isLast ? '#89b4fa' : 'var(--text-muted, #6c7086)',
                    marginTop: '4px',
                  }} />
                  {!isLast && (
                    <div style={{ width: '1px', height: '16px', background: 'var(--border-color, #45475a)' }} />
                  )}
                </div>
                {/* Time */}
                <div style={{ width: '52px', color: 'var(--text-muted, #6c7086)', flexShrink: 0, fontFamily: 'monospace' }}>
                  {timeStr}
                </div>
                {/* Transition info */}
                <div style={{ flex: 1, color: 'var(--text-secondary, #a6adc8)', overflow: 'hidden' }}>
                  <span style={{ color: isLast ? '#89b4fa' : 'inherit' }}>
                    {t.from ? `${t.from}` : 'start'} → {t.to}
                  </span>
                </div>
                {/* Duration */}
                <div style={{ width: '50px', color: 'var(--text-muted, #6c7086)', textAlign: 'right', flexShrink: 0 }}>
                  {formatDuration(t.duration)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
