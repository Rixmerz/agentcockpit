/**
 * Background PTY Service
 *
 * Manages invisible PTY processes for git snapshot commands.
 * Prevents TCC permission cascade by using PTY instead of execute_command.
 *
 * Why this works:
 * - PTY inherits authorization from parent process (app)
 * - macOS already granted permissions when user opened project
 * - PTY does NOT trigger TCC because it uses authorized shell session
 *
 * Lifecycle: PTYs live entire app session, auto-cleanup on app close.
 */

import { ptySpawn, ptyWrite, ptyClose } from './tauriService';

class BackgroundPtyService {
  // Map of project path to PTY ID
  private ptyMap = new Map<string, number>();

  // Track initialization promises to prevent race conditions
  private initMap = new Map<string, Promise<number>>();

  /**
   * Ensure a PTY exists for the given project path.
   * Creates new PTY if needed, reuses existing if available.
   */
  private async ensurePty(projectPath: string): Promise<number> {
    // Return existing PTY if available
    const existingPtyId = this.ptyMap.get(projectPath);
    if (existingPtyId !== undefined) {
      return existingPtyId;
    }

    // Check if initialization is in progress (prevents duplicate spawns)
    const initPromise = this.initMap.get(projectPath);
    if (initPromise) {
      return initPromise;
    }

    // Create new PTY
    const promise = this._spawnPty(projectPath);
    this.initMap.set(projectPath, promise);

    try {
      const ptyId = await promise;
      this.ptyMap.set(projectPath, ptyId);
      this.initMap.delete(projectPath);
      return ptyId;
    } catch (error) {
      this.initMap.delete(projectPath);
      throw error;
    }
  }

  /**
   * Spawn a new invisible PTY for git commands
   */
  private async _spawnPty(projectPath: string): Promise<number> {
    // Minimal size for invisible PTY (no rendering needed)
    const cols = 80;
    const rows = 24;

    try {
      const ptyId = await ptySpawn('/bin/zsh', projectPath, cols, rows);
      console.log(`[BackgroundPTY] Spawned for ${projectPath} (ID: ${ptyId})`);

      // No output listeners needed - completely invisible
      // This PTY is fire-and-forget for git commands

      return ptyId;
    } catch (error) {
      console.error(`[BackgroundPTY] Failed to spawn for ${projectPath}:`, error);
      throw error;
    }
  }

  /**
   * Execute a git command in the background PTY
   * Waits a short delay to allow command to complete before returning
   *
   * @param projectPath - Absolute path to project
   * @param args - Git command arguments (e.g., 'add -A', 'commit -m "msg"')
   */
  async execGit(projectPath: string, args: string): Promise<void> {
    try {
      const ptyId = await this.ensurePty(projectPath);

      // Execute command
      // Add newline to execute the command
      const command = `git ${args}\n`;
      console.log(`[BackgroundPTY] Executing: git ${args.substring(0, 60)}`);
      await ptyWrite(ptyId, command);

      // Wait for command to likely complete
      // Git add/commit/tag are fast operations (~100-300ms)
      // This delay allows the command to finish before the next one starts
      await this.waitForCompletion(args);
      console.log(`[BackgroundPTY] Completed: git ${args.substring(0, 30)}`);

    } catch (error) {
      // Log error but don't throw - snapshots are non-critical
      // If background PTY fails, we just skip the snapshot
      console.warn(`[BackgroundPTY] Git command failed: git ${args}`, error);
    }
  }

  /**
   * Wait appropriate time for command to complete
   * Different commands need different wait times
   */
  private async waitForCompletion(args: string): Promise<void> {
    let delayMs = 200; // Default delay

    if (args.startsWith('add')) {
      // git add can take longer with many files
      delayMs = 300;
    } else if (args.startsWith('commit')) {
      // git commit needs time to write objects
      delayMs = 400;
    } else if (args.startsWith('tag')) {
      // git tag is fast
      delayMs = 150;
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  /**
   * Close PTY for a specific project
   * Optional: auto-cleanup happens when app closes
   */
  async closePty(projectPath: string): Promise<void> {
    const ptyId = this.ptyMap.get(projectPath);
    if (ptyId !== undefined) {
      try {
        await ptyClose(ptyId);
        this.ptyMap.delete(projectPath);
        console.log(`[BackgroundPTY] Closed for ${projectPath}`);
      } catch (error) {
        console.warn(`[BackgroundPTY] Failed to close PTY for ${projectPath}:`, error);
      }
    }
  }

  /**
   * Close all PTYs (called on app shutdown if needed)
   */
  async closeAll(): Promise<void> {
    const promises = Array.from(this.ptyMap.entries()).map(([, id]) =>
      ptyClose(id).catch(err =>
        console.warn(`[BackgroundPTY] Failed to close PTY ${id}:`, err)
      )
    );

    await Promise.all(promises);
    this.ptyMap.clear();
    this.initMap.clear();
    console.log('[BackgroundPTY] All PTYs closed');
  }

  /**
   * Check if a PTY exists for a project
   */
  hasPty(projectPath: string): boolean {
    return this.ptyMap.has(projectPath);
  }

  /**
   * Get count of active PTYs (for debugging)
   */
  getActivePtyCount(): number {
    return this.ptyMap.size;
  }
}

// Singleton instance - one service for entire app
export const backgroundPtyService = new BackgroundPtyService();
