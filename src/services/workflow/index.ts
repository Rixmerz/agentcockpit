// Re-export all types and functions from domain files

// IO Service - types, path helpers, YAML parsing, graph loading, state persistence
export type {
  EdgeCondition,
  GraphEdge,
  GraphNode,
  GraphMetadata,
  WorkflowGraph,
  PathEntry,
  GraphState,
  WorkflowState,
  WorkflowStep,
} from './workflowIOService';

export {
  invalidateHubConfigCache,
  ensureWorkflowDir,
  getWorkflowPath,
  getGraph,
  getGlobalGraph,
  getGraphState,
  saveGraphState,
  parseGraphYaml,
  getDefaultGraphState,
  getGlobalWorkflowsDir,
  getGlobalAgentsDir,
  getGlobalSkillsDir,
  getWorkflowDir,
  getLocalWorkflowDir,
  getCentralizedStateDir,
  getHubConfig,
} from './workflowIOService';

// Graph Service - graph operations, traversal, visualization, activation
export type {
  AvailableEdge,
  GraphVisualization,
  WorkflowStatus,
  GlobalWorkflowInfo,
  CopyAssetsResult,
} from './workflowGraphService';

export {
  resetWorkflow,
  advanceWorkflow,
  traverseEdge,
  setCurrentNode,
  getAvailableEdges,
  getGraphVisualization,
  isWorkflowInstalled,
  getEnforcerEnabled,
  getActiveWorkflowName,
  activateWorkflow,
  deactivateWorkflow,
  copyAllAgentsToProject,
  copyAllSkillsToProject,
  copyAllAssetsToProject,
  listGlobalWorkflows,
  getStatus,
  listAvailableWorkflows,
} from './workflowGraphService';

// Node Service - legacy compatibility, settings, MCPs
export type {
  WorkflowSettings,
  AvailableMcp,
} from './workflowNodeService';

export {
  getWorkflowState,
  saveWorkflowState,
  getWorkflowSteps,
  getGlobalWorkflowSteps,
  getDefaultSteps,
  getWorkflowSettings,
  saveWorkflowSettings,
  saveWorkflowSteps,
  getAvailableMcps,
  STANDARD_TOOLS,
} from './workflowNodeService';

// ============================================
// Service Object (for component imports)
// ============================================

import { getGraph, getGlobalGraph, getGraphState, saveGraphState, ensureWorkflowDir, getWorkflowPath, invalidateHubConfigCache } from './workflowIOService';
import {
  resetWorkflow, traverseEdge, setCurrentNode,
  getAvailableEdges, getGraphVisualization,
  isWorkflowInstalled, getEnforcerEnabled, getActiveWorkflowName,
  activateWorkflow, deactivateWorkflow,
  copyAllAgentsToProject, copyAllSkillsToProject, copyAllAssetsToProject,
  listGlobalWorkflows, getStatus, listAvailableWorkflows,
} from './workflowGraphService';
import {
  getWorkflowState, saveWorkflowState, getWorkflowSteps, getGlobalWorkflowSteps,
  getWorkflowSettings, saveWorkflowSettings, saveWorkflowSteps,
  getAvailableMcps, STANDARD_TOOLS,
} from './workflowNodeService';

export const workflowService = {
  // Status API
  getStatus,
  listAvailableWorkflows,
  activateWorkflow,
  resetWorkflow,
  deactivateWorkflow,

  // Graph operations
  getGraph,
  getGlobalGraph,
  getGraphState,
  saveGraphState,
  getAvailableEdges,
  traverseEdge,
  setCurrentNode,
  getGraphVisualization,

  // Legacy compatibility
  getWorkflowState,
  saveWorkflowState,
  getWorkflowSteps,
  getGlobalWorkflowSteps,

  // Installation & configuration
  isWorkflowInstalled,
  ensureWorkflowDir,
  getWorkflowPath,
  getEnforcerEnabled,
  getActiveWorkflowName,
  listGlobalWorkflows,
  invalidateHubConfigCache,

  // Assets management
  copyAllAgentsToProject,
  copyAllSkillsToProject,
  copyAllAssetsToProject,

  // Settings
  getWorkflowSettings,
  saveWorkflowSettings,
  saveWorkflowSteps,
  getAvailableMcps,
  STANDARD_TOOLS
};
