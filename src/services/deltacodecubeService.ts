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
}

export interface DebtInfo {
  file: string;
  score: number;
  grade: string;
  issues: string[];
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
let _serverStartFailed = false; // Prevents retrying after fatal failure
let _indexingInProgress = false;

// Timeout helper for DCC operations
const DCC_START_TIMEOUT_MS = 15_000; // 15s for server startup
const DCC_CALL_TIMEOUT_MS = 30_000;  // 30s for tool calls
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
  _serverStartFailed = false; // Allow retry after reinstall
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
  return `${_homeDirCache}.deltacodecube/projects/${basename}-${hashHex}`;
}

async function ensureDccServer(projectPath: string): Promise<void> {
  if (_serverStartedForProject === projectPath) return;

  // Don't retry after fatal failure (prevents repeated hangs)
  if (_serverStartFailed) {
    throw new Error('[DCC] Server start previously failed — skipping to prevent hang');
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
    _serverStartFailed = false;
    console.log(`[DCC] MCP server started for project: ${projectPath}`);
  })();

  _serverStartPromise.catch((err) => {
    _serverStartPromise = null;
    _serverStartFailed = true;
    console.error('[DCC] Server start failed (will not retry until reload):', err);
  });
  return _serverStartPromise;
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
// Indexing
// =====================================================

export function isIndexing(): boolean {
  return _indexingInProgress;
}

export async function indexProject(projectPath: string): Promise<IndexStats | null> {
  if (_indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  _indexingInProgress = true;
  console.log(`[DCC] Indexing: ${projectPath}`);
  try {
    indexEvents.emit('indexing', { projectPath, timestamp: Date.now() });

    await callDccTool('cube_index_directory', { path: projectPath }, projectPath);
    console.log('[DCC] cube_index_directory completed, fetching debt...');
    const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
    console.log('[DCC] cube_get_debt raw keys:', debtResult && typeof debtResult === 'object' ? Object.keys(debtResult as object) : typeof debtResult);
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

export async function reindexProject(projectPath: string): Promise<IndexStats | null> {
  if (_indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  _indexingInProgress = true;
  console.log(`[DCC] Reindexing: ${projectPath}`);
  try {
    indexEvents.emit('indexing', { projectPath, timestamp: Date.now() });

    await callDccTool('cube_index_directory', { path: projectPath }, projectPath);
    console.log('[DCC] cube_index_directory completed, fetching debt...');
    const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
    console.log('[DCC] cube_get_debt raw keys:', debtResult && typeof debtResult === 'object' ? Object.keys(debtResult as object) : typeof debtResult);
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
    return null;
  } finally {
    _indexingInProgress = false;
  }
}

/**
 * Incremental reindex: only process files that changed.
 * Uses cube_reindex (existing files) and cube_index_file (new files).
 * Much faster than full cube_index_directory.
 *
 * @param changedFiles - relative paths of modified files
 * @param addedFiles - relative paths of newly added files
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

    // Reindex modified files (cube_reindex detects deltas)
    for (const file of changedFiles) {
      const absPath = `${projectPath}/${file}`;
      try {
        await callDccTool('cube_reindex', { file_path: absPath }, projectPath);
      } catch (e) {
        console.warn(`[DCC] Failed to reindex ${file}:`, e);
      }
    }

    // Index new files
    for (const file of addedFiles) {
      const absPath = `${projectPath}/${file}`;
      try {
        await callDccTool('cube_index_file', { file_path: absPath }, projectPath);
      } catch (e) {
        console.warn(`[DCC] Failed to index new file ${file}:`, e);
      }
    }

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
 * DCC tools return GLOBAL data (all indexed projects).
 * We filter client-side by projectPath since file_path is stored as absolute.
 */
function filterFilesByProject(files: Record<string, unknown>[], projectPath: string): Record<string, unknown>[] {
  const prefix = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  return files.filter(f => {
    const fp = String(f.file_path || f.file || '');
    return fp.startsWith(prefix);
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
          fileA: String(item.file_a || item.fileA || ''),
          fileB: String(item.file_b || item.fileB || ''),
          distance: Number(item.distance || 0),
          type: String(item.type || 'unknown'),
        };
      })
      .filter(t => t.fileA.startsWith(prefix) || t.fileB.startsWith(prefix));
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
    // DCC stores absolute paths — match only files under this project's prefix
    return fp.startsWith(prefix);
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
