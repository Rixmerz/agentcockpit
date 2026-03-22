/**
 * DCC Internal — Shared infrastructure for DCC sub-modules.
 * NOT re-exported from the barrel (deltacodecubeService.ts).
 */

import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { withTimeout } from '../../core/utils/promiseTimeout';
import {
  loadMcpConfig,
  getAgentcockpitPath,
  type McpServerConfig,
} from '../mcpConfigService';
import type { GradeDistribution, IndexStats } from './dccTypes';

export const DCC_NAME = 'deltacodecube';

// =====================================================
// Mutable State (shared across all DCC modules)
// =====================================================

class DccStateManager {
  private _installedCache: boolean | undefined = undefined;
  private _installedPromise: Promise<boolean> | null = null;
  private _dccPathCache: string | null | undefined = undefined;
  private _dccPathPromise: Promise<string | null> | null = null;
  private _serverStartedForProject: string | null = null;
  private _serverStartPromise: Promise<void> | null = null;
  private _serverStartFailedAt: number | null = null;
  private _indexingInProgress = false;
  private _homeDirCache: string | null = null;

  get installedCache() { return this._installedCache; }
  set installedCache(value: boolean | undefined) { this._installedCache = value; }

  get installedPromise() { return this._installedPromise; }
  set installedPromise(value: Promise<boolean> | null) { this._installedPromise = value; }

  get dccPathCache() { return this._dccPathCache; }
  set dccPathCache(value: string | null | undefined) { this._dccPathCache = value; }

  get dccPathPromise() { return this._dccPathPromise; }
  set dccPathPromise(value: Promise<string | null> | null) { this._dccPathPromise = value; }

  get serverStartedForProject() { return this._serverStartedForProject; }
  set serverStartedForProject(value: string | null) { this._serverStartedForProject = value; }

  get serverStartPromise() { return this._serverStartPromise; }
  set serverStartPromise(value: Promise<void> | null) { this._serverStartPromise = value; }

  get serverStartFailedAt() { return this._serverStartFailedAt; }
  set serverStartFailedAt(value: number | null) { this._serverStartFailedAt = value; }

  get indexingInProgress() { return this._indexingInProgress; }
  set indexingInProgress(value: boolean) { this._indexingInProgress = value; }

  get homeDirCache() { return this._homeDirCache; }
  set homeDirCache(value: string | null) { this._homeDirCache = value; }
}

export const dccState = new DccStateManager();

// =====================================================
// Timeout Helpers
// =====================================================

export const DCC_RETRY_COOLDOWN_MS = 10_000;
export const DCC_START_TIMEOUT_MS = 15_000;
export const DCC_CALL_TIMEOUT_MS = 60_000;
export const DCC_STOP_TIMEOUT_MS = 5_000;

// =====================================================
// Config
// =====================================================

export function buildDeltaCodeCubeConfig(agentcockpitPath: string): McpServerConfig {
  return {
    command: 'uv',
    args: ['run', '--directory', `${agentcockpitPath}/.deltacodecube`, 'deltacodecube']
  };
}

export function invalidateDccCaches(): void {
  dccState.installedCache = undefined;
  dccState.installedPromise = null;
  dccState.dccPathCache = undefined;
  dccState.dccPathPromise = null;
  dccState.serverStartedForProject = null;
  dccState.serverStartPromise = null;
  dccState.serverStartFailedAt = null;
}

// =====================================================
// Path Resolution
// =====================================================

export async function getDccPath(): Promise<string | null> {
  if (dccState.dccPathCache !== undefined) return dccState.dccPathCache;
  if (!dccState.dccPathPromise) {
    dccState.dccPathPromise = _resolveDccPath().then(path => {
      dccState.dccPathCache = path;
      dccState.dccPathPromise = null;
      return path;
    }).catch(() => {
      dccState.dccPathPromise = null;
      return null;
    });
  }
  return dccState.dccPathPromise;
}

async function _resolveDccPath(): Promise<string | null> {
  const config = await loadMcpConfig();
  const dccMcp = config.mcpServers[DCC_NAME];
  if (dccMcp?.config?.args) {
    const args = dccMcp.config.args as string[];
    const dirIdx = args.indexOf('--directory');
    if (dirIdx !== -1 && args[dirIdx + 1]) {
      return args[dirIdx + 1];
    }
  }

  const agentcockpitPath = await getAgentcockpitPath();
  if (agentcockpitPath) {
    return `${agentcockpitPath}/.deltacodecube`;
  }

  return null;
}

// =====================================================
// Project Data Dir
// =====================================================

export async function getProjectDataDir(projectPath: string): Promise<string> {
  if (!dccState.homeDirCache) {
    dccState.homeDirCache = await homeDir();
  }
  // FNV-1a hash to avoid collisions between projects with same basename
  let hash = 2166136261;
  for (let i = 0; i < projectPath.length; i++) {
    hash ^= projectPath.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
  const basename = projectPath.split('/').filter(Boolean).pop() || 'project';
  const home = dccState.homeDirCache.endsWith('/') ? dccState.homeDirCache : `${dccState.homeDirCache}/`;
  return `${home}.deltacodecube/projects/${basename}-${hashHex}`;
}

// =====================================================
// MCP Server Lifecycle
// =====================================================

export async function ensureDccServer(projectPath: string): Promise<void> {
  if (dccState.serverStartedForProject === projectPath) return;

  if (dccState.serverStartFailedAt && (Date.now() - dccState.serverStartFailedAt) < DCC_RETRY_COOLDOWN_MS) {
    const remainingSec = Math.ceil((DCC_RETRY_COOLDOWN_MS - (Date.now() - dccState.serverStartFailedAt)) / 1000);
    throw new Error(`[DCC] Server start failed recently — retry in ${remainingSec}s`);
  }

  if (dccState.serverStartPromise) {
    await dccState.serverStartPromise;
    if (dccState.serverStartedForProject === projectPath) return;
  }

  dccState.serverStartPromise = (async () => {
    if (dccState.serverStartedForProject !== null) {
      try {
        await withTimeout(invoke('dcc_stop'), DCC_STOP_TIMEOUT_MS, 'dcc_stop');
      } catch (e) {
        console.warn('[DCC] Stop failed during project switch:', e);
      }
      dccState.serverStartedForProject = null;
    }

    const dccPath = await getDccPath();
    if (!dccPath) throw new Error('DCC path not found');

    const dataDir = await getProjectDataDir(projectPath);
    await withTimeout(
      invoke('dcc_start', { dccPath, dataDir }),
      DCC_START_TIMEOUT_MS,
      'dcc_start'
    );
    dccState.serverStartedForProject = projectPath;
    dccState.serverStartPromise = null;
    dccState.serverStartFailedAt = null;
  })();

  dccState.serverStartPromise.catch((err) => {
    dccState.serverStartPromise = null;
    dccState.serverStartFailedAt = Date.now();
    console.error(`[DCC] Server start failed (retry in ${DCC_RETRY_COOLDOWN_MS / 1000}s):`, err);
  });
  return dccState.serverStartPromise;
}

// =====================================================
// MCP Tool Call
// =====================================================

export async function callDccTool(toolName: string, args: Record<string, unknown> = {}, projectPath?: string): Promise<unknown> {
  if (projectPath) {
    await ensureDccServer(projectPath);
  }

  const response = await withTimeout(
    invoke<string>('dcc_call', {
      toolName,
      arguments: JSON.stringify(args),
    }),
    DCC_CALL_TIMEOUT_MS,
    `dcc_call(${toolName})`
  );

  const parsed = JSON.parse(response);

  if (parsed.error) {
    throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  }

  const content = parsed.result?.content;
  if (Array.isArray(content) && content.length > 0) {
    const text = content[0]?.text;
    if (text) {
      try { return JSON.parse(text); } catch { return text; }
    }
  }

  return parsed.result;
}

// =====================================================
// Filtering Helpers
// =====================================================

export function pathMatchesProject(filePath: string, prefix: string): boolean {
  if (filePath.startsWith(prefix)) return true;
  if (prefix.startsWith('/home/')) {
    return filePath.startsWith('/var' + prefix);
  }
  if (prefix.startsWith('/var/home/')) {
    return filePath.startsWith(prefix.replace('/var/home/', '/home/'));
  }
  return false;
}

export function filterFilesByProject(files: Record<string, unknown>[], projectPath: string): Record<string, unknown>[] {
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  return files.filter(f => {
    const fp = String(f.file_path || f.file || '');
    return pathMatchesProject(fp, prefix);
  });
}

export function scoreToGrade(score: number): string {
  if (score <= 20) return 'A';
  if (score <= 40) return 'B';
  if (score <= 60) return 'C';
  if (score <= 80) return 'D';
  return 'F';
}

export function parseDebtResultForProject(result: unknown, projectPath: string): IndexStats | null {
  if (!result || typeof result !== 'object') return null;

  const data = result as Record<string, unknown>;
  const allFiles = (Array.isArray(data.all_files) ? data.all_files : []) as Record<string, unknown>[];

  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  const projectFiles = allFiles.filter(f => {
    const fp = String(f.file_path || '');
    return pathMatchesProject(fp, prefix);
  });

  if (projectFiles.length === 0) {
    const totalGlobal = Number(data.total_files || 0);
    if (totalGlobal === 0) return null;
    console.warn(`[DCC] parseDebt: 0 files matched project "${projectPath}" out of ${allFiles.length} global files`);
    return { totalFiles: 0, codebaseScore: 0, grade: 'A', distribution: { A: 0, B: 0, C: 0, D: 0, F: 0 } };
  }

  const scores = projectFiles.map(f => Number(f.score || 0));
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  const distribution: GradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const f of projectFiles) {
    const g = String(f.grade || scoreToGrade(Number(f.score || 0)));
    if (g in distribution) distribution[g as keyof GradeDistribution]++;
  }

  return {
    totalFiles: projectFiles.length,
    codebaseScore: Math.round(avgScore * 10) / 10,
    grade: scoreToGrade(avgScore),
    distribution,
  };
}
