/**
 * DeltaCodeCube Service
 *
 * Communicates with DeltaCodeCube via a persistent MCP server process
 * managed by the Rust backend (dcc_start/dcc_call/dcc_stop commands).
 *
 * Zero subprocess spawning per request — the MCP server starts once
 * and handles all tool calls via JSON-RPC 2.0 over stdin/stdout.
 */

import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import {
  loadMcpConfig,
  saveMcpConfig,
  getAgentcockpitPath,
  setAgentcockpitPath,
  addMcpToClaudeCode,
  removeMcpFromClaudeCode,
  removeMcp,
  type McpServerConfig,
} from './mcpConfigService';
import { addCodeMcp, removeCodeMcp } from './mcpService';
import { indexEvents } from '../core/utils/indexEventBus';

const DCC_NAME = 'deltacodecube';

// =====================================================
// Types
// =====================================================

export interface IndexStats {
  totalFiles: number;
  codebaseScore: number;
  grade: string;
  distribution: GradeDistribution;
}

export interface GradeDistribution {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

export interface TensionInfo {
  id: string;
  fileA: string;
  fileB: string;
  distance: number;
  type: string;
  magnitude: number;
  percent: number;
  status: string;
  suggestedAction: string | null;
}

export interface DebtInfo {
  file: string;
  score: number;
  grade: string;
  issues: string[];
}

export interface ImpactResult {
  file: string;
  riskLevel: string;
  totalAffected: number;
  highImpactFiles: number;
  mediumImpactFiles: number;
  maxPropagationDepth: number;
  naturalBoundaries: string[];
  recommendation: string;
  reviewOrder: { priority: number; file: string; intensity: number; distance: number }[];
}

export interface WaveResult {
  sourceFile: string;
  initialIntensity: number;
  totalAffected: number;
  maxDepth: number;
  boundariesCount: number;
  boundaries: string[];
  reviewOrder: { priority: number; file: string; intensity: number; distance: number }[];
  affectedFiles: { filePath: string; fileName: string; waveIntensity: number; distanceFromSource: number; isBarrier: boolean }[];
}

export interface SmellInfo {
  type: string;
  severity: string;
  filePath: string;
  fileName: string;
  description: string;
  suggestion: string;
}

export interface SmellsResult {
  totalSmells: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  byType: Record<string, number>;
  smells: SmellInfo[];
}

export interface CloneInfo {
  fileA: string;
  fileB: string;
  similarity: number;
}

export interface ClonesResult {
  totalClones: number;
  byType: { exact: number; parameterized: number; nearMiss: number };
  clones: CloneInfo[];
}

// =====================================================
// Config
// =====================================================

function buildDeltaCodeCubeConfig(agentcockpitPath: string): McpServerConfig {
  return {
    command: 'uv',
    args: ['run', '--directory', `${agentcockpitPath}/.deltacodecube`, 'deltacodecube']
  };
}

// Runtime caches + in-flight promise deduplication
let _installedCache: boolean | undefined;
let _installedPromise: Promise<boolean> | null = null;
let _dccPathCache: string | null | undefined;
let _dccPathPromise: Promise<string | null> | null = null;
let _serverStartedForProject: string | null = null;
let _serverStartPromise: Promise<void> | null = null;
let _serverStartFailedAt: number | null = null; // Timestamp of last failure (retry after cooldown)
const DCC_RETRY_COOLDOWN_MS = 10_000; // 10s before retrying after failure
let _indexingInProgress = false;

// Timeout helper for DCC operations
const DCC_START_TIMEOUT_MS = 15_000; // 15s for server startup
const DCC_CALL_TIMEOUT_MS = 60_000;  // 60s for tool calls (reindex can be slow)
const DCC_STOP_TIMEOUT_MS = 5_000;   // 5s for stopping

function withDccTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[DCC] ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export async function isDeltaCodeCubeInstalled(): Promise<boolean> {
  if (_installedCache !== undefined) return _installedCache;
  if (!_installedPromise) {
    _installedPromise = loadMcpConfig().then(config => {
      _installedCache = !!config.mcpServers[DCC_NAME];
      _installedPromise = null;
      return _installedCache;
    }).catch(() => {
      _installedPromise = null;
      return false;
    });
  }
  return _installedPromise;
}

/** Check if DCC server is already running for a given project (no server start) */
export function isDccServerRunningFor(projectPath: string): boolean {
  return _serverStartedForProject === projectPath;
}

export async function isDeltaCodeCubeEnabled(): Promise<boolean> {
  const installed = await isDeltaCodeCubeInstalled();
  if (!installed) return false;
  const config = await loadMcpConfig();
  const mcp = config.mcpServers[DCC_NAME];
  return !!mcp && !mcp.config.disabled;
}

function invalidateDccCaches() {
  _installedCache = undefined;
  _installedPromise = null;
  _dccPathCache = undefined;
  _dccPathPromise = null;
  _serverStartedForProject = null;
  _serverStartPromise = null;
  _serverStartFailedAt = null; // Allow retry after reinstall
}

// =====================================================
// Install / Uninstall
// =====================================================

export async function installDeltaCodeCubeMcp(agentcockpitPath?: string): Promise<{ success: boolean; message: string }> {
  try {
    let installPath: string | undefined = agentcockpitPath;
    if (!installPath) {
      installPath = await getAgentcockpitPath() ?? undefined;
    }

    if (!installPath) {
      return { success: false, message: 'AgentCockpit path not configured. Please set it first.' };
    }

    const dccPath = `${installPath}/.deltacodecube`;
    const dccExists = await exists(dccPath);
    if (!dccExists) {
      return { success: false, message: `DeltaCodeCube not found at ${dccPath}` };
    }

    await setAgentcockpitPath(installPath);

    const config = await loadMcpConfig();
    const mcpConfig = buildDeltaCodeCubeConfig(installPath);

    if (config.mcpServers[DCC_NAME]) {
      config.mcpServers[DCC_NAME].config = mcpConfig;
      config.mcpServers[DCC_NAME].config.disabled = false;
      await saveMcpConfig(config);
      const cliResult = await addCodeMcp(DCC_NAME, mcpConfig);
      if (!cliResult.success) {
        const fileOk = await addMcpToClaudeCode(DCC_NAME, mcpConfig);
        if (!fileOk) return { success: false, message: 'Failed to register MCP in Claude Code' };
      }
      invalidateDccCaches();
      return { success: true, message: 'DeltaCodeCube MCP updated and enabled' };
    }

    config.mcpServers[DCC_NAME] = {
      name: DCC_NAME,
      config: mcpConfig,
      importedFrom: 'manual',
      importedAt: new Date().toISOString(),
      notes: `Auto-installed by AgentCockpit from ${dccPath}`
    };

    const saved = await saveMcpConfig(config);
    if (saved) {
      const cliResult = await addCodeMcp(DCC_NAME, mcpConfig);
      if (!cliResult.success) {
        const fileOk = await addMcpToClaudeCode(DCC_NAME, mcpConfig);
        if (!fileOk) return { success: false, message: 'Failed to register MCP in Claude Code' };
      }
      invalidateDccCaches();
      return { success: true, message: 'DeltaCodeCube MCP installed successfully' };
    }
    return { success: false, message: 'Failed to save configuration' };
  } catch (e) {
    return { success: false, message: `Error: ${e}` };
  }
}

export async function uninstallDeltaCodeCubeMcp(): Promise<{ success: boolean; message: string }> {
  // Stop the server if running
  try { await invoke('dcc_stop'); } catch { /* ignore */ }
  const result = await removeMcp(DCC_NAME);
  const cliResult = await removeCodeMcp(DCC_NAME);
  if (!cliResult.success) {
    await removeMcpFromClaudeCode(DCC_NAME);
  }
  invalidateDccCaches();
  return result;
}

// =====================================================
// Path Resolution
// =====================================================

async function getDccPath(): Promise<string | null> {
  if (_dccPathCache !== undefined) return _dccPathCache;
  if (!_dccPathPromise) {
    _dccPathPromise = _resolveDccPath().then(path => {
      _dccPathCache = path;
      _dccPathPromise = null;
      return path;
    }).catch(() => {
      _dccPathPromise = null;
      return null;
    });
  }
  return _dccPathPromise;
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
// MCP Server Lifecycle
// =====================================================

/**
 * Ensure the DCC MCP server is running (lazy start, deduplicated).
 * Starts the process + MCP handshake on first call.
 */
let _homeDirCache: string | null = null;

async function getProjectDataDir(projectPath: string): Promise<string> {
  if (!_homeDirCache) {
    _homeDirCache = await homeDir();
  }
  // FNV-1a hash to avoid collisions between projects with same basename
  let hash = 2166136261;
  for (let i = 0; i < projectPath.length; i++) {
    hash ^= projectPath.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
  const basename = projectPath.split('/').filter(Boolean).pop() || 'project';
  const home = _homeDirCache.endsWith('/') ? _homeDirCache : `${_homeDirCache}/`;
  return `${home}.deltacodecube/projects/${basename}-${hashHex}`;
}

async function ensureDccServer(projectPath: string): Promise<void> {
  if (_serverStartedForProject === projectPath) return;

  // Don't retry within cooldown period (prevents repeated hangs)
  if (_serverStartFailedAt && (Date.now() - _serverStartFailedAt) < DCC_RETRY_COOLDOWN_MS) {
    const remainingSec = Math.ceil((DCC_RETRY_COOLDOWN_MS - (Date.now() - _serverStartFailedAt)) / 1000);
    throw new Error(`[DCC] Server start failed recently — retry in ${remainingSec}s`);
  }

  if (_serverStartPromise) {
    await _serverStartPromise;
    if (_serverStartedForProject === projectPath) return;
  }

  _serverStartPromise = (async () => {
    // Stop current instance if running for different project
    if (_serverStartedForProject !== null) {
      console.log(`[DCC] Switching project: ${_serverStartedForProject} -> ${projectPath}`);
      try {
        await withDccTimeout(invoke('dcc_stop'), DCC_STOP_TIMEOUT_MS, 'dcc_stop');
      } catch (e) {
        console.warn('[DCC] Stop failed during project switch:', e);
      }
      _serverStartedForProject = null;
    }

    const dccPath = await getDccPath();
    if (!dccPath) throw new Error('DCC path not found');

    const dataDir = await getProjectDataDir(projectPath);
    await withDccTimeout(
      invoke('dcc_start', { dccPath, dataDir }),
      DCC_START_TIMEOUT_MS,
      'dcc_start'
    );
    _serverStartedForProject = projectPath;
    _serverStartPromise = null;
    _serverStartFailedAt = null;
    console.log(`[DCC] MCP server started for project: ${projectPath}`);
  })();

  _serverStartPromise.catch((err) => {
    _serverStartPromise = null;
    _serverStartFailedAt = Date.now();
    console.error(`[DCC] Server start failed (retry in ${DCC_RETRY_COOLDOWN_MS / 1000}s):`, err);
  });
  return _serverStartPromise;
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

/**
 * Call a DCC MCP tool and return the parsed result content.
 */
async function callDccTool(toolName: string, args: Record<string, unknown> = {}, projectPath?: string): Promise<unknown> {
  if (projectPath) {
    await ensureDccServer(projectPath);
  }

  const response = await withDccTimeout(
    invoke<string>('dcc_call', {
      toolName,
      arguments: JSON.stringify(args),
    }),
    DCC_CALL_TIMEOUT_MS,
    `dcc_call(${toolName})`
  );

  // Parse JSON-RPC response: { jsonrpc, id, result: { content: [...] } }
  const parsed = JSON.parse(response);

  if (parsed.error) {
    throw new Error(parsed.error.message || JSON.stringify(parsed.error));
  }

  // MCP tool results have content array with text items
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
// Indexing (commit-based)
// =====================================================

export function isIndexing(): boolean {
  return _indexingInProgress;
}

/**
 * Run a git command in the project directory via Tauri backend.
 */
async function gitCommand(projectPath: string, args: string): Promise<string> {
  const result = await invoke<string>('execute_command', {
    cmd: `git ${args}`,
    cwd: projectPath,
  });
  return result.trim();
}

/**
 * Get the current HEAD commit hash.
 */
async function getCurrentCommit(projectPath: string): Promise<string | null> {
  try {
    const hash = await gitCommand(projectPath, 'rev-parse HEAD');
    return hash || null;
  } catch {
    return null;
  }
}

/**
 * Get the last indexed commit hash from the DCC data dir.
 */
async function getLastIndexedCommit(projectPath: string): Promise<string | null> {
  try {
    const dataDir = await getProjectDataDir(projectPath);
    const commitFile = `${dataDir}/last_commit`;
    if (await exists(commitFile)) {
      const hash = await readTextFile(commitFile);
      return hash.trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save the last indexed commit hash to the DCC data dir.
 */
async function saveLastIndexedCommit(projectPath: string, commitHash: string): Promise<void> {
  try {
    const dataDir = await getProjectDataDir(projectPath);
    await writeTextFile(`${dataDir}/last_commit`, commitHash);
  } catch (e) {
    console.warn('[DCC] Failed to save last indexed commit:', e);
  }
}

/**
 * Get files changed between two commits (or between commit and working tree).
 * Returns { modified: string[], added: string[], deleted: string[] } with relative paths.
 */
async function getChangedFiles(
  projectPath: string,
  fromCommit: string,
  toCommit: string,
): Promise<{ modified: string[]; added: string[]; deleted: string[] }> {
  const modified: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  try {
    // --diff-filter: A=Added, M=Modified, D=Deleted, R=Renamed
    const diffOutput = await gitCommand(
      projectPath,
      `diff --name-status ${fromCommit} ${toCommit}`,
    );

    if (!diffOutput) return { modified, added, deleted };

    for (const line of diffOutput.split('\n')) {
      if (!line.trim()) continue;
      const status = line[0];
      const filePath = line.substring(1).trim().split('\t').pop()?.trim() || '';
      if (!filePath) continue;

      // Only index source code files
      if (!isSourceFile(filePath)) continue;

      if (status === 'A') added.push(filePath);
      else if (status === 'D') deleted.push(filePath);
      else modified.push(filePath); // M, R, etc.
    }
  } catch (e) {
    console.warn('[DCC] git diff failed:', e);
  }

  return { modified, added, deleted };
}

/** Check if a file is a source code file worth indexing. */
function isSourceFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const sourceExts = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
    'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'vue', 'svelte',
  ]);
  return sourceExts.has(ext);
}

/**
 * First-time index: indexes everything, then diffs last 2 commits for initial deltas.
 */
export async function indexProject(projectPath: string): Promise<IndexStats | null> {
  if (_indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  _indexingInProgress = true;
  console.log(`[DCC] Indexing: ${projectPath}`);
  try {
    indexEvents.emit('indexing', { projectPath, timestamp: Date.now() });

    // Step 1: Full directory index (creates all CodePoints)
    await callDccTool('cube_index_directory', { path: projectPath }, projectPath);
    console.log('[DCC] cube_index_directory completed');

    // Step 2: Generate initial deltas from last 2 commits
    const headCommit = await getCurrentCommit(projectPath);
    if (headCommit) {
      try {
        const prevCommit = await gitCommand(projectPath, 'rev-parse HEAD~1');
        if (prevCommit) {
          const { modified } = await getChangedFiles(projectPath, prevCommit, headCommit);
          if (modified.length > 0) {
            console.log(`[DCC] Initial delta detection: ${modified.length} files changed in last commit`);
            let deltas = 0;
            for (const file of modified) {
              try {
                const r = await callDccTool('cube_reindex', { path: `${projectPath}/${file}` }, projectPath);
                if (r && typeof r === 'object' && (r as Record<string, unknown>).status === 'reindexed') deltas++;
              } catch { /* skip */ }
            }
            console.log(`[DCC] Initial deltas: ${deltas}`);
          }
        }
      } catch {
        // Repo may have only 1 commit — that's fine, no deltas
        console.log('[DCC] No previous commit for initial delta detection');
      }

      await saveLastIndexedCommit(projectPath, headCommit);
    }

    // Step 3: Get stats
    const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
    const stats = parseDebtResultForProject(debtResult, projectPath);

    if (stats) {
      indexEvents.emit('indexed', {
        projectPath,
        totalFiles: stats.totalFiles,
        grade: stats.grade,
        score: stats.codebaseScore,
        timestamp: Date.now(),
      });
    }

    return stats;
  } catch (e) {
    console.error('[DCC] Index error:', e);
    indexEvents.emit('error', { projectPath, error: String(e), timestamp: Date.now() });
    return null;
  } finally {
    _indexingInProgress = false;
  }
}

/**
 * Commit-based reindex: only processes files changed since last indexed commit.
 * If HEAD hasn't changed since last index, skips (no-op).
 */
export async function reindexProject(projectPath: string): Promise<IndexStats | null> {
  if (_indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  _indexingInProgress = true;
  console.log(`[DCC] Reindexing: ${projectPath}`);
  try {
    indexEvents.emit('indexing', { projectPath, timestamp: Date.now() });

    const headCommit = await getCurrentCommit(projectPath);
    const lastCommit = await getLastIndexedCommit(projectPath);

    // No git? Fall back to full directory index
    if (!headCommit) {
      console.log('[DCC] No git HEAD — falling back to full directory reindex');
      await callDccTool('cube_index_directory', { path: projectPath }, projectPath);
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      const stats = parseDebtResultForProject(debtResult, projectPath);
      if (stats) {
        indexEvents.emit('indexed', { projectPath, totalFiles: stats.totalFiles, grade: stats.grade, score: stats.codebaseScore, timestamp: Date.now() });
      }
      return stats;
    }

    // Same commit? No changes to process
    if (lastCommit === headCommit) {
      console.log(`[DCC] Already indexed at commit ${headCommit.substring(0, 8)} — skipping`);
      _indexingInProgress = false;
      // Still return current stats
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      return parseDebtResultForProject(debtResult, projectPath);
    }

    // No last commit = first time on this machine/DB. Do a full directory index
    // before attempting commit-based diffs, since the DB is empty.
    if (!lastCommit) {
      console.log('[DCC] No previous index — full directory reindex first');
      await callDccTool('cube_index_directory', { path: projectPath }, projectPath);
      await saveLastIndexedCommit(projectPath, headCommit);
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      const stats = parseDebtResultForProject(debtResult, projectPath);
      if (stats) {
        indexEvents.emit('indexed', { projectPath, totalFiles: stats.totalFiles, grade: stats.grade, score: stats.codebaseScore, timestamp: Date.now() });
      }
      return stats;
    }

    // Incremental: diff from last indexed commit
    const fromCommit = lastCommit;

    // Get changed files between last indexed commit and current HEAD
    const { modified, added } = await getChangedFiles(projectPath, fromCommit, headCommit);
    const totalChanged = modified.length + added.length;

    if (totalChanged === 0) {
      console.log(`[DCC] No source files changed between ${fromCommit.substring(0, 8)} and ${headCommit.substring(0, 8)}`);
      await saveLastIndexedCommit(projectPath, headCommit);
      _indexingInProgress = false;
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      return parseDebtResultForProject(debtResult, projectPath);
    }

    console.log(`[DCC] Commit diff ${fromCommit.substring(0, 8)}..${headCommit.substring(0, 8)}: ${modified.length} modified, ${added.length} added`);

    // Reindex modified files → creates deltas + tensions
    let deltasFound = 0;
    let tensionsFound = 0;
    for (const file of modified) {
      try {
        const result = await callDccTool('cube_reindex', { path: `${projectPath}/${file}` }, projectPath);
        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if (r.status === 'reindexed') deltasFound++;
          if (Array.isArray(r.tensions)) tensionsFound += (r.tensions as unknown[]).length;
        }
      } catch {
        // Skip files that fail
      }
    }

    // Index new files
    for (const file of added) {
      try {
        await callDccTool('cube_index_file', { file_path: `${projectPath}/${file}` }, projectPath);
      } catch {
        // Skip
      }
    }

    console.log(`[DCC] Commit-based reindex done: ${deltasFound} deltas, ${tensionsFound} tensions`);
    await saveLastIndexedCommit(projectPath, headCommit);

    // Get updated stats
    const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
    const stats = parseDebtResultForProject(debtResult, projectPath);

    if (stats) {
      indexEvents.emit('indexed', {
        projectPath,
        totalFiles: stats.totalFiles,
        grade: stats.grade,
        score: stats.codebaseScore,
        timestamp: Date.now(),
      });
    }

    return stats;
  } catch (e) {
    console.error('[DCC] Reindex error:', e);
    indexEvents.emit('error', { projectPath, error: String(e), timestamp: Date.now() });
    throw e;
  } finally {
    _indexingInProgress = false;
  }
}

/**
 * Incremental reindex with explicit file lists (legacy, used by gitWatcher).
 */
export async function incrementalReindex(
  projectPath: string,
  changedFiles: string[],
  addedFiles: string[]
): Promise<IndexStats | null> {
  if (_indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  const totalFiles = changedFiles.length + addedFiles.length;
  if (totalFiles === 0) {
    console.log('[DCC] No files to reindex incrementally');
    return null;
  }

  _indexingInProgress = true;
  console.log(`[DCC] Incremental reindex: ${changedFiles.length} modified, ${addedFiles.length} new`);
  try {
    indexEvents.emit('indexing', { projectPath, timestamp: Date.now() });

    for (const file of changedFiles) {
      const absPath = `${projectPath}/${file}`;
      try {
        await callDccTool('cube_reindex', { path: absPath }, projectPath);
      } catch (e) {
        console.warn(`[DCC] Failed to reindex ${file}:`, e);
      }
    }

    for (const file of addedFiles) {
      const absPath = `${projectPath}/${file}`;
      try {
        await callDccTool('cube_index_file', { file_path: absPath }, projectPath);
      } catch (e) {
        console.warn(`[DCC] Failed to index new file ${file}:`, e);
      }
    }

    // Update last indexed commit
    const headCommit = await getCurrentCommit(projectPath);
    if (headCommit) await saveLastIndexedCommit(projectPath, headCommit);

    console.log('[DCC] Incremental reindex done, fetching debt...');
    const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
    const stats = parseDebtResultForProject(debtResult, projectPath);

    if (stats) {
      indexEvents.emit('indexed', {
        projectPath,
        totalFiles: stats.totalFiles,
        grade: stats.grade,
        score: stats.codebaseScore,
        timestamp: Date.now(),
      });
    }

    return stats;
  } catch (e) {
    console.error('[DCC] Incremental reindex error:', e);
    indexEvents.emit('error', { projectPath, error: String(e), timestamp: Date.now() });
    return null;
  } finally {
    _indexingInProgress = false;
  }
}

// =====================================================
// Stats & Analysis
// =====================================================

/**
 * Check if a file path belongs to a project, handling /home <-> /var/home symlinks
 * (Bazzite/Fedora Atomic: /home is a symlink to /var/home).
 */
function pathMatchesProject(filePath: string, prefix: string): boolean {
  if (filePath.startsWith(prefix)) return true;
  // Try alternate symlink form
  if (prefix.startsWith('/home/')) {
    return filePath.startsWith('/var' + prefix);
  }
  if (prefix.startsWith('/var/home/')) {
    return filePath.startsWith(prefix.replace('/var/home/', '/home/'));
  }
  return false;
}

/**
 * DCC tools return GLOBAL data (all indexed projects).
 * We filter client-side by projectPath since file_path is stored as absolute.
 */
function filterFilesByProject(files: Record<string, unknown>[], projectPath: string): Record<string, unknown>[] {
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  return files.filter(f => {
    const fp = String(f.file_path || f.file || '');
    return pathMatchesProject(fp, prefix);
  });
}

export async function getIndexStats(projectPath: string): Promise<IndexStats | null> {
  if (_indexingInProgress || !projectPath) return null;
  try {
    const result = await callDccTool('cube_get_debt', {}, projectPath);
    return parseDebtResultForProject(result, projectPath);
  } catch (e) {
    console.error('[DCC] Stats error:', e);
    return null;
  }
}

export async function getTensions(projectPath: string): Promise<TensionInfo[]> {
  if (_indexingInProgress || !projectPath) return [];
  try {
    const result = await callDccTool('cube_get_tensions', { limit: 50 }, projectPath);

    const tensions = Array.isArray(result) ? result
      : (result && typeof result === 'object' && 'tensions' in (result as Record<string, unknown>))
        ? (result as Record<string, unknown>).tensions as unknown[]
        : [];

    if (!Array.isArray(tensions)) return [];

    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';

    return tensions
      .map((t: unknown) => {
        const item = t as Record<string, unknown>;
        return {
          id: String(item.id || ''),
          fileA: String(item.caller_path || item.file_a || item.fileA || ''),
          fileB: String(item.callee_path || item.file_b || item.fileB || ''),
          distance: Number(item.current_distance || item.distance || 0),
          type: String(item.type || 'unknown'),
          magnitude: Number(item.tension_magnitude || 0),
          percent: Number(item.tension_percent || 0),
          status: String(item.status || 'detected'),
          suggestedAction: item.suggested_action ? String(item.suggested_action) : null,
        };
      })
      .filter(t => pathMatchesProject(t.fileA, prefix) || pathMatchesProject(t.fileB, prefix));
  } catch (e) {
    console.error('[DCC] Tensions error:', e);
    return [];
  }
}

export async function getDebt(projectPath: string): Promise<DebtInfo[]> {
  if (_indexingInProgress || !projectPath) return [];
  try {
    const result = await callDccTool('cube_get_debt', {}, projectPath);

    if (result && typeof result === 'object') {
      const data = result as Record<string, unknown>;
      // Use all_files (complete list) for accurate per-project filtering
      const allFiles = Array.isArray(data.all_files) ? data.all_files
        : Array.isArray(data.top_debt_files) ? data.top_debt_files
        : Array.isArray(result) ? result : [];

      const filtered = filterFilesByProject(allFiles as Record<string, unknown>[], projectPath);

      return filtered.map((d) => ({
        file: String(d.file_path || d.file_name || d.file || ''),
        score: Number(d.score || 0),
        grade: String(d.grade || 'F'),
        issues: Array.isArray(d.recommendations) ? d.recommendations.map(String) :
                Array.isArray(d.issues) ? d.issues.map(String) : [],
      }));
    }

    return [];
  } catch (e) {
    console.error('[DCC] Debt error:', e);
    return [];
  }
}

// =====================================================
// Tensions & Impact Analysis
// =====================================================

export async function resolveTension(projectPath: string, tensionId: string, status: 'reviewed' | 'resolved' | 'ignored'): Promise<{ success: boolean; message: string }> {
  try {
    const result = await callDccTool('cube_resolve_tension', { tension_id: tensionId, status }, projectPath);
    const data = result as Record<string, unknown>;
    return { success: !!data.success, message: String(data.message || '') };
  } catch (e) {
    console.error('[DCC] Resolve tension error:', e);
    return { success: false, message: String(e) };
  }
}

export async function analyzeImpact(projectPath: string, filePath: string): Promise<ImpactResult | null> {
  try {
    const result = await callDccTool('cube_analyze_impact', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    return {
      file: String(d.file || filePath),
      riskLevel: String(d.risk_level || 'unknown'),
      totalAffected: Number(d.total_affected || 0),
      highImpactFiles: Number(d.high_impact_files || 0),
      mediumImpactFiles: Number(d.medium_impact_files || 0),
      maxPropagationDepth: Number(d.max_propagation_depth || 0),
      naturalBoundaries: Array.isArray(d.natural_boundaries) ? d.natural_boundaries.map(String) : [],
      recommendation: String(d.recommendation || ''),
      reviewOrder: Array.isArray(d.review_order) ? (d.review_order as Record<string, unknown>[]).map(r => ({
        priority: Number(r.priority || 0),
        file: String(r.file || ''),
        intensity: Number(r.intensity || 0),
        distance: Number(r.distance || 0),
      })) : [],
    };
  } catch (e) {
    console.error('[DCC] Impact analysis error:', e);
    return null;
  }
}

export async function simulateWave(projectPath: string, sourcePath: string, intensity = 1.0): Promise<WaveResult | null> {
  try {
    const result = await callDccTool('cube_simulate_wave', { source_path: sourcePath, intensity }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    return {
      sourceFile: String(d.source_file || sourcePath),
      initialIntensity: Number(d.initial_intensity || intensity),
      totalAffected: Number(d.total_affected || 0),
      maxDepth: Number(d.max_depth || 0),
      boundariesCount: Number(d.boundaries_count || 0),
      boundaries: Array.isArray(d.boundaries) ? d.boundaries.map(String) : [],
      reviewOrder: Array.isArray(d.review_order) ? (d.review_order as Record<string, unknown>[]).map(r => ({
        priority: Number(r.priority || 0),
        file: String(r.file || ''),
        intensity: Number(r.intensity || 0),
        distance: Number(r.distance || 0),
      })) : [],
      affectedFiles: Array.isArray(d.affected_files) ? (d.affected_files as Record<string, unknown>[]).map(f => ({
        filePath: String(f.file_path || ''),
        fileName: String(f.file_name || ''),
        waveIntensity: Number(f.wave_intensity || 0),
        distanceFromSource: Number(f.distance_from_source || 0),
        isBarrier: !!f.is_boundary,
      })) : [],
    };
  } catch (e) {
    console.error('[DCC] Wave simulation error:', e);
    return null;
  }
}

export async function predictImpact(projectPath: string, filePath: string): Promise<ImpactResult | null> {
  try {
    const result = await callDccTool('cube_predict_impact', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    return {
      file: String(d.file || filePath),
      riskLevel: String(d.risk_level || 'unknown'),
      totalAffected: Number(d.total_affected || 0),
      highImpactFiles: Number(d.high_impact_files || 0),
      mediumImpactFiles: Number(d.medium_impact_files || 0),
      maxPropagationDepth: Number(d.max_propagation_depth || 0),
      naturalBoundaries: Array.isArray(d.natural_boundaries) ? d.natural_boundaries.map(String) : [],
      recommendation: String(d.recommendation || ''),
      reviewOrder: Array.isArray(d.review_order) ? (d.review_order as Record<string, unknown>[]).map(r => ({
        priority: Number(r.priority || 0),
        file: String(r.file || ''),
        intensity: Number(r.intensity || 0),
        distance: Number(r.distance || 0),
      })) : [],
    };
  } catch (e) {
    console.error('[DCC] Predict impact error:', e);
    return null;
  }
}

// =====================================================
// Code Smells & Clones
// =====================================================

export async function detectSmells(projectPath: string): Promise<SmellsResult | null> {
  try {
    const result = await callDccTool('cube_detect_smells', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    const byType = d.by_type as Record<string, number> | undefined;
    const smells = Array.isArray(d.smells) ? (d.smells as Record<string, unknown>[]).map(s => ({
      type: String(s.type || ''),
      severity: String(s.severity || ''),
      filePath: String(s.file_path || ''),
      fileName: String(s.file_name || ''),
      description: String(s.description || ''),
      suggestion: String(s.suggestion || ''),
    })) : [];

    // Filter by project prefix — use file_path (absolute), not file_name (basename)
    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectSmells = smells.filter(s => pathMatchesProject(s.filePath, prefix));

    // Recalculate severity counts from filtered smells
    const filteredBySev = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const s of projectSmells) {
      if (s.severity in filteredBySev) {
        filteredBySev[s.severity as keyof typeof filteredBySev]++;
      }
    }

    return {
      totalSmells: projectSmells.length,
      bySeverity: filteredBySev,
      byType: byType || {},
      smells: projectSmells,
    };
  } catch (e) {
    console.error('[DCC] Detect smells error:', e);
    return null;
  }
}

export async function detectClones(projectPath: string): Promise<ClonesResult | null> {
  try {
    const result = await callDccTool('cube_detect_clones', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const d = result as Record<string, unknown>;
    const byType = d.by_type as Record<string, number> | undefined;
    const clones = Array.isArray(d.clones) ? (d.clones as Record<string, unknown>[]).map(c => ({
      fileA: String(c.file_a || ''),
      fileB: String(c.file_b || ''),
      similarity: Number(c.similarity || 0),
    })) : [];

    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectClones = clones.filter(c => pathMatchesProject(c.fileA, prefix) || pathMatchesProject(c.fileB, prefix));

    return {
      totalClones: projectClones.length,
      byType: {
        exact: byType?.exact || 0,
        parameterized: byType?.parameterized || 0,
        nearMiss: byType?.['near-miss'] || 0,
      },
      clones: projectClones,
    };
  } catch (e) {
    console.error('[DCC] Detect clones error:', e);
    return null;
  }
}

// =====================================================
// Visualizations
// =====================================================

export async function generateArchitecture(projectPath: string): Promise<string | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_architecture', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    // If the tool returns output_path, read the file
    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Architecture error:', e);
    return null;
  }
}

export async function generateMatrix(projectPath: string): Promise<string | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_matrix', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Matrix error:', e);
    return null;
  }
}

export async function generateTimeline(projectPath: string): Promise<string | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_timeline', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Timeline error:', e);
    return null;
  }
}

export async function generateHeatmap(projectPath: string): Promise<string | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_generate_heatmap', { project_path: projectPath }, projectPath);

    if (result && typeof result === 'object' && 'html' in (result as Record<string, unknown>)) {
      return String((result as Record<string, unknown>).html);
    }

    const data = result as Record<string, unknown>;
    if (data?.output_path) {
      const html = await readTextFile(String(data.output_path));
      return html;
    }

    return typeof result === 'string' ? result : null;
  } catch (e) {
    console.error('[DCC] Heatmap error:', e);
    return null;
  }
}

// =====================================================
// Suggestions, Drift, Graph, Contracts, Compare, Deltas
// =====================================================

export interface SuggestionInfo {
  action: string;
  priority: string;
  impact: string;
  effort: string;
  targetFiles: string[];
  description: string;
  rationale: string;
  steps: string[];
}

export interface SuggestionsResult {
  totalSuggestions: number;
  byAction: Record<string, number>;
  byPriority: Record<string, number>;
  suggestions: SuggestionInfo[];
}

export interface DriftInfo {
  type: string;
  severity: string;
  fileA: string;
  fileB: string;
  description: string;
  recommendation: string;
}

export interface DriftResult {
  totalDrifts: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  drifts: DriftInfo[];
}

export interface GraphMetric {
  file: string;
  value: number;
}

export interface GraphResult {
  totalFiles: number;
  totalEdges: number;
  topPageRank: GraphMetric[];
  topHub: GraphMetric[];
  topAuthority: GraphMetric[];
  topBetweenness: GraphMetric[];
}

export interface CentralityResult {
  file: string;
  pagerank: number;
  hubScore: number;
  authorityScore: number;
  betweenness: number;
  inDegree: number;
  outDegree: number;
  interpretation: string[];
}

export interface ContractInfo {
  caller: string;
  callee: string;
  baselineDistance: number;
  type: string;
}

export interface DeltaInfo {
  file: string;
  timestamp: string;
  magnitude: number;
  lexicalDelta: number;
  structuralDelta: number;
  semanticDelta: number;
}

export interface ClusterInfo {
  id: number;
  name: string;
  size: number;
  characteristics: string[];
  files: string[];
}

export interface ClusterResult {
  totalClusters: number;
  silhouetteScore: number;
  clusters: ClusterInfo[];
  outliers: string[];
  misclassified: { file: string; currentCluster: number; suggestedCluster: number }[];
}

export interface SurfaceModule {
  file: string;
  exports: string[];
  importCount: number;
  riskLevel: string;
}

export interface SurfaceResult {
  totalModules: number;
  totalExports: number;
  modules: SurfaceModule[];
}

export interface CompareResult {
  fileA: string;
  fileB: string;
  overallDistance: number;
  similarity: number;
  lexicalDistance: number;
  structuralDistance: number;
  semanticDistance: number;
  insights: string[];
}

export interface TemporalResult {
  path: string;
  features: {
    fileAge: number;
    changeFrequency: number;
    authorDiversity: number;
    daysSinceChange: number;
    stabilityScore: number;
  };
  interpretation: string[];
}

export interface FixSuggestionResult {
  changeType: string;
  severity: string;
  causes: string[];
  suggestedActions: string[];
  guidance: string[];
}

/**
 * Get refactoring suggestions from DCC.
 */
export async function getSuggestions(projectPath: string): Promise<SuggestionsResult | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_get_suggestions', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []) as Record<string, unknown>[];
    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectSuggestions = suggestions.filter(s => {
      const targets = (Array.isArray(s.target_files) ? s.target_files : []) as string[];
      return targets.some(f => pathMatchesProject(f, prefix));
    });
    return {
      totalSuggestions: projectSuggestions.length,
      byAction: (data.by_action || {}) as Record<string, number>,
      byPriority: (data.by_priority || {}) as Record<string, number>,
      suggestions: projectSuggestions.map(s => ({
        action: String(s.action || ''),
        priority: String(s.priority || ''),
        impact: String(s.impact || ''),
        effort: String(s.effort || ''),
        targetFiles: (Array.isArray(s.target_files) ? s.target_files : []) as string[],
        description: String(s.description || ''),
        rationale: String(s.rationale || ''),
        steps: (Array.isArray(s.steps) ? s.steps : []) as string[],
      })),
    };
  } catch (e) {
    console.error('[DCC] Suggestions error:', e);
    return null;
  }
}

/**
 * Detect code drift.
 */
export async function detectDrift(projectPath: string): Promise<DriftResult | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_detect_drift', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const drifts = (Array.isArray(data.drifts) ? data.drifts : []) as Record<string, unknown>[];
    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectDrifts = drifts.filter(d => {
      const fA = String(d.file_a || d.fileA || '');
      const fB = String(d.file_b || d.fileB || '');
      return pathMatchesProject(fA, prefix) || pathMatchesProject(fB, prefix);
    });
    return {
      totalDrifts: projectDrifts.length,
      bySeverity: (data.by_severity || {}) as Record<string, number>,
      byType: (data.by_type || {}) as Record<string, number>,
      drifts: projectDrifts.map(d => ({
        type: String(d.type || ''),
        severity: String(d.severity || 'medium'),
        fileA: String(d.file_a || d.fileA || ''),
        fileB: String(d.file_b || d.fileB || ''),
        description: String(d.description || ''),
        recommendation: String(d.recommendation || ''),
      })),
    };
  } catch (e) {
    console.error('[DCC] Drift error:', e);
    return null;
  }
}

/**
 * Analyze dependency graph with centrality metrics.
 */
export async function analyzeGraph(projectPath: string, topN = 10): Promise<GraphResult | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_analyze_graph', { top_n: topN }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const mapMetrics = (arr: unknown): GraphMetric[] => {
      if (!Array.isArray(arr)) return [];
      return arr.map(item => {
        const m = item as Record<string, unknown>;
        return { file: String(m.file || m.path || ''), value: Number(m.value || m.score || 0) };
      });
    };
    return {
      totalFiles: Number(data.total_files || data.total_nodes || 0),
      totalEdges: Number(data.total_edges || data.total_contracts || 0),
      topPageRank: mapMetrics(data.top_pagerank),
      topHub: mapMetrics(data.top_hub),
      topAuthority: mapMetrics(data.top_authority),
      topBetweenness: mapMetrics(data.top_betweenness),
    };
  } catch (e) {
    console.error('[DCC] Graph analysis error:', e);
    return null;
  }
}

/**
 * Get centrality metrics for a specific file.
 */
export async function getCentrality(projectPath: string, filePath: string): Promise<CentralityResult | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_get_centrality', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    if (data.error) return null;
    return {
      file: String(data.file || data.path || filePath),
      pagerank: Number(data.pagerank || 0),
      hubScore: Number(data.hub_score || 0),
      authorityScore: Number(data.authority_score || 0),
      betweenness: Number(data.betweenness || 0),
      inDegree: Number(data.in_degree || 0),
      outDegree: Number(data.out_degree || 0),
      interpretation: (Array.isArray(data.interpretation) ? data.interpretation : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Centrality error:', e);
    return null;
  }
}

/**
 * Get contracts (dependencies) between files.
 */
export async function getContracts(projectPath: string, filePath?: string, direction = 'both'): Promise<ContractInfo[]> {
  if (_indexingInProgress) return [];
  try {
    const args: Record<string, unknown> = { direction, limit: 200 };
    if (filePath) args.path = filePath;
    const result = await callDccTool('cube_get_contracts', args, projectPath);
    if (!result || typeof result !== 'object') return [];
    const data = result as Record<string, unknown>;
    const contracts = (Array.isArray(data.contracts) ? data.contracts : []) as Record<string, unknown>[];
    return contracts.map(c => ({
      caller: String(c.caller || c.caller_path || ''),
      callee: String(c.callee || c.callee_path || ''),
      baselineDistance: Number(c.baseline_distance || 0),
      type: String(c.type || c.contract_type || 'import'),
    }));
  } catch (e) {
    console.error('[DCC] Contracts error:', e);
    return [];
  }
}

/**
 * Get recent code deltas (changes).
 */
export async function getDeltas(projectPath: string, limit = 20): Promise<DeltaInfo[]> {
  if (_indexingInProgress) return [];
  try {
    const result = await callDccTool('cube_get_deltas', { limit }, projectPath);
    if (!result || typeof result !== 'object') return [];
    const data = result as Record<string, unknown>;
    const deltas = (Array.isArray(data.deltas) ? data.deltas : []) as Record<string, unknown>[];
    return deltas.map(d => ({
      file: String(d.file || d.file_path || ''),
      timestamp: String(d.timestamp || d.created_at || ''),
      magnitude: Number(d.magnitude || d.total_magnitude || 0),
      lexicalDelta: Number(d.lexical_delta || d.lexical || 0),
      structuralDelta: Number(d.structural_delta || d.structural || 0),
      semanticDelta: Number(d.semantic_delta || d.semantic || 0),
    }));
  } catch (e) {
    console.error('[DCC] Deltas error:', e);
    return [];
  }
}

/**
 * Cluster files by similarity.
 */
export async function clusterFiles(projectPath: string, k?: number): Promise<ClusterResult | null> {
  if (_indexingInProgress) return null;
  try {
    const args: Record<string, unknown> = {};
    if (k !== undefined) args.k = k;
    const result = await callDccTool('cube_cluster_files', args, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const clusters = (Array.isArray(data.clusters) ? data.clusters : []) as Record<string, unknown>[];
    return {
      totalClusters: Number(data.total_clusters || clusters.length),
      silhouetteScore: Number(data.silhouette_score || 0),
      clusters: clusters.map(c => ({
        id: Number(c.id || c.cluster_id || 0),
        name: String(c.name || c.label || `Cluster ${c.id || 0}`),
        size: Number(c.size || 0),
        characteristics: (Array.isArray(c.characteristics) ? c.characteristics : []) as string[],
        files: (Array.isArray(c.files) ? c.files : []).map((f: unknown) =>
          typeof f === 'string' ? f : String((f as Record<string, unknown>).path || (f as Record<string, unknown>).name || f)
        ),
      })),
      outliers: (Array.isArray(data.outliers) ? data.outliers : []).map((o: unknown) =>
        typeof o === 'string' ? o : String((o as Record<string, unknown>).path || (o as Record<string, unknown>).name || o)
      ),
      misclassified: (Array.isArray(data.misclassified) ? data.misclassified : []).map((m: unknown) => {
        const mc = m as Record<string, unknown>;
        return {
          file: String(mc.path || mc.name || mc.file || ''),
          currentCluster: Number(mc.current_cluster || 0),
          suggestedCluster: Number(mc.suggested_cluster || 0),
        };
      }),
    };
  } catch (e) {
    console.error('[DCC] Clustering error:', e);
    return null;
  }
}

/**
 * Analyze API surface of modules.
 */
export async function analyzeSurface(projectPath: string): Promise<SurfaceResult | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_analyze_surface', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const modules = (Array.isArray(data.modules) ? data.modules : []) as Record<string, unknown>[];
    const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const projectModules = modules.filter(m => pathMatchesProject(String(m.file || m.path || ''), prefix));
    return {
      totalModules: projectModules.length,
      totalExports: Number(data.total_exports || 0),
      modules: projectModules.map(m => ({
        file: String(m.file || m.path || ''),
        exports: (Array.isArray(m.exports) ? m.exports : []) as string[],
        importCount: Number(m.import_count || m.dependents || 0),
        riskLevel: String(m.risk_level || m.risk || 'low'),
      })),
    };
  } catch (e) {
    console.error('[DCC] Surface error:', e);
    return null;
  }
}

/**
 * Compare two files in the cube.
 */
export async function compareFiles(projectPath: string, fileA: string, fileB: string): Promise<CompareResult | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_compare', { path_a: fileA, path_b: fileB }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    return {
      fileA: String(data.file_a || data.path_a || fileA),
      fileB: String(data.file_b || data.path_b || fileB),
      overallDistance: Number(data.overall_distance || data.distance || 0),
      similarity: Number(data.similarity || 0),
      lexicalDistance: Number(data.lexical_distance || data.lexical || 0),
      structuralDistance: Number(data.structural_distance || data.structural || 0),
      semanticDistance: Number(data.semantic_distance || data.semantic || 0),
      insights: (Array.isArray(data.insights) ? data.insights : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Compare error:', e);
    return null;
  }
}

/**
 * Get temporal (git history) features for a file.
 */
export async function getTemporalFeatures(projectPath: string, filePath: string): Promise<TemporalResult | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_get_temporal', { path: filePath }, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    const features = (data.features || {}) as Record<string, unknown>;
    return {
      path: String(data.path || filePath),
      features: {
        fileAge: Number(features.file_age || 0),
        changeFrequency: Number(features.change_frequency || 0),
        authorDiversity: Number(features.author_diversity || 0),
        daysSinceChange: Number(features.days_since_change || 0),
        stabilityScore: Number(features.stability_score || 0),
      },
      interpretation: (Array.isArray(data.interpretation) ? data.interpretation : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Temporal error:', e);
    return null;
  }
}

/**
 * Suggest fix for a tension or changed file.
 */
export async function suggestFix(projectPath: string, tensionId?: string, filePath?: string): Promise<FixSuggestionResult | null> {
  if (_indexingInProgress) return null;
  try {
    const args: Record<string, unknown> = {};
    if (tensionId) args.tension_id = tensionId;
    if (filePath) args.file_path = filePath;
    const result = await callDccTool('cube_suggest_fix', args, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    return {
      changeType: String(data.change_type || ''),
      severity: String(data.severity || ''),
      causes: (Array.isArray(data.causes) ? data.causes : []) as string[],
      suggestedActions: (Array.isArray(data.suggested_actions) ? data.suggested_actions : []) as string[],
      guidance: (Array.isArray(data.guidance) ? data.guidance : Array.isArray(data.steps) ? data.steps : []) as string[],
    };
  } catch (e) {
    console.error('[DCC] Suggest fix error:', e);
    return null;
  }
}

/**
 * Export interactive 3D HTML cube visualization.
 */
export async function exportCubeHtml(projectPath: string): Promise<string | null> {
  if (_indexingInProgress) return null;
  try {
    const result = await callDccTool('cube_export_html', {}, projectPath);
    if (!result || typeof result !== 'object') return null;
    const data = result as Record<string, unknown>;
    if (data.html) return String(data.html);
    if (data.path) {
      const html = await readTextFile(String(data.path));
      return html;
    }
    return null;
  } catch (e) {
    console.error('[DCC] Export HTML error:', e);
    return null;
  }
}

// =====================================================
// Helpers
// =====================================================

function scoreToGrade(score: number): string {
  if (score <= 20) return 'A';
  if (score <= 40) return 'B';
  if (score <= 60) return 'C';
  if (score <= 80) return 'D';
  return 'F';
}

/**
 * Parse debt result and filter to only files belonging to projectPath.
 * Recalculates score/grade/distribution from the filtered file list.
 */
function parseDebtResultForProject(result: unknown, projectPath: string): IndexStats | null {
  if (!result || typeof result !== 'object') return null;

  const data = result as Record<string, unknown>;
  // Use all_files for full list, fallback to top_debt_files
  const allFiles = (Array.isArray(data.all_files) ? data.all_files : []) as Record<string, unknown>[];

  // Debug: log what DCC actually returns
  if (allFiles.length > 0) {
    const samplePaths = allFiles.slice(0, 3).map(f => String(f.file_path || f.file || ''));
    console.log(`[DCC] parseDebt: projectPath="${projectPath}", total_files=${allFiles.length}, sample paths:`, samplePaths);
  } else {
    console.log(`[DCC] parseDebt: projectPath="${projectPath}", all_files is empty. Keys:`, Object.keys(data));
  }

  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  const projectFiles = allFiles.filter(f => {
    const fp = String(f.file_path || '');
    return pathMatchesProject(fp, prefix);
  });

  if (projectFiles.length === 0) {
    // No files indexed for this project — check if global data exists
    const totalGlobal = Number(data.total_files || 0);
    if (totalGlobal === 0) return null;
    // Global data exists but nothing for this project
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

// =====================================================
// CLAUDE.md Auto-Generation
// =====================================================

const DCC_SECTION_START = '<!-- DeltaCodeCube:start -->';
const DCC_SECTION_END = '<!-- DeltaCodeCube:end -->';

export async function generateClaudeMdSection(projectPath: string): Promise<boolean> {
  try {
    const stats = await getIndexStats(projectPath);
    if (!stats) return false;

    const tensions = await getTensions(projectPath).catch(() => []);
    const debtList = await getDebt(projectPath).catch(() => []);

    const topDebt = debtList.slice(0, 5);
    const activeTensions = tensions.slice(0, 5);

    let section = `\n${DCC_SECTION_START}\n`;
    section += `## Codebase Health (DeltaCodeCube)\n\n`;
    section += `- **Score:** ${stats.codebaseScore} (Grade ${stats.grade})\n`;
    section += `- **Files indexed:** ${stats.totalFiles}\n`;
    section += `- **Distribution:** A:${stats.distribution.A} B:${stats.distribution.B} C:${stats.distribution.C} D:${stats.distribution.D} F:${stats.distribution.F}\n`;

    if (activeTensions.length > 0) {
      section += `\n### Active Tensions\n`;
      for (const t of activeTensions) {
        section += `- ${t.fileA} <-> ${t.fileB} (distance: ${t.distance.toFixed(2)})\n`;
      }
    }

    if (topDebt.length > 0) {
      section += `\n### Top Technical Debt\n`;
      for (const d of topDebt) {
        section += `- ${d.file} — Grade ${d.grade} (score: ${d.score})\n`;
      }
    }

    section += `\n${DCC_SECTION_END}\n`;

    const claudeMdPath = `${projectPath}/CLAUDE.md`;
    let content = '';

    const fileExists = await exists(claudeMdPath);
    if (fileExists) {
      content = await readTextFile(claudeMdPath);
    }

    const startIdx = content.indexOf(DCC_SECTION_START);
    const endIdx = content.indexOf(DCC_SECTION_END);

    if (startIdx !== -1 && endIdx !== -1) {
      content = content.substring(0, startIdx) + section.trim() + '\n' + content.substring(endIdx + DCC_SECTION_END.length);
    } else {
      content = content.trimEnd() + '\n' + section;
    }

    await writeTextFile(claudeMdPath, content);
    console.log('[DCC] CLAUDE.md section updated');
    return true;
  } catch (e) {
    console.error('[DCC] CLAUDE.md generation error:', e);
    return false;
  }
}
