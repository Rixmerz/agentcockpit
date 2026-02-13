// Re-export all types and functions from domain files

// IO Service - types, path helpers, YAML parsing, graph loading, state persistence
export type {
  EdgeCondition,
  GraphEdge,
  GraphNode,
  GraphMetadata,
  PipelineGraph,
  PathEntry,
  GraphState,
  PipelineState,
  PipelineStep,
} from './pipelineIOService';

export {
  invalidateHubConfigCache,
  ensurePipelineDir,
  getPipelinePath,
  getGraph,
  getGlobalGraph,
  getGraphState,
  saveGraphState,
  parseGraphYaml,
  getDefaultGraphState,
  getGlobalPipelinesDir,
  getGlobalAgentsDir,
  getGlobalSkillsDir,
  getPipelineDir,
  getLocalPipelineDir,
  getCentralizedStateDir,
  getHubConfig,
} from './pipelineIOService';

// Graph Service - graph operations, traversal, visualization, activation
export type {
  AvailableEdge,
  GraphVisualization,
  PipelineStatus,
  GlobalPipelineInfo,
  CopyAssetsResult,
} from './pipelineGraphService';

export {
  resetPipeline,
  advancePipeline,
  traverseEdge,
  setCurrentNode,
  getAvailableEdges,
  getGraphVisualization,
  isPipelineInstalled,
  getEnforcerEnabled,
  getActivePipelineName,
  activatePipeline,
  deactivatePipeline,
  copyAllAgentsToProject,
  copyAllSkillsToProject,
  copyAllAssetsToProject,
  listGlobalPipelines,
  getStatus,
  listAvailablePipelines,
} from './pipelineGraphService';

// Node Service - legacy compatibility, settings, MCPs
export type {
  PipelineSettings,
  AvailableMcp,
} from './pipelineNodeService';

export {
  getPipelineState,
  savePipelineState,
  getPipelineSteps,
  getGlobalPipelineSteps,
  getDefaultSteps,
  getPipelineSettings,
  savePipelineSettings,
  savePipelineSteps,
  getAvailableMcps,
  STANDARD_TOOLS,
} from './pipelineNodeService';

// ============================================
// Service Object (for component imports)
// ============================================

import { getGraph, getGlobalGraph, getGraphState, saveGraphState, ensurePipelineDir, getPipelinePath, invalidateHubConfigCache } from './pipelineIOService';
import {
  resetPipeline, traverseEdge, setCurrentNode,
  getAvailableEdges, getGraphVisualization,
  isPipelineInstalled, getEnforcerEnabled, getActivePipelineName,
  activatePipeline, deactivatePipeline,
  copyAllAgentsToProject, copyAllSkillsToProject, copyAllAssetsToProject,
  listGlobalPipelines, getStatus, listAvailablePipelines,
} from './pipelineGraphService';
import {
  getPipelineState, savePipelineState, getPipelineSteps, getGlobalPipelineSteps,
  getPipelineSettings, savePipelineSettings, savePipelineSteps,
  getAvailableMcps, STANDARD_TOOLS,
} from './pipelineNodeService';

export const pipelineService = {
  // Status API
  getStatus,
  listAvailablePipelines,
  activatePipeline,
  resetPipeline,
  deactivatePipeline,

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
  getPipelineState,
  savePipelineState,
  getPipelineSteps,
  getGlobalPipelineSteps,

  // Installation & configuration
  isPipelineInstalled,
  ensurePipelineDir,
  getPipelinePath,
  getEnforcerEnabled,
  getActivePipelineName,
  listGlobalPipelines,
  invalidateHubConfigCache,

  // Assets management
  copyAllAgentsToProject,
  copyAllSkillsToProject,
  copyAllAssetsToProject,

  // Settings
  getPipelineSettings,
  savePipelineSettings,
  savePipelineSteps,
  getAvailableMcps,
  STANDARD_TOOLS
};
