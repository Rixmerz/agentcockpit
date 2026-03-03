/**
 * Git Core — Internal shared utilities for git sub-modules.
 * NOT re-exported from the barrel (gitService.ts).
 */

import { invoke } from '@tauri-apps/api/core';
import { withTimeout, TimeoutError } from '../../core/utils/promiseTimeout';
import { backgroundPtyService } from '../backgroundPtyService';

// Timeout for execute_command operations (prevents infinite hangs in bundled app)
export const INVOKE_TIMEOUT_MS = 5000;

// Flag to enable background PTY for snapshot git commands
// Set to false to revert to execute_command behavior (for debugging)
export const USE_BACKGROUND_PTY = true;

// Execute git command in project directory with timeout
// For snapshot tag commands, uses background PTY to avoid TCC cascade
// NOTE: commit is NOT fire-and-forget because we need the commit hash for subsequent operations
export async function execGit(projectPath: string, args: string): Promise<string> {
  // Only use background PTY for truly fire-and-forget commands
  // commit is EXCLUDED because createCommit() needs to get the commit hash afterwards
  // and that requires the commit to be fully complete before rev-parse runs
  const isFireAndForgetCommand =
    args.startsWith('add -A') ||
    args.startsWith('tag snapshot-');

  if (USE_BACKGROUND_PTY && isFireAndForgetCommand) {
    // Execute via background PTY (fire-and-forget, no return value)
    // This prevents TCC permission cascade in bundled macOS app
    await backgroundPtyService.execGit(projectPath, args);
    return ''; // Empty string, callers don't use return value for these commands
  }

  // For other git commands (status, diff, log, etc.), use execute_command with timeout
  try {
    const result = await withTimeout(
      invoke<string>('execute_command', {
        cmd: `git ${args}`,
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      `git ${args.substring(0, 50)}`
    );
    return result.trim();
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error(`[GitService] Timeout: ${error.message}`);
      throw new Error(`Git timeout: ${args.substring(0, 50)}`);
    }
    const errorStr = String(error);
    // Re-throw with more context
    throw new Error(`Git error: ${errorStr}`);
  }
}

// Execute git command, return null on error instead of throwing
export async function execGitSafe(projectPath: string, args: string): Promise<string | null> {
  try {
    return await execGit(projectPath, args);
  } catch {
    return null;
  }
}
