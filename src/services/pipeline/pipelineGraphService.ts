import { readTextFile, writeTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs';
import { generatePipelineSkill } from '../hookService';
import {
  getGraph,
  getGraphState,
  saveGraphState,
  getDefaultGraphState,
  ensurePipelineDir,
  getPipelineDir,
  getGlobalPipelinesDir,
  getGlobalAgentsDir,
  getGlobalSkillsDir,
  getCentralizedStateDir,
  parseGraphYaml,
  GRAPH_FILE,
  type GraphState,
  type PipelineState,
} from './pipelineIOService';

export interface CopyAssetsResult {
  success: boolean;
  agentsCopied: string[];
  skillsCopied: string[];
  errors: string[];
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
    return getPipelineStateFromGraph(projectPath);
  }

  const currentNodeId = graphState.current_nodes[0];
  if (!currentNodeId) {
    return getPipelineStateFromGraph(projectPath);
  }

  // Find first outgoing edge
  const outgoingEdges = graph.edges.filter(e => e.from === currentNodeId);
  if (outgoingEdges.length === 0) {
    return getPipelineStateFromGraph(projectPath);
  }

  // Sort by priority and take first
  const edge = outgoingEdges.sort((a, b) => a.priority - b.priority)[0];

  // Check max visits
  const targetNode = graph.nodes.find(n => n.id === edge.to);
  const currentVisits = graphState.node_visits[edge.to] || 0;
  const maxVisits = targetNode?.max_visits || graphState.max_visits_default;

  if (currentVisits >= maxVisits) {
    console.log('[Graph] Max visits reached for node:', edge.to);
    return getPipelineStateFromGraph(projectPath);
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
  return getPipelineStateFromGraph(projectPath);
}

// Internal helper to avoid circular dependency with pipelineNodeService
async function getPipelineStateFromGraph(projectPath?: string | null): Promise<PipelineState> {
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

// ============================================
// ControlBar/PipelineStepsBar API
// ============================================

export interface PipelineStatus {
  graphName: string | null;
  currentNode: string | null;
  nodes: {
    id: string;
    name: string;
    visits: number;
    maxVisits: number;
  }[];
  isActive: boolean;
}

export async function getStatus(projectPath: string | null): Promise<PipelineStatus | null> {
  if (!projectPath) return null;

  try {
    const graph = await getGraph(projectPath);
    const graphState = await getGraphState(projectPath);

    if (!graph || !graphState.active_graph) {
      return null;
    }

    const nodes = graph.nodes.map(node => ({
      id: node.id,
      name: node.name,
      visits: graphState.node_visits[node.id] || 0,
      maxVisits: node.max_visits || graphState.max_visits_default
    }));

    return {
      graphName: graphState.active_graph,
      currentNode: graphState.current_nodes[0] || null,
      nodes,
      isActive: true
    };
  } catch (e) {
    console.error('[Graph] Error getting status:', e);
    return null;
  }
}

export async function listAvailablePipelines(projectPath: string | null): Promise<string[]> {
  if (!projectPath) return [];

  try {
    const pipelines = await listGlobalPipelines();
    return pipelines.map(p => p.name);
  } catch (e) {
    console.error('[Graph] Error listing pipelines:', e);
    return [];
  }
}
