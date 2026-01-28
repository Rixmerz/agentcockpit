import { mcpSkillExecutor } from './mcpSkillExecutor';

/**
 * Service for executing skills with context passing
 *
 * Phase 4 Implementation:
 * Uses mcpSkillExecutor to invoke real skills via MCP system.
 * Skills are defined in .claude/skills/{skillName}/SKILL.md
 */

export interface SkillContext {
  skillName: string;
  projectPath: string;
  currentTask: string;
  variables: Record<string, unknown>;
  timeout?: number;
}

export interface SkillExecutionResult {
  success: boolean;
  skillName: string;
  output: string;
  startTime: number;
  endTime: number;
  duration: number;
  error?: string;
  exitSignal?: string;
}

export const skillExecutionService = {
  /**
   * Execute a skill with context (Phase 4: Real MCP execution)
   */
  async executeSkill(context: SkillContext): Promise<SkillExecutionResult> {
    const startTime = Date.now();

    try {
      // Validate skill name
      if (!context.skillName.startsWith('/')) {
        return {
          success: false,
          skillName: context.skillName,
          output: '',
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          error: 'Skill name must start with /'
        };
      }

      // Phase 4: Use real MCP skill executor
      const mcpResult = await mcpSkillExecutor.executeSkill({
        skillName: context.skillName,
        projectPath: context.projectPath,
        currentTask: context.currentTask,
        variables: context.variables,
        timeout: context.timeout
      });

      return {
        success: mcpResult.success,
        skillName: context.skillName,
        output: mcpResult.output,
        startTime,
        endTime: Date.now(),
        duration: mcpResult.duration,
        error: mcpResult.error,
        exitSignal: mcpResult.metadata?.exitSignal
      };
    } catch (error) {
      return {
        success: false,
        skillName: context.skillName,
        output: '',
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },

  /**
   * Build context string for skill injection
   */
  buildContextString(context: SkillContext): string {
    return `
SKILL EXECUTION CONTEXT
═════════════════════════════════════════════════════════════

Skill: ${context.skillName}
Project: ${context.projectPath}
Task: ${context.currentTask}
Timestamp: ${new Date().toISOString()}
Timeout: ${context.timeout || 'default'} seconds

Variables:
${JSON.stringify(context.variables, null, 2)}

═════════════════════════════════════════════════════════════
    `.trim();
  },

  /**
   * Execute /agentful-start skill specifically
   * (wrapper entry point for Agentful integration)
   */
  async executeAgentfulStart(wrapperContext: {
    projectPath: string;
    plan: string;
    stack: string;
    task: string;
    variables?: Record<string, unknown>;
  }): Promise<SkillExecutionResult> {
    const startTime = Date.now();

    try {
      // Phase 4: Use real MCP executor
      const mcpResult = await mcpSkillExecutor.executeAgentfulStart({
        projectPath: wrapperContext.projectPath,
        plan: wrapperContext.plan,
        stack: wrapperContext.stack,
        task: wrapperContext.task,
        variables: wrapperContext.variables || {}
      });

      return {
        success: mcpResult.success,
        skillName: '/agentful-start',
        output: mcpResult.output,
        startTime,
        endTime: Date.now(),
        duration: mcpResult.duration,
        error: mcpResult.error,
        exitSignal: mcpResult.metadata?.exitSignal
      };
    } catch (error) {
      return {
        success: false,
        skillName: '/agentful-start',
        output: '',
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  },

  /**
   * Monitor skill output for exit signal
   */
  monitorForExitSignal(
    output: string,
    exitSignal: string,
    timeoutMs: number
  ): Promise<{ detected: boolean; time: number }> {
    return new Promise(resolve => {
      const startTime = Date.now();

      // Check immediately
      if (output.includes(exitSignal)) {
        resolve({ detected: true, time: Date.now() - startTime });
        return;
      }

      // Set timeout
      const timeout = setTimeout(() => {
        resolve({ detected: false, time: Date.now() - startTime });
      }, timeoutMs);

      // In real implementation, would monitor output stream
      const checkInterval = setInterval(() => {
        if (output.includes(exitSignal)) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve({ detected: true, time: Date.now() - startTime });
        }
      }, 100);
    });
  }
};
