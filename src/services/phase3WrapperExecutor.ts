import { integrationWrapperService, WrapperContext } from './integrationWrapperService';
import { hookPauseResumeService } from './hookPauseResumeService';
import { skillExecutionService } from './skillExecutionService';
import { wrapperStateService } from './wrapperStateService';

export interface Phase3ExecutionConfig {
  projectPath: string;
  integrationId: string;
  entrySkill: string;
  exitSignal: string;
  timeoutMinutes: number;
  fallbackEdge?: string;
  context: WrapperContext;
  executionId?: string; // Phase 5: For state persistence
}

export interface Phase3ExecutionResult {
  success: boolean;
  integrationId: string;
  exitSignal: string;
  output: string;
  duration: number;
  stages: string[];
  error?: string;
}

/**
 * Phase 3: Complete wrapper execution orchestrator
 *
 * Orchestrates the full lifecycle:
 * 1. Validate integration
 * 2. Pause AgentCockpit hooks
 * 3. Execute entry skill (/agentful-start)
 * 4. Monitor for exit signal (AGENTFUL_COMPLETE)
 * 5. Resume AgentCockpit hooks
 * 6. Return control to pipeline
 */
export const phase3WrapperExecutor = {
  /**
   * Execute complete wrapper with all phases (Phase 5: With state persistence)
   */
  async executeWrapper(config: Phase3ExecutionConfig): Promise<Phase3ExecutionResult> {
    const startTime = Date.now();
    const stages: string[] = [];

    // Phase 5: Generate execution ID if not provided
    const executionId = config.executionId || `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Phase 5: Create initial state
    await wrapperStateService.createState(
      executionId,
      config.integrationId,
      config.projectPath,
      config.context.currentTask
    );

    try {
      // ===== PHASE 1: Validation =====
      console.log('[Phase3] Stage 1: Validation');
      stages.push('validation');

      // Phase 5: Add stage to state
      await wrapperStateService.addStage(executionId, 'validation', 'running');

      const validation = await integrationWrapperService.validateIntegration(config.integrationId);
      if (!validation.valid) {
        return {
          success: false,
          integrationId: config.integrationId,
          exitSignal: config.exitSignal,
          output: '',
          duration: Date.now() - startTime,
          stages,
          error: validation.message
        };
      }

      // ===== PHASE 2: Get Manifest =====
      console.log('[Phase3] Stage 2: Get Manifest');
      stages.push('manifest');

      const manifest = await integrationWrapperService.getIntegrationManifest(config.integrationId);
      if (!manifest) {
        return {
          success: false,
          integrationId: config.integrationId,
          exitSignal: config.exitSignal,
          output: '',
          duration: Date.now() - startTime,
          stages,
          error: `Manifest not found for ${config.integrationId}`
        };
      }

      // ===== PHASE 3: Pause Hooks =====
      console.log('[Phase3] Stage 3: Pause AgentCockpit Hooks');
      stages.push('pause-hooks');

      const pauseResult = await hookPauseResumeService.pauseAgentCockpitHooks(
        config.projectPath,
        config.integrationId
      );
      if (!pauseResult.success) {
        return {
          success: false,
          integrationId: config.integrationId,
          exitSignal: config.exitSignal,
          output: '',
          duration: Date.now() - startTime,
          stages,
          error: `Hook pause failed: ${pauseResult.message}`
        };
      }

      // ===== PHASE 4: Execute Entry Skill =====
      console.log('[Phase3] Stage 4: Execute Entry Skill');
      stages.push('execute-skill');

      const skillResult = await skillExecutionService.executeSkill({
        skillName: config.entrySkill,
        projectPath: config.projectPath,
        currentTask: config.context.currentTask,
        variables: config.context.variables,
        timeout: config.timeoutMinutes * 60
      });

      if (!skillResult.success) {
        // Attempt to resume hooks before returning error
        await hookPauseResumeService.resumeAgentCockpitHooks(config.projectPath);
        return {
          success: false,
          integrationId: config.integrationId,
          exitSignal: config.exitSignal,
          output: skillResult.output,
          duration: Date.now() - startTime,
          stages,
          error: skillResult.error
        };
      }

      // ===== PHASE 5: Monitor for Exit Signal =====
      console.log('[Phase3] Stage 5: Monitor Exit Signal');
      stages.push('monitor-signal');

      const timeoutMs = config.timeoutMinutes * 60 * 1000;
      const signalResult = await skillExecutionService.monitorForExitSignal(
        skillResult.output,
        config.exitSignal,
        timeoutMs
      );

      if (!signalResult.detected) {
        console.warn(`[Phase3] Exit signal not detected within ${config.timeoutMinutes} minutes`);
        // Try to resume hooks
        await hookPauseResumeService.resumeAgentCockpitHooks(config.projectPath);

        return {
          success: false,
          integrationId: config.integrationId,
          exitSignal: config.exitSignal,
          output: skillResult.output,
          duration: Date.now() - startTime,
          stages,
          error: `Exit signal "${config.exitSignal}" not detected within ${config.timeoutMinutes} minutes. Fallback: ${config.fallbackEdge || 'none'}`
        };
      }

      console.log(`[Phase3] Exit signal detected: ${config.exitSignal}`);

      // ===== PHASE 6: Resume Hooks =====
      console.log('[Phase3] Stage 6: Resume AgentCockpit Hooks');
      stages.push('resume-hooks');

      const resumeResult = await hookPauseResumeService.resumeAgentCockpitHooks(config.projectPath);
      if (!resumeResult.success) {
        console.error(`[Phase3] Hook resume failed: ${resumeResult.message}`);
        // Log but continue - we got the exit signal
      }

      // ===== SUCCESS =====
      console.log(`[Phase3] Wrapper execution completed successfully`);
      stages.push('complete');

      return {
        success: true,
        integrationId: config.integrationId,
        exitSignal: config.exitSignal,
        output: skillResult.output,
        duration: Date.now() - startTime,
        stages
      };
    } catch (error) {
      // Emergency hook resume
      try {
        await hookPauseResumeService.forceResume(config.projectPath);
      } catch (resumeError) {
        console.error('[Phase3] Emergency force resume failed:', resumeError);
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        integrationId: config.integrationId,
        exitSignal: config.exitSignal,
        output: '',
        duration: Date.now() - startTime,
        stages,
        error: `Phase 3 wrapper execution error: ${errorMsg}`
      };
    }
  },

  /**
   * Log execution summary
   */
  logSummary(result: Phase3ExecutionResult): void {
    console.log(`
═══════════════════════════════════════════════════════════════════
PHASE 3 WRAPPER EXECUTION SUMMARY
═══════════════════════════════════════════════════════════════════

Integration: ${result.integrationId}
Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}
Duration: ${(result.duration / 1000).toFixed(2)}s
Exit Signal: ${result.exitSignal}
Stages Completed: ${result.stages.join(' → ')}

${result.error ? `Error: ${result.error}` : 'No errors'}

Output (truncated):
${result.output.substring(0, 200)}${result.output.length > 200 ? '...' : ''}

═══════════════════════════════════════════════════════════════════
    `);
  }
};
