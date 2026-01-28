import { marketplaceService, IntegrationManifest } from './marketplaceService';

export interface WrapperContext {
  integrationId: string;
  projectPath: string;
  currentTask: string;
  variables: Record<string, unknown>;
  nodeContext?: Record<string, unknown>;
}

export interface WrapperExecutionResult {
  success: boolean;
  exitSignal: string;
  output?: string;
  error?: string;
  executionTime: number;
}

/**
 * Service for managing integration wrapper execution in pipelines
 * Handles:
 * - Pre-execution validation (integration installed, enabled)
 * - Hook pause/resume
 * - Entry skill execution
 * - Exit signal detection
 * - Timeout management
 */
export const integrationWrapperService = {
  /**
   * Validate that integration is properly installed
   */
  async validateIntegration(integrationId: string): Promise<{ valid: boolean; message: string }> {
    try {
      const status = await marketplaceService.getStatus(integrationId);
      if (!status) {
        return { valid: false, message: `Integration ${integrationId} not found` };
      }
      if (status.status === 'available') {
        return { valid: false, message: `Integration ${integrationId} not installed` };
      }
      return { valid: true, message: `Integration ${integrationId} is ready` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Validation failed';
      return { valid: false, message: msg };
    }
  },

  /**
   * Get integration manifest for wrapper config
   */
  async getIntegrationManifest(integrationId: string): Promise<IntegrationManifest | null> {
    const installed = await marketplaceService.listInstalled();
    return installed.find(i => i.id === integrationId) || null;
  },

  /**
   * Prepare wrapper context for integration execution
   * This will inject context into the integration's entry skill
   */
  prepareWrapperContext(context: WrapperContext): string {
    return JSON.stringify({
      integration: context.integrationId,
      project: context.projectPath,
      task: context.currentTask,
      timestamp: new Date().toISOString(),
      variables: context.variables,
      nodeContext: context.nodeContext
    }, null, 2);
  },

  /**
   * Parse exit signal from agent output
   * Looks for exact phrase match (e.g., "AGENTFUL_COMPLETE")
   */
  parseExitSignal(output: string, expectedSignal: string): { detected: boolean; signal: string } {
    const detected = output.includes(expectedSignal);
    return {
      detected,
      signal: expectedSignal
    };
  },

  /**
   * Simulate wrapper execution (Phase 2)
   * In real implementation, this would:
   * 1. Pause AgentCockpit hooks
   * 2. Activate integration hooks
   * 3. Pass control to integration's entry skill
   * 4. Monitor for exit signal
   * 5. Restore AgentCockpit hooks
   */
  async executeWrapper(context: WrapperContext, entrySkill: string, exitSignal: string, timeoutMinutes: number = 60): Promise<WrapperExecutionResult> {
    const startTime = Date.now();
    try {
      // Validate integration exists
      const validation = await this.validateIntegration(context.integrationId);
      if (!validation.valid) {
        return {
          success: false,
          exitSignal,
          error: validation.message,
          executionTime: Date.now() - startTime
        };
      }

      // Get integration manifest
      const manifest = await this.getIntegrationManifest(context.integrationId);
      if (!manifest) {
        return {
          success: false,
          exitSignal,
          error: `Manifest not found for ${context.integrationId}`,
          executionTime: Date.now() - startTime
        };
      }

      // Prepare context
      const wrapperContext = this.prepareWrapperContext(context);

      // Phase 2 TODO: Actual wrapper execution
      // This is a placeholder for the real wrapper logic
      console.log('[IntegrationWrapper] Would execute:', {
        integration: context.integrationId,
        entrySkill,
        exitSignal,
        timeout: timeoutMinutes,
        context: wrapperContext
      });

      // For now, return success placeholder
      // Real implementation will actually execute the skill and monitor output
      return {
        success: true,
        exitSignal,
        output: 'Integration wrapper ready for Phase 2 implementation',
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        exitSignal,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  },

  /**
   * Handle graceful shutdown/pause of wrapper execution
   */
  async abortWrapper(integrationId: string): Promise<{ success: boolean; message: string }> {
    try {
      console.log('[IntegrationWrapper] Aborting integration:', integrationId);
      return { success: true, message: `Integration ${integrationId} abort signal sent` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Abort failed';
      return { success: false, message: msg };
    }
  }
};
