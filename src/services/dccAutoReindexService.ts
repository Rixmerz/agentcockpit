/**
 * DCC Auto-Reindex Service
 *
 * Bridge between gitWatcherService (commit events) and DCC reindexProject().
 * Debounces rapid commits (rebase, cherry-pick) and respects the
 * dccAutoReindex setting toggle.
 */

import { gitWatcherEvents } from '../core/utils/gitWatcherEventBus';
import { reindexProject, isDeltaCodeCubeInstalled, isIndexing } from './deltacodecubeService';
import { indexEvents } from '../core/utils/indexEventBus';
import { fileWatcherService } from './fileWatcherService';

let _enabled = false;
let _projectPath: string | null = null;
let _cleanup: (() => void) | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 5_000;

/**
 * Enable auto-reindex: listens for git commit events and triggers DCC reindex.
 */
export function enableAutoReindex(projectPath: string): void {
  if (_enabled && _projectPath === projectPath) return;

  // Clean up previous listener if any
  disableAutoReindex();

  _projectPath = projectPath;
  _enabled = true;

  _cleanup = gitWatcherEvents.on('commit', (event) => {
    if (!_enabled) return;

    // Debounce: clear previous timer if rapid commits
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
    }

    _debounceTimer = setTimeout(async () => {
      _debounceTimer = null;

      // Skip commit-triggered reindex if native file watcher is active
      // (watcher provides more granular, per-file reindexing)
      const watcherActive = await fileWatcherService.isActive();
      if (watcherActive) {
        return;
      }

      // Guard: DCC must be installed and not already indexing
      const installed = await isDeltaCodeCubeInstalled();
      if (!installed) {
        return;
      }

      if (isIndexing()) {
        return;
      }

      try {
        await reindexProject(event.projectPath);
      } catch (e) {
        console.error('[DCC AutoReindex] Reindex failed:', e);
        indexEvents.emit('error', {
          projectPath: event.projectPath,
          error: `Auto-reindex failed: ${String(e)}`,
          timestamp: Date.now(),
        });
      }
    }, DEBOUNCE_MS);
  });

}

/**
 * Disable auto-reindex: stops listening for commit events.
 */
export function disableAutoReindex(): void {
  if (_cleanup) {
    _cleanup();
    _cleanup = null;
  }

  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  _enabled = false;
  _projectPath = null;
}

/**
 * Check if auto-reindex is currently enabled.
 */
export function isAutoReindexEnabled(): boolean {
  return _enabled;
}
