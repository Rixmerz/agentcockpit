/**
 * Phase 6: Integration Execution Demo
 *
 * Demonstrates the full wrapper execution flow:
 * 1. Setup integration
 * 2. Create execution state
 * 3. Simulate execution stages
 * 4. Generate realistic output
 * 5. Verify state persistence
 *
 * Use this to test the complete system or as a reference for production implementation.
 */

import { phase3WrapperExecutor } from './phase3WrapperExecutor';
import { wrapperStateService } from './wrapperStateService';
import { agentfulIntegrationService } from './agentfulIntegrationService';
import { marketplaceService } from './marketplaceService';

export interface DemoExecutionResult {
  success: boolean;
  executionId: string;
  duration: number;
  message: string;
  stages: string[];
}

/**
 * Run a complete demo workflow
 * This will:
 * 1. Check marketplace integration
 * 2. Execute wrapper with realistic output
 * 3. Persist state to disk
 * 4. Display execution summary
 */
export const integrationExecutionDemo = {
  /**
   * Quick test: Create and complete a test execution
   */
  async quickTest(projectPath: string): Promise<DemoExecutionResult> {
    console.log('[Demo] Starting quick test...');

    const executionId = `demo-exec-${Date.now()}-quick`;

    try {
      // Check marketplace
      const agentfulStatus = await marketplaceService.getStatus('agentful');
      if (!agentfulStatus) {
        console.warn('[Demo] Agentful not in marketplace');
      }

      // Create state
      await wrapperStateService.createState(
        executionId,
        'agentful',
        projectPath,
        'Demo: Build AI Assistant'
      );

      // Simulate stages
      const stages = [
        'validation',
        'manifest',
        'pause-hooks',
        'skill-execution',
        'monitor-signal',
        'resume-hooks'
      ];

      for (const stage of stages) {
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms per stage
        await wrapperStateService.addStage(executionId, stage, 'completed');
      }

      // Simulate output
      const mockOutput = await agentfulIntegrationService.simulateAgentfulOutput({
        projectPath,
        plan: 'Build an AI assistant',
        stack: 'deno-fresh',
        task: 'Create API endpoints and frontend',
        variables: {}
      } as any);

      // Update output and complete
      await wrapperStateService.updateOutput(executionId, mockOutput, 'AGENTFUL_COMPLETE');
      await wrapperStateService.markCompleted(executionId, 'AGENTFUL_COMPLETE');

      // Get summary
      const summary = await wrapperStateService.getSummary(executionId);
      console.log(summary);

      return {
        success: true,
        executionId,
        duration: 1200,
        message: 'Quick test completed successfully',
        stages
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Demo] Quick test failed:', msg);
      await wrapperStateService.markFailed(executionId, msg);

      return {
        success: false,
        executionId,
        duration: 0,
        message: `Quick test failed: ${msg}`,
        stages: []
      };
    }
  },

  /**
   * Full demo: Execute with realistic timing and output
   */
  async fullDemo(projectPath: string): Promise<DemoExecutionResult> {
    console.log('[Demo] Starting full demo with realistic execution...');

    const executionId = `demo-exec-${Date.now()}-full`;
    const startTime = Date.now();

    try {
      // Phase 1: Create state
      console.log('[Demo] Phase 1: Creating execution state...');
      await wrapperStateService.createState(
        executionId,
        'agentful',
        projectPath,
        'Demo: Build Full-Stack AI Platform'
      );
      await wrapperStateService.markRunning(executionId);

      // Phase 2: Validation (1s)
      console.log('[Demo] Phase 2: Validation stage...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await wrapperStateService.addStage(executionId, 'validation', 'completed', {
        integrationId: 'agentful',
        status: 'valid'
      });

      // Phase 3: Manifest (500ms)
      console.log('[Demo] Phase 3: Get manifest...');
      await new Promise(resolve => setTimeout(resolve, 500));
      await wrapperStateService.addStage(executionId, 'manifest', 'completed', {
        integration: 'agentful',
        version: '1.0.0'
      });

      // Phase 4: Pause hooks (500ms)
      console.log('[Demo] Phase 4: Pause hooks...');
      await new Promise(resolve => setTimeout(resolve, 500));
      await wrapperStateService.addStage(executionId, 'pause-hooks', 'completed', {
        pausedCount: 2
      });

      // Phase 5: Execute skill (3s) - this is the main work
      console.log('[Demo] Phase 5: Execute entry skill (/agentful-start)...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      const skillOutput = await agentfulIntegrationService.simulateAgentfulOutput({
        projectPath,
        plan: 'Full-stack AI platform with agents',
        stack: 'deno-fresh',
        task: 'Build scalable AI assistant platform',
        variables: {}
      } as any);

      await wrapperStateService.addStage(executionId, 'skill-execution', 'completed', {
        skill: '/agentful-start',
        agents: 8,
        exitSignal: 'AGENTFUL_COMPLETE'
      });

      // Phase 6: Monitor signal (500ms)
      console.log('[Demo] Phase 6: Monitor exit signal...');
      await new Promise(resolve => setTimeout(resolve, 500));
      await wrapperStateService.addStage(executionId, 'monitor-signal', 'completed', {
        signal: 'AGENTFUL_COMPLETE',
        detected: true
      });

      // Phase 7: Resume hooks (500ms)
      console.log('[Demo] Phase 7: Resume hooks...');
      await new Promise(resolve => setTimeout(resolve, 500));
      await wrapperStateService.addStage(executionId, 'resume-hooks', 'completed', {
        resumedCount: 2
      });

      // Phase 8: Complete
      console.log('[Demo] Phase 8: Finalizing...');
      await wrapperStateService.updateOutput(executionId, skillOutput, 'AGENTFUL_COMPLETE');
      await wrapperStateService.markCompleted(executionId, 'AGENTFUL_COMPLETE');

      const duration = Date.now() - startTime;

      // Display summary
      const summary = await wrapperStateService.getSummary(executionId);
      console.log('\n' + summary + '\n');

      return {
        success: true,
        executionId,
        duration,
        message: 'Full demo executed successfully. Check Execution Monitor to view results.',
        stages: [
          'validation',
          'manifest',
          'pause-hooks',
          'skill-execution',
          'monitor-signal',
          'resume-hooks'
        ]
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Demo] Full demo failed:', msg);
      await wrapperStateService.markFailed(executionId, msg);

      return {
        success: false,
        executionId,
        duration: Date.now() - startTime,
        message: `Full demo failed: ${msg}`,
        stages: []
      };
    }
  },

  /**
   * Failed execution demo: Shows error handling and recovery
   */
  async failedExecutionDemo(projectPath: string): Promise<DemoExecutionResult> {
    console.log('[Demo] Starting failed execution demo...');

    const executionId = `demo-exec-${Date.now()}-failed`;

    try {
      // Create and start execution
      await wrapperStateService.createState(
        executionId,
        'agentful',
        projectPath,
        'Demo: Failed Execution'
      );
      await wrapperStateService.markRunning(executionId);

      // Success stages
      await wrapperStateService.addStage(executionId, 'validation', 'completed');
      await wrapperStateService.addStage(executionId, 'manifest', 'completed');
      await wrapperStateService.addStage(executionId, 'pause-hooks', 'completed');

      // Failed stage
      await new Promise(resolve => setTimeout(resolve, 500));
      await wrapperStateService.addStage(
        executionId,
        'skill-execution',
        'failed',
        { skill: '/agentful-start' },
        'Skill execution failed: Connection timeout'
      );

      // Mark as failed
      await wrapperStateService.markFailed(
        executionId,
        'Skill execution failed: Connection timeout'
      );

      const summary = await wrapperStateService.getSummary(executionId);
      console.log('\n' + summary + '\n');

      return {
        success: false,
        executionId,
        duration: 500,
        message: 'Failed execution demo completed. Check Execution Monitor to view error.',
        stages: ['validation', 'manifest', 'pause-hooks', 'skill-execution']
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Demo] Failed execution demo failed:', msg);

      return {
        success: false,
        executionId,
        duration: 0,
        message: `Failed execution demo errored: ${msg}`,
        stages: []
      };
    }
  },

  /**
   * Timeout demo: Shows timeout handling
   */
  async timeoutExecutionDemo(projectPath: string): Promise<DemoExecutionResult> {
    console.log('[Demo] Starting timeout execution demo...');

    const executionId = `demo-exec-${Date.now()}-timeout`;

    try {
      // Create and start execution
      await wrapperStateService.createState(
        executionId,
        'agentful',
        projectPath,
        'Demo: Timeout Execution'
      );
      await wrapperStateService.markRunning(executionId);

      // Add some stages
      await wrapperStateService.addStage(executionId, 'validation', 'completed');
      await wrapperStateService.addStage(executionId, 'manifest', 'completed');
      await wrapperStateService.addStage(executionId, 'pause-hooks', 'completed');
      await wrapperStateService.addStage(executionId, 'skill-execution', 'running');

      // Wait 2 seconds then timeout
      await new Promise(resolve => setTimeout(resolve, 2000));
      await wrapperStateService.markTimeout(executionId, 45);

      const summary = await wrapperStateService.getSummary(executionId);
      console.log('\n' + summary + '\n');

      return {
        success: false,
        executionId,
        duration: 2000,
        message: 'Timeout execution demo completed. Check Execution Monitor to view timeout.',
        stages: ['validation', 'manifest', 'pause-hooks', 'skill-execution']
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Demo] Timeout execution demo failed:', msg);

      return {
        success: false,
        executionId,
        duration: 0,
        message: `Timeout execution demo errored: ${msg}`,
        stages: []
      };
    }
  },

  /**
   * List all demo executions
   */
  async listDemoExecutions(): Promise<string[]> {
    try {
      const allExecutions = await wrapperStateService.listExecutions();
      return allExecutions.filter(id => id.includes('demo-exec'));
    } catch (error) {
      console.error('[Demo] Failed to list demo executions:', error);
      return [];
    }
  },

  /**
   * Clean up demo executions
   */
  async cleanupDemoExecutions(): Promise<number> {
    try {
      const demoExecutions = await this.listDemoExecutions();
      console.log(`[Demo] Cleaning up ${demoExecutions.length} demo executions...`);

      // Note: In production, implement proper deletion
      // For now, just report
      return demoExecutions.length;
    } catch (error) {
      console.error('[Demo] Failed to cleanup demo executions:', error);
      return 0;
    }
  }
};

// Export for CLI/testing
export async function runDemoExecution(
  type: 'quick' | 'full' | 'failed' | 'timeout' = 'quick',
  projectPath: string = '.'
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log('AGENTCOCKPIT - INTEGRATION EXECUTION DEMO');
  console.log(`${'='.repeat(60)}\n`);

  let result;

  switch (type) {
    case 'full':
      result = await integrationExecutionDemo.fullDemo(projectPath);
      break;
    case 'failed':
      result = await integrationExecutionDemo.failedExecutionDemo(projectPath);
      break;
    case 'timeout':
      result = await integrationExecutionDemo.timeoutExecutionDemo(projectPath);
      break;
    case 'quick':
    default:
      result = await integrationExecutionDemo.quickTest(projectPath);
      break;
  }

  console.log(`\n📊 Demo Result:`);
  console.log(`   Type: ${type}`);
  console.log(`   Success: ${result.success ? '✅' : '❌'}`);
  console.log(`   Execution ID: ${result.executionId}`);
  console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
  console.log(`   Message: ${result.message}`);
  console.log(`   Stages: ${result.stages.join(' → ')}`);
  console.log(`\n💡 Next: Open AgentCockpit and check the Execution Monitor panel`);
  console.log(`   to view the execution state and details in real-time.\n`);
}
