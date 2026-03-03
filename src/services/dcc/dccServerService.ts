/**
 * DCC Server Service — server lifecycle, warmup
 */

import { dccState, ensureDccServer } from './_dccInternal';
import { isDeltaCodeCubeInstalled } from './dccInstallService';

/** Check if DCC server is already running for a given project (no server start) */
export function isDccServerRunningFor(projectPath: string): boolean {
  return dccState.serverStartedForProject === projectPath;
}

/**
 * Pre-start DCC MCP server for a project (fire-and-forget).
 * Call at app startup or project switch so DCC is ready when needed.
 */
export function warmupDccServer(projectPath: string): void {
  isDeltaCodeCubeInstalled().then(installed => {
    if (!installed) return;
    ensureDccServer(projectPath).catch(err => {
      console.warn('[DCC] Warmup failed (will retry later):', err);
    });
  }).catch(() => {});
}
