import { readClaudeSettings, writeClaudeSettings, ClaudeSettings } from './hookService';

export interface HookState {
  hooked: boolean;
  paused: boolean;
  pausedAt: string;
  integration: string;
  timestamp: string;
}

/**
 * Service for pausing and resuming AgentCockpit hooks during integration execution
 *
 * When an integration node is entered:
 * 1. Pause AgentCockpit's PreToolUse and PostToolUse hooks
 * 2. Let integration hooks take control
 * 3. Resume AgentCockpit hooks after integration completes
 */
export const hookPauseResumeService = {
  // Track pause state in memory (single instance per app)
  pauseState: {
    currentlyPaused: false,
    pausedIntegration: null as string | null,
    savedHooks: null as ClaudeSettings | null
  },

  /**
   * Pause AgentCockpit hooks (save and disable)
   */
  async pauseAgentCockpitHooks(projectPath: string, integrationId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Don't pause twice
      if (this.pauseState.currentlyPaused) {
        return { success: false, message: 'Hooks already paused' };
      }

      // Read current settings
      const settings = await readClaudeSettings(projectPath);
      if (!settings) {
        return { success: false, message: 'Could not read .claude/settings.json' };
      }

      // Save current hooks
      this.pauseState.savedHooks = JSON.parse(JSON.stringify(settings));
      this.pauseState.currentlyPaused = true;
      this.pauseState.pausedIntegration = integrationId;

      // Disable AgentCockpit hooks by clearing them
      // PreToolUse, PostToolUse, UserPromptSubmit, etc.
      if (settings.hooks) {
        settings.hooks.PreToolUse = [];
        settings.hooks.PostToolUse = [];
        settings.hooks.UserPromptSubmit = [];
        // Keep other hooks if they exist
      }

      // Mark as paused (for UI/logging)
      settings._agentcockpit_hooks_paused = {
        paused: true,
        pausedAt: new Date().toISOString(),
        integration: integrationId
      };

      // Write paused settings
      const success = await writeClaudeSettings(projectPath, settings);
      if (!success) {
        // Restore state on write failure
        this.pauseState.currentlyPaused = false;
        this.pauseState.pausedIntegration = null;
        this.pauseState.savedHooks = null;
        return { success: false, message: 'Could not write paused settings' };
      }

      console.log(`[HookPauseResume] Paused AgentCockpit hooks for ${integrationId}`);
      return { success: true, message: `AgentCockpit hooks paused for ${integrationId}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Pause failed: ${msg}` };
    }
  },

  /**
   * Resume AgentCockpit hooks (restore saved hooks)
   */
  async resumeAgentCockpitHooks(projectPath: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if there are saved hooks to restore
      if (!this.pauseState.currentlyPaused || !this.pauseState.savedHooks) {
        return { success: false, message: 'No paused hooks to resume' };
      }

      const integration = this.pauseState.pausedIntegration;

      // Restore saved hooks
      const success = await writeClaudeSettings(projectPath, this.pauseState.savedHooks);
      if (!success) {
        return { success: false, message: 'Could not write resumed settings' };
      }

      // Clear pause state
      this.pauseState.currentlyPaused = false;
      this.pauseState.pausedIntegration = null;
      this.pauseState.savedHooks = null;

      console.log(`[HookPauseResume] Resumed AgentCockpit hooks (was paused for ${integration})`);
      return { success: true, message: 'AgentCockpit hooks resumed' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Resume failed: ${msg}` };
    }
  },

  /**
   * Get current pause state
   */
  getPauseState(): HookState {
    return {
      hooked: true,
      paused: this.pauseState.currentlyPaused,
      pausedAt: this.pauseState.currentlyPaused ? new Date().toISOString() : '',
      integration: this.pauseState.pausedIntegration || '',
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Force resume (emergency recovery)
   * Use if integration crashes and leaves hooks paused
   */
  async forceResume(projectPath: string): Promise<{ success: boolean; message: string }> {
    try {
      // If we have saved hooks, restore them
      if (this.pauseState.savedHooks) {
        const success = await writeClaudeSettings(projectPath, this.pauseState.savedHooks);
        if (success) {
          this.pauseState.currentlyPaused = false;
          this.pauseState.pausedIntegration = null;
          this.pauseState.savedHooks = null;
          console.log('[HookPauseResume] Force resumed hooks from saved state');
          return { success: true, message: 'Hooks force resumed from saved state' };
        }
      }

      // Otherwise, read current settings and ensure hooks are enabled
      const settings = await readClaudeSettings(projectPath);
      if (!settings) {
        return { success: false, message: 'Could not read settings for force resume' };
      }

      // Remove pause marker
      delete (settings as any)._agentcockpit_hooks_paused;

      const success = await writeClaudeSettings(projectPath, settings);
      if (success) {
        this.pauseState.currentlyPaused = false;
        this.pauseState.pausedIntegration = null;
        this.pauseState.savedHooks = null;
        console.log('[HookPauseResume] Force resumed hooks (cleared pause marker)');
        return { success: true, message: 'Hooks force resumed' };
      }

      return { success: false, message: 'Force resume write failed' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Force resume failed: ${msg}` };
    }
  }
};
