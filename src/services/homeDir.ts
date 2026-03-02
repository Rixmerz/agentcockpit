/**
 * Cross-platform home directory detection.
 * Caches the result after first successful lookup.
 */

import { invoke } from '@tauri-apps/api/core';
import { withTimeout, TimeoutError } from '../core/utils/promiseTimeout';

const TIMEOUT_MS = 3000;

let cachedHome: string | null = null;
let pendingPromise: Promise<string> | null = null;

/**
 * Get the user's home directory dynamically via $HOME.
 * Result is cached for the lifetime of the app.
 */
export async function getHomeDir(): Promise<string> {
  if (cachedHome) return cachedHome;
  if (pendingPromise) return pendingPromise;

  pendingPromise = (async () => {
    try {
      const result = await withTimeout(
        invoke<string>('execute_command', {
          cmd: 'echo $HOME',
          cwd: '/',
        }),
        TIMEOUT_MS,
        'get home directory'
      );
      cachedHome = result.trim();
      return cachedHome;
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.error('[homeDir] Timeout getting HOME:', error.message);
      }
      // Fallback: try common Linux/macOS paths
      cachedHome = '/tmp';
      return cachedHome;
    } finally {
      pendingPromise = null;
    }
  })();

  return pendingPromise;
}

/**
 * Replace home directory prefix with ~ for display.
 */
export function shortenPath(path: string, home: string): string {
  if (home && path.startsWith(home)) {
    return '~' + path.slice(home.length);
  }
  return path;
}

/**
 * Expand ~ to the actual home directory.
 */
export function expandTilde(path: string, home: string): string {
  if (path.startsWith('~')) {
    return home + path.slice(1);
  }
  return path;
}
