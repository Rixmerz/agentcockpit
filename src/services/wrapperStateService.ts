import { homeDir } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs';

export interface ExecutionStage {
  stage: string;
  timestamp: string;
  status: 'running' | 'completed' | 'failed';
  details?: Record<string, unknown>;
  duration?: number;
  error?: string;
}

export interface WrapperExecutionState {
  executionId: string;
  integrationId: string;
  projectPath: string;
  task: string;
  status: 'initializing' | 'running' | 'completed' | 'failed' | 'timeout';
  startTime: string;
  endTime?: string;
  stages: ExecutionStage[];
  output?: string;
  exitSignal?: string;
  error?: string;
  metadata: {
    version: string;
    agentcockpitVersion: string;
    integrationVersion: string;
  };
}

/**
 * Phase 5: Wrapper State Persistence Service
 *
 * Persists execution state to disk for:
 * - Recovery from failures
 * - Audit trail / logging
 * - Progress tracking
 * - Debugging
 */
export const wrapperStateService = {
  /**
   * Get executions directory
   */
  async getExecutionsDir(): Promise<string> {
    const home = await homeDir();
    const homePath = home.endsWith('/') ? home.slice(0, -1) : home;
    return `${homePath}/.agentcockpit/executions`;
  },

  /**
   * Create execution state directory
   */
  async ensureExecutionDir(executionId: string): Promise<string> {
    const execDir = await this.getExecutionsDir();
    const executionPath = `${execDir}/${executionId}`;

    if (!(await exists(execDir))) {
      await mkdir(execDir, { recursive: true });
    }
    if (!(await exists(executionPath))) {
      await mkdir(executionPath, { recursive: true });
    }

    return executionPath;
  },

  /**
   * Create new execution state
   */
  async createState(
    executionId: string,
    integrationId: string,
    projectPath: string,
    task: string
  ): Promise<WrapperExecutionState> {
    const state: WrapperExecutionState = {
      executionId,
      integrationId,
      projectPath,
      task,
      status: 'initializing',
      startTime: new Date().toISOString(),
      stages: [],
      metadata: {
        version: '1.0.0',
        agentcockpitVersion: '3.0.0',
        integrationVersion: '1.0.0'
      }
    };

    await this.saveState(executionId, state);
    return state;
  },

  /**
   * Save execution state to disk
   */
  async saveState(executionId: string, state: WrapperExecutionState): Promise<boolean> {
    try {
      const executionPath = await this.ensureExecutionDir(executionId);
      const statePath = `${executionPath}/state.json`;

      const content = JSON.stringify(state, null, 2);
      await writeTextFile(statePath, content);

      console.log(`[WrapperState] Saved state for execution: ${executionId}`);
      return true;
    } catch (error) {
      console.error(`[WrapperState] Error saving state:`, error);
      return false;
    }
  },

  /**
   * Load execution state from disk
   */
  async loadState(executionId: string): Promise<WrapperExecutionState | null> {
    try {
      const executionPath = await this.ensureExecutionDir(executionId);
      const statePath = `${executionPath}/state.json`;

      if (!(await exists(statePath))) {
        return null;
      }

      const content = await readTextFile(statePath);
      const state: WrapperExecutionState = JSON.parse(content);
      return state;
    } catch (error) {
      console.error(`[WrapperState] Error loading state:`, error);
      return null;
    }
  },

  /**
   * Add execution stage
   */
  async addStage(
    executionId: string,
    stage: string,
    status: 'running' | 'completed' | 'failed',
    details?: Record<string, unknown>,
    error?: string
  ): Promise<boolean> {
    try {
      const state = await this.loadState(executionId);
      if (!state) {
        console.warn(`[WrapperState] State not found for execution: ${executionId}`);
        return false;
      }

      const executionStage: ExecutionStage = {
        stage,
        timestamp: new Date().toISOString(),
        status,
        details,
        error
      };

      state.stages.push(executionStage);

      // Update status based on stage
      if (stage === 'complete') {
        state.status = status === 'failed' ? 'failed' : 'completed';
        state.endTime = new Date().toISOString();
      } else if (status === 'failed') {
        state.status = 'failed';
        state.error = error;
      }

      await this.saveState(executionId, state);
      return true;
    } catch (error) {
      console.error(`[WrapperState] Error adding stage:`, error);
      return false;
    }
  },

  /**
   * Update execution output
   */
  async updateOutput(executionId: string, output: string, exitSignal?: string): Promise<boolean> {
    try {
      const state = await this.loadState(executionId);
      if (!state) {
        console.warn(`[WrapperState] State not found for execution: ${executionId}`);
        return false;
      }

      state.output = output;
      if (exitSignal) {
        state.exitSignal = exitSignal;
      }

      await this.saveState(executionId, state);
      return true;
    } catch (error) {
      console.error(`[WrapperState] Error updating output:`, error);
      return false;
    }
  },

  /**
   * Mark execution as running
   */
  async markRunning(executionId: string): Promise<boolean> {
    try {
      const state = await this.loadState(executionId);
      if (!state) return false;

      state.status = 'running';
      await this.saveState(executionId, state);
      return true;
    } catch (error) {
      console.error(`[WrapperState] Error marking running:`, error);
      return false;
    }
  },

  /**
   * Mark execution as completed
   */
  async markCompleted(executionId: string, exitSignal: string): Promise<boolean> {
    try {
      const state = await this.loadState(executionId);
      if (!state) return false;

      state.status = 'completed';
      state.endTime = new Date().toISOString();
      state.exitSignal = exitSignal;

      await this.saveState(executionId, state);
      console.log(`[WrapperState] Execution completed: ${executionId}`);
      return true;
    } catch (error) {
      console.error(`[WrapperState] Error marking completed:`, error);
      return false;
    }
  },

  /**
   * Mark execution as failed
   */
  async markFailed(executionId: string, error: string): Promise<boolean> {
    try {
      const state = await this.loadState(executionId);
      if (!state) return false;

      state.status = 'failed';
      state.endTime = new Date().toISOString();
      state.error = error;

      await this.saveState(executionId, state);
      console.error(`[WrapperState] Execution failed: ${executionId} - ${error}`);
      return true;
    } catch (err) {
      console.error(`[WrapperState] Error marking failed:`, err);
      return false;
    }
  },

  /**
   * Mark execution as timeout
   */
  async markTimeout(executionId: string, timeoutMinutes: number): Promise<boolean> {
    try {
      const state = await this.loadState(executionId);
      if (!state) return false;

      state.status = 'timeout';
      state.endTime = new Date().toISOString();
      state.error = `Timeout after ${timeoutMinutes} minutes`;

      await this.saveState(executionId, state);
      console.warn(`[WrapperState] Execution timeout: ${executionId}`);
      return true;
    } catch (error) {
      console.error(`[WrapperState] Error marking timeout:`, error);
      return false;
    }
  },

  /**
   * List all execution IDs
   */
  async listExecutions(): Promise<string[]> {
    try {
      const execDir = await this.getExecutionsDir();

      if (!(await exists(execDir))) {
        return [];
      }

      const entries = await readDir(execDir);
      return entries
        .filter(entry => entry.isDirectory)
        .map(entry => entry.name)
        .sort();
    } catch (error) {
      console.error(`[WrapperState] Error listing executions:`, error);
      return [];
    }
  },

  /**
   * Get execution summary
   */
  async getSummary(executionId: string): Promise<string | null> {
    try {
      const state = await this.loadState(executionId);
      if (!state) return null;

      const duration = state.endTime
        ? new Date(state.endTime).getTime() - new Date(state.startTime).getTime()
        : new Date().getTime() - new Date(state.startTime).getTime();

      const durationMin = Math.floor(duration / 60000);
      const durationSec = Math.floor((duration % 60000) / 1000);

      return `
Execution Summary: ${executionId}
═══════════════════════════════════════════════════════════
Integration: ${state.integrationId}
Status: ${state.status}
Duration: ${durationMin}m ${durationSec}s
Stages Completed: ${state.stages.length}
Start: ${state.startTime}
End: ${state.endTime || 'Running...'}
${state.exitSignal ? `Exit Signal: ${state.exitSignal}` : ''}
${state.error ? `Error: ${state.error}` : ''}
═══════════════════════════════════════════════════════════
      `.trim();
    } catch (error) {
      console.error(`[WrapperState] Error getting summary:`, error);
      return null;
    }
  }
};
