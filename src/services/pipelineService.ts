import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs';
import { generatePipelineSkill } from './hookService';

// ============================================
// Graph-Based Pipeline Types (v2.0)
// ============================================

export interface EdgeCondition {
  type: 'tool' | 'phrase' | 'always' | 'default';
  tool?: string;
  phrases?: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  condition: EdgeCondition;
  priority: number;
}

export interface GraphNode {
  id: string;
  name: string;
  mcps_enabled?: string[];
  tools_blocked?: string[];
  prompt_injection?: string;
  is_start?: boolean;
  is_end?: boolean;
  max_visits?: number;
  model?: string;
}

export interface GraphMetadata {
  name: string;
  description?: string;
  version: string;
  type: 'graph';
  agents_required?: string[];
  mcps_required?: string[];
  architecture?: string;
}

export interface PipelineGraph {
  metadata: GraphMetadata;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathEntry {
  from_node: string | null;
  to_node: string;
  edge_id: string | null;
  timestamp: string;
  reason: string;
}

export interface GraphState {
  current_nodes: string[];
  node_visits: Record<string, number>;
  execution_path: PathEntry[];
  active_graph: string | null;
  max_visits_default: number;
  total_transitions: number;
  last_activity: string | null;
}

// Legacy compatibility - maps to graph concepts
export interface PipelineState {
  current_step: number;  // Maps to index of current node in nodes array
  completed_steps: { id: string; completed_at: string; reason: string }[];
  session_id: string | null;
  started_at: string | null;
  last_activity: string | null;
  step_history: { from_step: number; to_step: number; timestamp: string; reason: string }[];
  active_pipeline?: string | null;
  pipeline_version?: string | null;
  pipeline_source?: 'local' | 'global' | null;
  // Graph-specific fields
  current_node?: string;
  node_visits?: Record<string, number>;
}

// Legacy compatibility
export interface PipelineStep {
  id: string;
  order: number;
  name: string;
  description?: string;
  prompt_injection?: string;
  mcps_enabled?: string[];
  tools_blocked?: string[];
  gate_type?: 'any' | 'tool' | 'phrase' | 'always';
  gate_tool?: string;
  gate_phrases?: string[];
  // Graph-specific
  is_start?: boolean;
  is_end?: boolean;
  max_visits?: number;
  model?: string;
}

// ============================================
// Path Constants
// ============================================

const PIPELINE_DIR = '.claude/pipeline';
const GRAPH_STATE_FILE = 'graph_state.json';
const GRAPH_FILE = 'graph.yaml';
const AGENTCOCKPIT_CONFIG = '.agentcockpit/config.json';

let cachedHomeDir: string | null = null;
let cachedHubConfig: { hub_dir: string; pipelines_dir: string; states_dir: string } | null = null;

// ============================================
// Hub Configuration (Centralized Architecture)
// ============================================

interface HubConfig {
  hub_dir: string;
  pipelines_dir: string;
  states_dir: string;
  agents_dir?: string;
  skills_dir?: string;
}

async function getHubConfig(): Promise<HubConfig | null> {
  if (cachedHubConfig) return cachedHubConfig;

  try {
    if (!cachedHomeDir) {
      const home = await homeDir();
      if (!home) return null;
      cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
    }

    const configPath = `${cachedHomeDir}/${AGENTCOCKPIT_CONFIG}`;
    const configExists = await exists(configPath);
    if (!configExists) return null;

    const content = await readTextFile(configPath);
    const config = JSON.parse(content);

    cachedHubConfig = {
      hub_dir: config.hub_dir,
      pipelines_dir: config.pipelines_dir || '.claude/pipelines',
      states_dir: config.states_dir || '.agentcockpit/states'
    };

    return cachedHubConfig;
  } catch (e) {
    console.error('[Graph] Error reading hub config:', e);
    return null;
  }
}

// ============================================
// Path Helpers
// ============================================

// Get local pipeline dir (for graph.yaml - active graph copy)
async function getLocalPipelineDir(projectPath?: string | null): Promise<string> {
  if (projectPath) {
    const normalizedPath = projectPath.endsWith('/') ? projectPath.slice(0, -1) : projectPath;
    return `${normalizedPath}/${PIPELINE_DIR}`;
  }

  if (!cachedHomeDir) {
    const home = await homeDir();
    if (!home) throw new Error('Could not determine home directory');
    cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
  }

  return `${cachedHomeDir}/${PIPELINE_DIR}`;
}

// Get centralized state dir (for graph_state.json, config.json)
async function getCentralizedStateDir(projectPath?: string | null): Promise<string> {
  const hubConfig = await getHubConfig();

  if (hubConfig && projectPath) {
    // Extract project name from path
    const projectName = projectPath.split('/').filter(Boolean).pop() || 'default';
    const stateDir = `${hubConfig.hub_dir}/${hubConfig.states_dir}/${projectName}`;

    // Ensure directory exists
    try {
      const dirExists = await exists(stateDir);
      if (!dirExists) {
        await mkdir(stateDir, { recursive: true });
      }
    } catch (e) {
      console.error('[Graph] Error creating state dir:', e);
    }

    return stateDir;
  }

  // Fallback to local
  return getLocalPipelineDir(projectPath);
}

// Legacy alias for backward compatibility
async function getPipelineDir(projectPath?: string | null): Promise<string> {
  return getLocalPipelineDir(projectPath);
}

export async function ensurePipelineDir(projectPath?: string | null): Promise<void> {
  const dir = await getLocalPipelineDir(projectPath);
  try {
    const dirExists = await exists(dir);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }
  } catch (e) {
    console.error('[Graph] Error ensuring directory:', e);
    throw e;
  }
}

async function getGlobalPipelinesDir(): Promise<string> {
  const hubConfig = await getHubConfig();

  if (hubConfig) {
    return `${hubConfig.hub_dir}/${hubConfig.pipelines_dir}`;
  }

  // Fallback
  if (!cachedHomeDir) {
    const home = await homeDir();
    if (!home) throw new Error('Could not determine home directory');
    cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
  }

  return `${cachedHomeDir}/my_projects/agentcockpit/.claude/pipelines`;
}

async function getGlobalAgentsDir(): Promise<string> {
  const hubConfig = await getHubConfig();

  if (hubConfig) {
    const agentsDir = hubConfig.agents_dir || '.claude/agents';
    return `${hubConfig.hub_dir}/${agentsDir}`;
  }

  // Fallback
  if (!cachedHomeDir) {
    const home = await homeDir();
    if (!home) throw new Error('Could not determine home directory');
    cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
  }

  return `${cachedHomeDir}/my_projects/agentcockpit/.claude/agents`;
}

async function getGlobalSkillsDir(): Promise<string> {
  const hubConfig = await getHubConfig();

  if (hubConfig) {
    const skillsDir = hubConfig.skills_dir || '.claude/skills';
    return `${hubConfig.hub_dir}/${skillsDir}`;
  }

  // Fallback
  if (!cachedHomeDir) {
    const home = await homeDir();
    if (!home) throw new Error('Could not determine home directory');
    cachedHomeDir = home.endsWith('/') ? home.slice(0, -1) : home;
  }

  return `${cachedHomeDir}/my_projects/agentcockpit/.claude/skills`;
}

export async function getPipelinePath(projectPath?: string | null): Promise<string> {
  return await getPipelineDir(projectPath);
}

// ============================================
// Graph State Management
// ============================================

function getDefaultGraphState(): GraphState {
  return {
    current_nodes: [],
    node_visits: {},
    execution_path: [],
    active_graph: null,
    max_visits_default: 10,
    total_transitions: 0,
    last_activity: new Date().toISOString()
  };
}

export async function getGraphState(projectPath?: string | null): Promise<GraphState> {
  try {
    // Use centralized state directory
    const dir = await getCentralizedStateDir(projectPath);
    const statePath = `${dir}/${GRAPH_STATE_FILE}`;

    const fileExists = await exists(statePath);
    if (!fileExists) {
      return getDefaultGraphState();
    }

    const content = await readTextFile(statePath);
    return JSON.parse(content) as GraphState;
  } catch (e) {
    console.error('[Graph] Error reading state:', e);
    return getDefaultGraphState();
  }
}

export async function saveGraphState(state: GraphState, projectPath?: string | null): Promise<boolean> {
  try {
    // Use centralized state directory
    const dir = await getCentralizedStateDir(projectPath);

    // Ensure directory exists
    const dirExists = await exists(dir);
    if (!dirExists) {
      await mkdir(dir, { recursive: true });
    }

    const statePath = `${dir}/${GRAPH_STATE_FILE}`;

    state.last_activity = new Date().toISOString();
    await writeTextFile(statePath, JSON.stringify(state, null, 2));
    return true;
  } catch (e) {
    console.error('[Graph] Error saving state:', e);
    return false;
  }
}

// ============================================
// Graph YAML Parser
// ============================================

function parseGraphYaml(content: string): PipelineGraph {
  const graph: PipelineGraph = {
    metadata: { name: '', version: '2.0.0', type: 'graph' },
    nodes: [],
    edges: []
  };

  const lines = content.split('\n');
  let currentSection: 'metadata' | 'nodes' | 'edges' | null = null;
  let currentItem: Record<string, unknown> | null = null;
  let currentList: string | null = null;
  let inMultiline = false;
  let multilineKey = '';
  let multilineContent: string[] = [];
  let baseIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    if (!stripped || stripped.startsWith('#')) {
      if (inMultiline) multilineContent.push('');
      continue;
    }

    const indent = line.length - line.trimStart().length;

    // Handle multiline
    if (inMultiline) {
      if (indent > baseIndent || stripped === '') {
        multilineContent.push(stripped);
        continue;
      } else {
        if (currentItem && multilineKey) {
          currentItem[multilineKey] = multilineContent.join('\n');
        }
        inMultiline = false;
      }
    }

    // Detect multiline start
    if (stripped.endsWith('|')) {
      inMultiline = true;
      multilineKey = stripped.slice(0, -1).trim().replace(':', '');
      multilineContent = [];
      baseIndent = indent;
      continue;
    }

    // Section detection
    if (stripped === 'metadata:') {
      currentSection = 'metadata';
      currentItem = graph.metadata as unknown as Record<string, unknown>;
      continue;
    }
    if (stripped === 'nodes:') {
      currentSection = 'nodes';
      currentItem = null;
      continue;
    }
    if (stripped === 'edges:') {
      currentSection = 'edges';
      currentItem = null;
      continue;
    }

    // New item in list
    if (stripped.startsWith('- ')) {
      if (currentSection === 'nodes' || currentSection === 'edges') {
        if (currentItem && currentSection === 'nodes') {
          graph.nodes.push(currentItem as unknown as GraphNode);
        } else if (currentItem && currentSection === 'edges') {
          graph.edges.push(currentItem as unknown as GraphEdge);
        }

        const itemContent = stripped.slice(2).trim();
        if (itemContent.includes(':')) {
          const [key, ...valueParts] = itemContent.split(':');
          const value = valueParts.join(':').trim().replace(/^["']|["']$/g, '');
          currentItem = { [key.trim()]: value || undefined };
        } else {
          currentItem = {};
        }
        currentList = null;
      } else if (currentList && currentItem) {
        const value = stripped.slice(2).trim().replace(/^["']|["']$/g, '');
        const list = currentItem[currentList];
        if (Array.isArray(list)) {
          list.push(value);
        }
      }
      continue;
    }

    // Key-value pairs
    if (stripped.includes(':') && currentItem) {
      const colonIdx = stripped.indexOf(':');
      const key = stripped.slice(0, colonIdx).trim();
      const value = stripped.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');

      if (!value) {
        // Start of list or nested object
        currentList = key;
        if (key === 'condition') {
          currentItem[key] = {};
        } else if (!currentItem[key]) {
          currentItem[key] = [];
        }
      } else {
        // Handle nested condition properties
        if (currentList === 'condition' && typeof currentItem.condition === 'object') {
          (currentItem.condition as Record<string, unknown>)[key] = value;
        } else {
          // Parse value types
          if (value === 'true') {
            currentItem[key] = true;
          } else if (value === 'false') {
            currentItem[key] = false;
          } else if (/^\d+$/.test(value)) {
            currentItem[key] = parseInt(value, 10);
          } else {
            currentItem[key] = value;
          }
          currentList = null;
        }
      }
    }
  }

  // Push last item
  if (currentItem) {
    if (currentSection === 'nodes') {
      graph.nodes.push(currentItem as unknown as GraphNode);
    } else if (currentSection === 'edges') {
      graph.edges.push(currentItem as unknown as GraphEdge);
    }
  }

  // Set defaults for nodes
  graph.nodes = graph.nodes.map(node => ({
    ...node,
    mcps_enabled: node.mcps_enabled || ['*'],
    tools_blocked: node.tools_blocked || [],
    is_start: node.is_start ?? false,
    is_end: node.is_end ?? false,
    max_visits: node.max_visits ?? 10
  }));

  // Set defaults for edges
  graph.edges = graph.edges.map(edge => ({
    ...edge,
    condition: edge.condition || { type: 'always' },
    priority: edge.priority ?? 1
  }));

  return graph;
}

// ============================================
// Graph Loading
// ============================================

export async function getGraph(projectPath?: string | null): Promise<PipelineGraph | null> {
  try {
    const dir = await getPipelineDir(projectPath);
    const graphPath = `${dir}/${GRAPH_FILE}`;

    const fileExists = await exists(graphPath);
    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(graphPath);
    return parseGraphYaml(content);
  } catch (e) {
    console.error('[Graph] Error reading graph:', e);
    return null;
  }
}

export async function getGlobalGraph(graphName: string): Promise<PipelineGraph | null> {
  try {
    const dir = await getGlobalPipelinesDir();
    // Try graph format first, then legacy format
    let filePath = `${dir}/${graphName}-graph.yaml`;
    let fileExists = await exists(filePath);

    if (!fileExists) {
      filePath = `${dir}/${graphName}.yaml`;
      fileExists = await exists(filePath);
    }

    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(filePath);
    return parseGraphYaml(content);
  } catch (e) {
    console.error('[Graph] Error reading global graph:', e);
    return null;
  }
}

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

function getDefaultSteps(): PipelineStep[] {
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

// ============================================
// Graph Operations
// ============================================

export async function resetPipeline(projectPath?: string | null): Promise<boolean> {
  const graph = await getGraph(projectPath);
  if (!graph) return false;

  const startNode = graph.nodes.find(n => n.is_start) || graph.nodes[0];
  if (!startNode) return false;

  const state: GraphState = {
    current_nodes: [startNode.id],
    node_visits: { [startNode.id]: 1 },
    execution_path: [{
      from_node: null,
      to_node: startNode.id,
      edge_id: null,
      timestamp: new Date().toISOString(),
      reason: 'Graph reset'
    }],
    active_graph: (await getGraphState(projectPath)).active_graph,
    max_visits_default: 10,
    total_transitions: 0,
    last_activity: new Date().toISOString()
  };

  return saveGraphState(state, projectPath);
}

export async function advancePipeline(projectPath?: string | null): Promise<PipelineState> {
  // In graph mode, we need to traverse an edge
  // For legacy compatibility, find the first available edge and traverse it
  const graph = await getGraph(projectPath);
  const graphState = await getGraphState(projectPath);

  if (!graph) {
    return getPipelineState(projectPath);
  }

  const currentNodeId = graphState.current_nodes[0];
  if (!currentNodeId) {
    return getPipelineState(projectPath);
  }

  // Find first outgoing edge
  const outgoingEdges = graph.edges.filter(e => e.from === currentNodeId);
  if (outgoingEdges.length === 0) {
    return getPipelineState(projectPath);
  }

  // Sort by priority and take first
  const edge = outgoingEdges.sort((a, b) => a.priority - b.priority)[0];

  // Check max visits
  const targetNode = graph.nodes.find(n => n.id === edge.to);
  const currentVisits = graphState.node_visits[edge.to] || 0;
  const maxVisits = targetNode?.max_visits || graphState.max_visits_default;

  if (currentVisits >= maxVisits) {
    console.log('[Graph] Max visits reached for node:', edge.to);
    return getPipelineState(projectPath);
  }

  // Execute transition
  graphState.current_nodes = [edge.to];
  graphState.node_visits[edge.to] = currentVisits + 1;
  graphState.execution_path.push({
    from_node: currentNodeId,
    to_node: edge.to,
    edge_id: edge.id,
    timestamp: new Date().toISOString(),
    reason: 'Manual advance'
  });
  graphState.total_transitions++;

  await saveGraphState(graphState, projectPath);
  return getPipelineState(projectPath);
}

export async function traverseEdge(edgeId: string, projectPath?: string | null, reason: string = 'Manual traverse'): Promise<boolean> {
  const graph = await getGraph(projectPath);
  const graphState = await getGraphState(projectPath);

  if (!graph) return false;

  const edge = graph.edges.find(e => e.id === edgeId);
  if (!edge) return false;

  const currentNodeId = graphState.current_nodes[0];
  if (edge.from !== currentNodeId) return false;

  // Check max visits
  const targetNode = graph.nodes.find(n => n.id === edge.to);
  const currentVisits = graphState.node_visits[edge.to] || 0;
  const maxVisits = targetNode?.max_visits || graphState.max_visits_default;

  if (currentVisits >= maxVisits) {
    return false;
  }

  // Execute transition
  graphState.current_nodes = [edge.to];
  graphState.node_visits[edge.to] = currentVisits + 1;
  graphState.execution_path.push({
    from_node: currentNodeId,
    to_node: edge.to,
    edge_id: edge.id,
    timestamp: new Date().toISOString(),
    reason
  });
  graphState.total_transitions++;

  return saveGraphState(graphState, projectPath);
}

export async function setCurrentNode(nodeId: string, projectPath?: string | null): Promise<boolean> {
  const graph = await getGraph(projectPath);
  const graphState = await getGraphState(projectPath);

  if (!graph) return false;

  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return false;

  const currentVisits = graphState.node_visits[nodeId] || 0;

  graphState.current_nodes = [nodeId];
  graphState.node_visits[nodeId] = currentVisits + 1;
  graphState.execution_path.push({
    from_node: graphState.current_nodes[0] || null,
    to_node: nodeId,
    edge_id: null,
    timestamp: new Date().toISOString(),
    reason: 'Admin jump'
  });

  return saveGraphState(graphState, projectPath);
}

// ============================================
// Available Edges
// ============================================

export interface AvailableEdge {
  id: string;
  to: string;
  toName: string;
  conditionType: string;
  conditionTool?: string;
  conditionPhrases?: string[];
  priority: number;
}

export async function getAvailableEdges(projectPath?: string | null): Promise<AvailableEdge[]> {
  const graph = await getGraph(projectPath);
  const graphState = await getGraphState(projectPath);

  if (!graph) return [];

  const currentNodeId = graphState.current_nodes[0];
  if (!currentNodeId) return [];

  const outgoingEdges = graph.edges
    .filter(e => e.from === currentNodeId)
    .sort((a, b) => a.priority - b.priority);

  return outgoingEdges.map(edge => {
    const targetNode = graph.nodes.find(n => n.id === edge.to);
    return {
      id: edge.id,
      to: edge.to,
      toName: targetNode?.name || edge.to,
      conditionType: edge.condition.type,
      conditionTool: edge.condition.tool,
      conditionPhrases: edge.condition.phrases,
      priority: edge.priority
    };
  });
}

// ============================================
// Graph Visualization
// ============================================

export interface GraphVisualization {
  mermaid: string;
  currentNode: string | null;
  graphName: string | null;
}

export async function getGraphVisualization(projectPath?: string | null): Promise<GraphVisualization> {
  const graph = await getGraph(projectPath);
  const graphState = await getGraphState(projectPath);

  if (!graph) {
    return {
      mermaid: 'flowchart TD\n    empty[No graph loaded]',
      currentNode: null,
      graphName: null
    };
  }

  const currentNodeId = graphState.current_nodes[0] || null;
  const lines: string[] = ['flowchart TD'];

  // Generate node definitions with shapes
  for (const node of graph.nodes) {
    let shape: string;
    if (node.is_start) {
      shape = `${node.id}([${node.name}])`; // Stadium shape for start
    } else if (node.is_end) {
      shape = `${node.id}[/${node.name}/]`; // Parallelogram for end
    } else {
      shape = `${node.id}[${node.name}]`; // Rectangle for normal
    }
    lines.push(`    ${shape}`);
  }

  // Generate edge definitions with labels
  for (const edge of graph.edges) {
    let label = '';
    if (edge.condition.type === 'tool' && edge.condition.tool) {
      // Extract just the tool name from mcp__name__tool
      const parts = edge.condition.tool.split('__');
      label = parts[parts.length - 1] || edge.condition.tool;
      if (label.length > 15) label = label.substring(0, 15) + '...';
    } else if (edge.condition.type === 'phrase' && edge.condition.phrases?.length) {
      label = `'${edge.condition.phrases[0].substring(0, 15)}'`;
    } else if (edge.condition.type === 'always') {
      label = 'always';
    } else if (edge.condition.type === 'default') {
      label = 'default';
    }

    if (label) {
      lines.push(`    ${edge.from} -->|${label}| ${edge.to}`);
    } else {
      lines.push(`    ${edge.from} --> ${edge.to}`);
    }
  }

  // Highlight current node
  if (currentNodeId) {
    lines.push(`    style ${currentNodeId} fill:#90EE90,stroke:#333,stroke-width:3px`);
  }

  return {
    mermaid: lines.join('\n'),
    currentNode: currentNodeId,
    graphName: graphState.active_graph
  };
}

// ============================================
// Installation & Activation
// ============================================

export async function isPipelineInstalled(projectPath?: string | null): Promise<boolean> {
  try {
    const dir = await getPipelineDir(projectPath);
    const dirExists = await exists(dir);
    if (!dirExists) return false;

    // Check for graph.yaml
    const graphPath = `${dir}/${GRAPH_FILE}`;
    return await exists(graphPath);
  } catch (e) {
    return false;
  }
}

export async function getEnforcerEnabled(projectPath?: string | null): Promise<boolean> {
  try {
    // Use centralized state directory for config
    const dir = await getCentralizedStateDir(projectPath);
    const configPath = `${dir}/config.json`;

    const configExists = await exists(configPath);
    if (!configExists) return true;

    const content = await readTextFile(configPath);
    const config = JSON.parse(content);
    return config.enforcer_enabled !== false;
  } catch (e) {
    return true;
  }
}

export async function getActivePipelineName(projectPath: string | null): Promise<string | null> {
  if (!projectPath) return null;
  const state = await getGraphState(projectPath);
  return state.active_graph;
}

export async function activatePipeline(projectPath: string, graphName: string): Promise<boolean> {
  try {
    await ensurePipelineDir(projectPath);
    const dir = await getPipelineDir(projectPath);

    // Copy graph file from global pipelines
    const globalDir = await getGlobalPipelinesDir();
    let sourcePath = `${globalDir}/${graphName}-graph.yaml`;
    let sourceExists = await exists(sourcePath);

    if (!sourceExists) {
      sourcePath = `${globalDir}/${graphName}.yaml`;
      sourceExists = await exists(sourcePath);
    }

    if (!sourceExists) {
      console.error('[Graph] Source graph not found:', graphName);
      return false;
    }

    const content = await readTextFile(sourcePath);
    const graphPath = `${dir}/${GRAPH_FILE}`;
    await writeTextFile(graphPath, content);

    // Parse and initialize state
    const graph = parseGraphYaml(content);
    const startNode = graph.nodes.find(n => n.is_start) || graph.nodes[0];

    const state: GraphState = {
      current_nodes: startNode ? [startNode.id] : [],
      node_visits: startNode ? { [startNode.id]: 1 } : {},
      execution_path: startNode ? [{
        from_node: null,
        to_node: startNode.id,
        edge_id: null,
        timestamp: new Date().toISOString(),
        reason: 'Graph activated'
      }] : [],
      active_graph: graphName,
      max_visits_default: 10,
      total_transitions: 0,
      last_activity: new Date().toISOString()
    };

    await saveGraphState(state, projectPath);

    // Copy required agents to project
    const requiredAgents = graph.metadata.agents_required || [];
    if (requiredAgents.length > 0) {
      const globalAgentsDir = await getGlobalAgentsDir();
      const projectAgentsDir = `${projectPath}/.claude/agents`;

      // Ensure project agents directory exists
      const agentsDirExists = await exists(projectAgentsDir);
      if (!agentsDirExists) {
        await mkdir(projectAgentsDir, { recursive: true });
      }

      // Copy each required agent
      for (const agentName of requiredAgents) {
        try {
          const agentSourcePath = `${globalAgentsDir}/${agentName}.md`;
          const agentDestPath = `${projectAgentsDir}/${agentName}.md`;

          const agentExists = await exists(agentSourcePath);
          if (agentExists) {
            const agentContent = await readTextFile(agentSourcePath);
            await writeTextFile(agentDestPath, agentContent);
            console.log(`[Graph] Agent copied: ${agentName}`);
          } else {
            console.warn(`[Graph] Agent not found: ${agentName}`);
          }
        } catch (agentError) {
          console.error(`[Graph] Error copying agent ${agentName}:`, agentError);
        }
      }
      console.log(`[Graph] Copied ${requiredAgents.length} agents to project`);
    }

    // Create /pipeline skill for Claude Code
    const skillsDir = `${projectPath}/.claude/skills/pipeline`;
    const skillsDirExists = await exists(skillsDir);
    if (!skillsDirExists) {
      await mkdir(skillsDir, { recursive: true });
    }
    const skillPath = `${skillsDir}/SKILL.md`;
    const skillContent = generatePipelineSkill(projectPath);
    await writeTextFile(skillPath, skillContent);
    console.log('[Graph] Pipeline skill created at', skillPath);

    return true;
  } catch (e) {
    console.error('[Graph] Error activating pipeline:', e);
    return false;
  }
}

export async function deactivatePipeline(projectPath: string): Promise<boolean> {
  try {
    // Reset the state (graph file removal would require Tauri remove())
    const state = getDefaultGraphState();
    return saveGraphState(state, projectPath);
  } catch {
    return false;
  }
}

// ============================================
// Copy All Agents and Skills to Project
// ============================================

export interface CopyAssetsResult {
  success: boolean;
  agentsCopied: string[];
  skillsCopied: string[];
  errors: string[];
}

export async function copyAllAgentsToProject(projectPath: string): Promise<CopyAssetsResult> {
  const result: CopyAssetsResult = {
    success: true,
    agentsCopied: [],
    skillsCopied: [],
    errors: []
  };

  try {
    const globalAgentsDir = await getGlobalAgentsDir();
    const projectAgentsDir = `${projectPath}/.claude/agents`;

    // Check if global agents directory exists
    const globalExists = await exists(globalAgentsDir);
    if (!globalExists) {
      console.log('[Graph] No global agents directory found');
      return result;
    }

    // Ensure project agents directory exists
    const projectDirExists = await exists(projectAgentsDir);
    if (!projectDirExists) {
      await mkdir(projectAgentsDir, { recursive: true });
    }

    // Read all agent files
    const entries = await readDir(globalAgentsDir);

    for (const entry of entries) {
      if (!entry.name?.endsWith('.md')) continue;

      try {
        const sourcePath = `${globalAgentsDir}/${entry.name}`;
        const destPath = `${projectAgentsDir}/${entry.name}`;

        const content = await readTextFile(sourcePath);
        await writeTextFile(destPath, content);

        const agentName = entry.name.replace('.md', '');
        result.agentsCopied.push(agentName);
        console.log(`[Graph] Agent copied: ${agentName}`);
      } catch (e) {
        const error = `Failed to copy ${entry.name}: ${e}`;
        result.errors.push(error);
        console.error(`[Graph] ${error}`);
      }
    }

    console.log(`[Graph] Copied ${result.agentsCopied.length} agents to project`);
  } catch (e) {
    result.success = false;
    result.errors.push(`Failed to copy agents: ${e}`);
    console.error('[Graph] Error copying agents:', e);
  }

  return result;
}

export async function copyAllSkillsToProject(projectPath: string): Promise<CopyAssetsResult> {
  const result: CopyAssetsResult = {
    success: true,
    agentsCopied: [],
    skillsCopied: [],
    errors: []
  };

  try {
    const globalSkillsDir = await getGlobalSkillsDir();
    const projectSkillsDir = `${projectPath}/.claude/skills`;

    // Check if global skills directory exists
    const globalExists = await exists(globalSkillsDir);
    if (!globalExists) {
      console.log('[Graph] No global skills directory found');
      return result;
    }

    // Ensure project skills directory exists
    const projectDirExists = await exists(projectSkillsDir);
    if (!projectDirExists) {
      await mkdir(projectSkillsDir, { recursive: true });
    }

    // Read all skill directories
    const entries = await readDir(globalSkillsDir);

    for (const entry of entries) {
      if (!entry.isDirectory) continue;

      try {
        const skillName = entry.name;
        const sourceDir = `${globalSkillsDir}/${skillName}`;
        const destDir = `${projectSkillsDir}/${skillName}`;

        // Ensure destination skill directory exists
        const destDirExists = await exists(destDir);
        if (!destDirExists) {
          await mkdir(destDir, { recursive: true });
        }

        // Copy SKILL.md if it exists
        const skillFilePath = `${sourceDir}/SKILL.md`;
        const skillFileExists = await exists(skillFilePath);
        if (skillFileExists) {
          const content = await readTextFile(skillFilePath);
          await writeTextFile(`${destDir}/SKILL.md`, content);
          result.skillsCopied.push(skillName);
          console.log(`[Graph] Skill copied: ${skillName}`);
        }
      } catch (e) {
        const error = `Failed to copy skill ${entry.name}: ${e}`;
        result.errors.push(error);
        console.error(`[Graph] ${error}`);
      }
    }

    console.log(`[Graph] Copied ${result.skillsCopied.length} skills to project`);
  } catch (e) {
    result.success = false;
    result.errors.push(`Failed to copy skills: ${e}`);
    console.error('[Graph] Error copying skills:', e);
  }

  return result;
}

export async function copyAllAssetsToProject(projectPath: string): Promise<CopyAssetsResult> {
  const agentsResult = await copyAllAgentsToProject(projectPath);
  const skillsResult = await copyAllSkillsToProject(projectPath);

  return {
    success: agentsResult.success && skillsResult.success,
    agentsCopied: agentsResult.agentsCopied,
    skillsCopied: skillsResult.skillsCopied,
    errors: [...agentsResult.errors, ...skillsResult.errors]
  };
}

// ============================================
// Global Pipelines
// ============================================

export interface GlobalPipelineInfo {
  name: string;
  displayName: string;
  description: string;
  stepsCount: number;
  isGraph: boolean;
}

export async function listGlobalPipelines(): Promise<GlobalPipelineInfo[]> {
  const pipelines: GlobalPipelineInfo[] = [];

  try {
    const dir = await getGlobalPipelinesDir();
    const dirExists = await exists(dir);
    if (!dirExists) return pipelines;

    const entries = await readDir(dir);

    for (const entry of entries) {
      if (!entry.name?.endsWith('.yaml')) continue;

      const name = entry.name.replace('-graph.yaml', '').replace('.yaml', '');
      const isGraph = entry.name.includes('-graph');
      const filePath = `${dir}/${entry.name}`;

      try {
        const content = await readTextFile(filePath);
        const graph = parseGraphYaml(content);

        pipelines.push({
          name,
          displayName: graph.metadata.name || name,
          description: graph.metadata.description || '',
          stepsCount: graph.nodes.length,
          isGraph
        });
      } catch (e) {
        pipelines.push({
          name,
          displayName: name,
          description: '',
          stepsCount: 0,
          isGraph
        });
      }
    }

    return pipelines;
  } catch (e) {
    return pipelines;
  }
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
