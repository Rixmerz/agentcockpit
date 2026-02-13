import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import {
  getGraph,
  getGlobalGraph,
  getGraphState,
  saveGraphState,
  type PipelineState,
  type PipelineStep,
} from './pipelineIOService';

// ============================================
// Legacy Compatibility Layer
// ============================================

// Convert graph state to legacy pipeline state
export async function getPipelineState(projectPath?: string | null): Promise<PipelineState> {
  const graphState = await getGraphState(projectPath);
  const graph = await getGraph(projectPath);

  const currentNodeId = graphState.current_nodes[0];
  let currentStepIndex = 0;

  if (graph && currentNodeId) {
    currentStepIndex = graph.nodes.findIndex(n => n.id === currentNodeId);
    if (currentStepIndex === -1) currentStepIndex = 0;
  }

  // Convert execution path to step history
  const stepHistory = graphState.execution_path.map((entry) => {
    const fromIdx = graph?.nodes.findIndex(n => n.id === entry.from_node) ?? -1;
    const toIdx = graph?.nodes.findIndex(n => n.id === entry.to_node) ?? 0;
    return {
      from_step: fromIdx >= 0 ? fromIdx : 0,
      to_step: toIdx >= 0 ? toIdx : 0,
      timestamp: entry.timestamp,
      reason: entry.reason
    };
  });

  return {
    current_step: currentStepIndex,
    completed_steps: graphState.execution_path
      .filter(e => e.from_node !== null)
      .map(e => ({
        id: e.from_node || '',
        completed_at: e.timestamp,
        reason: e.reason
      })),
    session_id: null,
    started_at: graphState.execution_path[0]?.timestamp || null,
    last_activity: graphState.last_activity,
    step_history: stepHistory,
    active_pipeline: graphState.active_graph,
    current_node: currentNodeId,
    node_visits: graphState.node_visits
  };
}

export async function savePipelineState(_state: PipelineState, projectPath?: string | null): Promise<boolean> {
  // This is now handled through graph state
  // For legacy compatibility, we just save the graph state
  const graphState = await getGraphState(projectPath);
  graphState.last_activity = new Date().toISOString();
  return saveGraphState(graphState, projectPath);
}

// Convert graph nodes to legacy steps
export async function getPipelineSteps(projectPath?: string | null): Promise<PipelineStep[]> {
  const graph = await getGraph(projectPath);
  if (!graph) {
    return getDefaultSteps();
  }

  return graph.nodes.map((node, idx) => {
    // Find outgoing edges to determine gate info
    const outgoingEdges = graph.edges.filter(e => e.from === node.id);
    const toolEdge = outgoingEdges.find(e => e.condition.type === 'tool');
    const phraseEdge = outgoingEdges.find(e => e.condition.type === 'phrase');

    let gateType: 'any' | 'tool' | 'phrase' | 'always' = 'always';
    if (toolEdge && phraseEdge) gateType = 'any';
    else if (toolEdge) gateType = 'tool';
    else if (phraseEdge) gateType = 'phrase';
    else if (node.is_end) gateType = 'always';

    return {
      id: node.id,
      order: idx,
      name: node.name,
      description: '',
      prompt_injection: node.prompt_injection || '',
      mcps_enabled: node.mcps_enabled,
      tools_blocked: node.tools_blocked,
      gate_type: gateType,
      gate_tool: toolEdge?.condition.tool || '',
      gate_phrases: phraseEdge?.condition.phrases || [],
      is_start: node.is_start,
      is_end: node.is_end,
      max_visits: node.max_visits
    };
  });
}

export function getDefaultSteps(): PipelineStep[] {
  return [
    {
      id: 'complexity-check',
      order: 0,
      name: 'Complexity Gate',
      description: 'Evalua la complejidad de la tarea',
      prompt_injection: 'STEP 1: Evalua la complejidad antes de implementar.',
      mcps_enabled: ['sequential-thinking'],
      tools_blocked: ['Write', 'Edit'],
      gate_type: 'any',
      gate_tool: 'mcp__sequential-thinking__sequentialthinking',
      gate_phrases: ['trivial', 'simple'],
      is_start: true,
      is_end: false,
      max_visits: 5
    },
    {
      id: 'implementation',
      order: 1,
      name: 'Implementation',
      description: 'Implementa la solucion',
      prompt_injection: 'Todas las herramientas habilitadas.',
      mcps_enabled: ['*'],
      tools_blocked: [],
      gate_type: 'always',
      gate_tool: '',
      gate_phrases: [],
      is_start: false,
      is_end: true,
      max_visits: 10
    }
  ];
}

export async function getGlobalPipelineSteps(pipelineName: string): Promise<PipelineStep[]> {
  const graph = await getGlobalGraph(pipelineName);
  if (!graph) return [];

  return graph.nodes.map((node, idx) => {
    const outgoingEdges = graph.edges.filter(e => e.from === node.id);
    const toolEdge = outgoingEdges.find(e => e.condition.type === 'tool');
    const phraseEdge = outgoingEdges.find(e => e.condition.type === 'phrase');

    let gateType: 'any' | 'tool' | 'phrase' | 'always' = 'always';
    if (toolEdge && phraseEdge) gateType = 'any';
    else if (toolEdge) gateType = 'tool';
    else if (phraseEdge) gateType = 'phrase';

    return {
      id: node.id,
      order: idx,
      name: node.name,
      description: '',
      prompt_injection: node.prompt_injection || '',
      mcps_enabled: node.mcps_enabled,
      tools_blocked: node.tools_blocked,
      gate_type: gateType,
      gate_tool: toolEdge?.condition.tool || '',
      gate_phrases: phraseEdge?.condition.phrases || [],
      is_start: node.is_start,
      is_end: node.is_end,
      max_visits: node.max_visits
    };
  });
}

// ============================================
// Settings & MCPs
// ============================================

export interface PipelineSettings {
  reset_policy: 'manual' | 'timeout' | 'per_session';
  timeout_minutes: number;
  force_sequential: boolean;
}

export async function getPipelineSettings(_projectPath?: string | null): Promise<PipelineSettings> {
  return {
    reset_policy: 'timeout',
    timeout_minutes: 30,
    force_sequential: true
  };
}

export async function savePipelineSettings(_settings: PipelineSettings, _projectPath?: string | null): Promise<boolean> {
  // Settings are now embedded in the graph YAML
  // For now, return true as a no-op
  return true;
}

export async function savePipelineSteps(_steps: PipelineStep[], _projectPath?: string | null): Promise<boolean> {
  // Converting steps to graph format would require significant work
  // For now, this is a no-op - use graph YAML directly
  console.warn('[Graph] savePipelineSteps is deprecated. Edit graph.yaml directly.');
  return true;
}

export interface AvailableMcp {
  name: string;
  source: 'claude_desktop' | 'claude_code';
  command?: string;
}

export const STANDARD_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'Task', 'TodoWrite',
  'NotebookEdit', 'AskUserQuestion'
];

export async function getAvailableMcps(): Promise<AvailableMcp[]> {
  const mcps: AvailableMcp[] = [{ name: '*', source: 'claude_desktop' }];

  try {
    const home = await homeDir();
    const claudeDesktopPath = `${home}/Library/Application Support/Claude/claude_desktop_config.json`;

    const desktopExists = await exists(claudeDesktopPath);
    if (desktopExists) {
      const content = await readTextFile(claudeDesktopPath);
      const config = JSON.parse(content);

      if (config.mcpServers) {
        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
          mcps.push({
            name,
            source: 'claude_desktop',
            command: (serverConfig as { command?: string }).command
          });
        }
      }
    }
  } catch (e) {
    console.error('[Graph] Error reading MCPs:', e);
  }

  return mcps;
}
