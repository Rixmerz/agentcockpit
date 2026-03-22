/**
 * workflowIOService.ts — Workflow I/O and graph parsing for the UI layer.
 *
 * Source-of-truth separation (MA1):
 *   - Python MCP server (.workflow-manager) is the authoritative source for ALL
 *     workflow state mutations: node transitions, visit counts, enforcer decisions,
 *     and config writes. It owns graph_state.json and config.json.
 *   - This TypeScript module is a READ-ONLY cache for UI rendering. It reads the
 *     same files that Python writes so that the frontend can display current node,
 *     execution path, and graph topology without duplicating mutation logic.
 *
 * Consequence: never write to graph_state.json from this file. State changes must
 * go through the Python MCP server (via hookService / syncWorkflowHooks for config,
 * or via the enforcer for state transitions). The UI reflects; it does not drive.
 */
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { getHomeDir } from '../homeDir';

// ============================================
// Graph-Based Workflow Types (v2.0)
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

export interface DccContextConfig {
  enabled: boolean;
  analyses: string[];
  token_budget?: number;
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
  dcc_context?: DccContextConfig;
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

export interface WorkflowGraph {
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
export interface WorkflowState {
  current_step: number;  // Maps to index of current node in nodes array
  completed_steps: { id: string; completed_at: string; reason: string }[];
  session_id: string | null;
  started_at: string | null;
  last_activity: string | null;
  step_history: { from_step: number; to_step: number; timestamp: string; reason: string }[];
  active_workflow?: string | null;
  workflow_version?: string | null;
  workflow_source?: 'local' | 'global' | null;
  // Graph-specific fields
  current_node?: string;
  node_visits?: Record<string, number>;
}

// Legacy compatibility
export interface WorkflowStep {
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

export const WORKFLOW_DIR = '.claude/workflow';
export const GRAPH_STATE_FILE = 'graph_state.json';
export const GRAPH_FILE = 'graph.yaml';
const AGENTCOCKPIT_CONFIG = '.agentcockpit/config.json';

export let cachedHubConfig: { hub_dir: string; workflows_dir: string; states_dir: string } | null = null;

/**
 * Invalidate the hub config cache.
 * Call this before refreshing workflow lists to pick up config changes.
 */
export function invalidateHubConfigCache(): void {
  cachedHubConfig = null;
}

// ============================================
// Hub Configuration (Centralized Architecture)
// ============================================

interface HubConfig {
  hub_dir: string;
  workflows_dir: string;
  states_dir: string;
  agents_dir?: string;
  skills_dir?: string;
}

export async function getHubConfig(): Promise<HubConfig | null> {
  if (cachedHubConfig) return cachedHubConfig;

  try {
    const homeForConfig = await getHomeDir();
    if (!homeForConfig) return null;

    const configPath = `${homeForConfig}/${AGENTCOCKPIT_CONFIG}`;
    const configExists = await exists(configPath);
    if (!configExists) return null;

    const content = await readTextFile(configPath);
    const config = JSON.parse(content);

    cachedHubConfig = {
      hub_dir: config.hub_dir,
      workflows_dir: config.workflows_dir || '.claude/workflows',
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

// Get local workflow dir (for graph.yaml - active graph copy)
export async function getLocalWorkflowDir(projectPath?: string | null): Promise<string> {
  if (projectPath) {
    const normalizedPath = projectPath.endsWith('/') ? projectPath.slice(0, -1) : projectPath;
    return `${normalizedPath}/${WORKFLOW_DIR}`;
  }

  return `${await getHomeDir()}/${WORKFLOW_DIR}`;
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
  return getLocalWorkflowDir(projectPath);
}

// Legacy alias for backward compatibility
export async function getWorkflowDir(projectPath?: string | null): Promise<string> {
  return getLocalWorkflowDir(projectPath);
}

export async function ensureWorkflowDir(projectPath?: string | null): Promise<void> {
  const dir = await getLocalWorkflowDir(projectPath);
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

export async function getGlobalWorkflowsDir(): Promise<string> {
  const hubConfig = await getHubConfig();

  if (hubConfig) {
    return `${hubConfig.hub_dir}/${hubConfig.workflows_dir}`;
  }

  // Fallback
  return `${await getHomeDir()}/my_projects/agentcockpit/.claude/workflows`;
}

export async function getGlobalAgentsDir(): Promise<string> {
  const hubConfig = await getHubConfig();

  if (hubConfig) {
    const agentsDir = hubConfig.agents_dir || '.claude/agents';
    return `${hubConfig.hub_dir}/${agentsDir}`;
  }

  // Fallback
  return `${await getHomeDir()}/my_projects/agentcockpit/.claude/agents`;
}

export async function getGlobalSkillsDir(): Promise<string> {
  const hubConfig = await getHubConfig();

  if (hubConfig) {
    const skillsDir = hubConfig.skills_dir || '.claude/skills';
    return `${hubConfig.hub_dir}/${skillsDir}`;
  }

  // Fallback
  return `${await getHomeDir()}/my_projects/agentcockpit/.claude/skills`;
}

export async function getWorkflowPath(projectPath?: string | null): Promise<string> {
  return await getWorkflowDir(projectPath);
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

export function parseGraphYaml(content: string): WorkflowGraph {
  const graph: WorkflowGraph = {
    metadata: { name: '', version: '2.0.0', type: 'graph' },
    nodes: [],
    edges: []
  };

  const lines = content.split('\n');
  let currentSection: 'metadata' | 'nodes' | 'edges' | null = null;
  let currentItem: Record<string, unknown> | null = null;
  let currentList: string | null = null;
  let currentNestedObj: string | null = null; // tracks nesting inside 'condition' or 'dcc_context'
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
        currentNestedObj = null;
      } else if (currentList && currentItem) {
        const value = stripped.slice(2).trim().replace(/^["']|["']$/g, '');
        // Check if we're inside a nested object (e.g., dcc_context.analyses)
        if (currentNestedObj && currentList !== currentNestedObj) {
          const nestedObj = currentItem[currentNestedObj] as Record<string, unknown>;
          const subList = nestedObj?.[currentList];
          if (Array.isArray(subList)) {
            subList.push(value);
          }
        } else {
          const list = currentItem[currentList];
          if (Array.isArray(list)) {
            list.push(value);
          }
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
        if (key === 'condition' || key === 'dcc_context') {
          // Top-level nested object
          currentItem[key] = {};
          currentList = key;
          currentNestedObj = key;
        } else if (currentNestedObj && typeof currentItem[currentNestedObj] === 'object') {
          // Sub-list within nested object (e.g., analyses: inside dcc_context)
          (currentItem[currentNestedObj] as Record<string, unknown>)[key] = [];
          currentList = key;
        } else {
          currentList = key;
          currentNestedObj = null;
          if (!currentItem[key]) {
            currentItem[key] = [];
          }
        }
      } else {
        // Handle nested object properties (condition, dcc_context and their sub-keys)
        if (currentNestedObj && typeof currentItem[currentNestedObj] === 'object' && !Array.isArray(currentItem[currentNestedObj])) {
          const nestedObj = currentItem[currentNestedObj] as Record<string, unknown>;
          // Parse value types for nested object
          if (value === 'true') nestedObj[key] = true;
          else if (value === 'false') nestedObj[key] = false;
          else if (/^\d+$/.test(value)) nestedObj[key] = parseInt(value, 10);
          else nestedObj[key] = value;
        } else {
          // Parse value types for top-level
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
          currentNestedObj = null;
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

export async function getGraph(projectPath?: string | null): Promise<WorkflowGraph | null> {
  try {
    const dir = await getWorkflowDir(projectPath);
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

export async function getGlobalGraph(graphName: string): Promise<WorkflowGraph | null> {
  try {
    const dir = await getGlobalWorkflowsDir();
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
