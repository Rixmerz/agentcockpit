import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';

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

export const PIPELINE_DIR = '.claude/pipeline';
export const GRAPH_STATE_FILE = 'graph_state.json';
export const GRAPH_FILE = 'graph.yaml';
const AGENTCOCKPIT_CONFIG = '.agentcockpit/config.json';

export let cachedHomeDir: string | null = null;
export let cachedHubConfig: { hub_dir: string; pipelines_dir: string; states_dir: string } | null = null;

/**
 * Invalidate the hub config cache.
 * Call this before refreshing pipeline lists to pick up config changes.
 */
export function invalidateHubConfigCache(): void {
  cachedHubConfig = null;
  console.log('[Graph] Hub config cache invalidated');
}

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

export async function getHubConfig(): Promise<HubConfig | null> {
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
export async function getLocalPipelineDir(projectPath?: string | null): Promise<string> {
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
export async function getCentralizedStateDir(projectPath?: string | null): Promise<string> {
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
export async function getPipelineDir(projectPath?: string | null): Promise<string> {
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

export async function getGlobalPipelinesDir(): Promise<string> {
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

export async function getGlobalAgentsDir(): Promise<string> {
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

export async function getGlobalSkillsDir(): Promise<string> {
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

export function getDefaultGraphState(): GraphState {
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

export function parseGraphYaml(content: string): PipelineGraph {
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
