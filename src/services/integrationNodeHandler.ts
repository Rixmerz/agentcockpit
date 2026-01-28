import type { GraphNode } from './pipelineService';
import { integrationWrapperService } from './integrationWrapperService';

export interface NodeHandlerContext {
  node: GraphNode;
  projectPath: string;
  currentTask: string;
  nodeVariables: Record<string, unknown>;
}

export interface NodeHandlerResult {
  nodeId: string;
  type: 'standard' | 'integration';
  handled: boolean;
  promptInjection: string;
  exitCondition?: string;
  error?: string;
}

/**
 * Handler for integration nodes in the pipeline graph
 * Intercepts nodes with type: 'integration' and prepares them for wrapper execution
 */
export const integrationNodeHandler = {
  /**
   * Check if a node is an integration node
   */
  isIntegrationNode(node: GraphNode): boolean {
    return node.type === 'integration' && !!node.integration && !!node.wrapper_config;
  },

  /**
   * Handle integration node processing
   */
  async handleIntegrationNode(context: NodeHandlerContext): Promise<NodeHandlerResult> {
    const { node, projectPath, currentTask, nodeVariables } = context;

    // Validate it's an integration node
    if (!this.isIntegrationNode(node)) {
      return {
        nodeId: node.id,
        type: node.type || 'standard',
        handled: false,
        promptInjection: '',
        error: 'Not an integration node'
      };
    }

    try {
      const integrationId = node.integration!;
      const wrapperConfig = node.wrapper_config!;

      // Validate integration is installed
      const validation = await integrationWrapperService.validateIntegration(integrationId);
      if (!validation.valid) {
        return {
          nodeId: node.id,
          type: 'integration',
          handled: false,
          promptInjection: '',
          error: validation.message
        };
      }

      // Get manifest for additional metadata
      const manifest = await integrationWrapperService.getIntegrationManifest(integrationId);
      if (!manifest) {
        return {
          nodeId: node.id,
          type: 'integration',
          handled: false,
          promptInjection: '',
          error: `Manifest not found for integration: ${integrationId}`
        };
      }

      // Prepare wrapper context
      const wrapperContext = {
        integrationId,
        projectPath,
        currentTask,
        variables: nodeVariables
      };

      // Build prompt injection that tells Claude to execute the entry skill
      const promptInjection = buildIntegrationPrompt(
        node,
        manifest,
        wrapperConfig,
        wrapperContext
      );

      return {
        nodeId: node.id,
        type: 'integration',
        handled: true,
        promptInjection,
        exitCondition: wrapperConfig.exit_signal,
        error: undefined
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        nodeId: node.id,
        type: 'integration',
        handled: false,
        promptInjection: '',
        error: `Integration node handler error: ${errorMsg}`
      };
    }
  },

  /**
   * Check if output contains the exit condition for an integration
   */
  checkExitCondition(output: string, exitSignal: string): boolean {
    return output.includes(exitSignal);
  },

  /**
   * Extract next node from exit signal and edges
   */
  getNextNode(exitSignal: string, currentNodeId: string, edges: any[]): string | null {
    const matchingEdges = edges.filter(
      edge =>
        edge.from === currentNodeId &&
        edge.condition?.type === 'phrase' &&
        edge.condition?.phrases?.includes(exitSignal)
    );

    if (matchingEdges.length === 0) return null;

    // Return highest priority edge
    const sorted = matchingEdges.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return sorted[0]?.to || null;
  }
};

/**
 * Build prompt injection for integration node execution
 */
function buildIntegrationPrompt(
  node: GraphNode,
  manifest: any,
  wrapperConfig: any,
  wrapperContext: any
): string {
  return `
═══════════════════════════════════════════════════════════════════
INTEGRATION NODE: ${node.name}
═══════════════════════════════════════════════════════════════════

Integration: ${manifest.name} v${manifest.version}
Entry Skill: ${wrapperConfig.entry_skill}
Exit Condition: ${wrapperConfig.exit_signal}

CRITICAL INSTRUCTIONS:

1. PAUSE AgentCockpit hooks
   - PreToolUse, PostToolUse will be temporarily disabled
   - ${manifest.name} hooks will take control

2. EXECUTE Entry Skill
   You MUST execute this skill with the context below:
   ${wrapperConfig.entry_skill}

   Context:
   ${JSON.stringify(wrapperContext, null, 2)}

3. DELEGATE TO INTEGRATION
   ${manifest.name} will manage:
   ${manifest.provides.agents?.map((a: string) => `   - ${a}`).join('\n') || '   - (agents)'}

4. MONITOR FOR EXIT CONDITION
   When you receive the signal: "${wrapperConfig.exit_signal}"
   Emit it EXACTLY as shown above to trigger next node transition.

5. RESTORE AgentCockpit hooks
   After exit signal, normal AgentCockpit control resumes.

Timeout: ${wrapperConfig.timeout_minutes} minutes
Fallback edge: ${wrapperConfig.fallback_edge || 'none'}

Node prompt injection:
${node.prompt_injection || '(no custom prompt)'}

═══════════════════════════════════════════════════════════════════
  `;
}
