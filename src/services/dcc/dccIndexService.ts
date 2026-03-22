/**
 * DCC Index Service — index, reindex, incremental reindex
 */

import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { indexEvents } from '../../core/utils/indexEventBus';
import type { IndexStats } from './dccTypes';
import { dccState, callDccTool, getProjectDataDir, parseDebtResultForProject } from './_dccInternal';
import { execGitSafe } from '../git/gitCore';

// =====================================================
// Git Helpers (local to indexing)
// =====================================================

async function getCurrentCommit(projectPath: string): Promise<string | null> {
  const hash = await execGitSafe(projectPath, 'rev-parse HEAD');
  return hash || null;
}

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

async function saveLastIndexedCommit(projectPath: string, commitHash: string): Promise<void> {
  try {
    const dataDir = await getProjectDataDir(projectPath);
    await writeTextFile(`${dataDir}/last_commit`, commitHash);
  } catch (e) {
    console.warn('[DCC] Failed to save last indexed commit:', e);
  }
}

async function getChangedFiles(
  projectPath: string,
  fromCommit: string,
  toCommit: string,
): Promise<{ modified: string[]; added: string[]; deleted: string[] }> {
  const modified: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  try {
    const diffOutput = await execGitSafe(
      projectPath,
      `diff --name-status ${fromCommit} ${toCommit}`,
    );

    if (!diffOutput) return { modified, added, deleted };

    for (const line of diffOutput.split('\n')) {
      if (!line.trim()) continue;
      const status = line[0];
      const filePath = line.substring(1).trim().split('\t').pop()?.trim() || '';
      if (!filePath) continue;

      if (!isSourceFile(filePath)) continue;

      if (status === 'A') added.push(filePath);
      else if (status === 'D') deleted.push(filePath);
      else modified.push(filePath);
    }
  } catch (e) {
    console.warn('[DCC] git diff failed:', e);
  }

  return { modified, added, deleted };
}

function isSourceFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const sourceExts = new Set([
    'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
    'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'vue', 'svelte',
  ]);
  return sourceExts.has(ext);
}

// =====================================================
// Public API
// =====================================================

export function isIndexing(): boolean {
  return dccState.indexingInProgress;
}

/**
 * First-time index: indexes everything, then diffs last 2 commits for initial deltas.
 */
export async function indexProject(projectPath: string): Promise<IndexStats | null> {
  if (dccState.indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  dccState.indexingInProgress = true;
  try {
    indexEvents.emit('indexing', { projectPath, timestamp: Date.now() });

    await callDccTool('cube_index_directory', { path: projectPath }, projectPath);

    const headCommit = await getCurrentCommit(projectPath);
    if (headCommit) {
      try {
        const prevCommit = await execGitSafe(projectPath, 'rev-parse HEAD~1');
        if (prevCommit) {
          const { modified } = await getChangedFiles(projectPath, prevCommit, headCommit);
          if (modified.length > 0) {
            for (const file of modified) {
              try {
                await callDccTool('cube_reindex', { path: `${projectPath}/${file}` }, projectPath);
              } catch { /* skip */ }
            }
          }
        }
      } catch {
        // No previous commit for initial delta detection
      }

      await saveLastIndexedCommit(projectPath, headCommit);
    }

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
    dccState.indexingInProgress = false;
  }
}

/**
 * Commit-based reindex: only processes files changed since last indexed commit.
 */
export async function reindexProject(projectPath: string): Promise<IndexStats | null> {
  if (dccState.indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  dccState.indexingInProgress = true;
  try {
    indexEvents.emit('indexing', { projectPath, timestamp: Date.now() });

    const headCommit = await getCurrentCommit(projectPath);
    const lastCommit = await getLastIndexedCommit(projectPath);

    if (!headCommit) {
      await callDccTool('cube_index_directory', { path: projectPath }, projectPath);
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      const stats = parseDebtResultForProject(debtResult, projectPath);
      if (stats) {
        indexEvents.emit('indexed', { projectPath, totalFiles: stats.totalFiles, grade: stats.grade, score: stats.codebaseScore, timestamp: Date.now() });
      }
      return stats;
    }

    if (lastCommit === headCommit) {
      dccState.indexingInProgress = false;
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      return parseDebtResultForProject(debtResult, projectPath);
    }

    if (!lastCommit) {
      await callDccTool('cube_index_directory', { path: projectPath }, projectPath);
      await saveLastIndexedCommit(projectPath, headCommit);
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      const stats = parseDebtResultForProject(debtResult, projectPath);
      if (stats) {
        indexEvents.emit('indexed', { projectPath, totalFiles: stats.totalFiles, grade: stats.grade, score: stats.codebaseScore, timestamp: Date.now() });
      }
      return stats;
    }

    const fromCommit = lastCommit;
    const { modified, added } = await getChangedFiles(projectPath, fromCommit, headCommit);
    const totalChanged = modified.length + added.length;

    if (totalChanged === 0) {
      await saveLastIndexedCommit(projectPath, headCommit);
      dccState.indexingInProgress = false;
      const debtResult = await callDccTool('cube_get_debt', {}, projectPath);
      return parseDebtResultForProject(debtResult, projectPath);
    }

    for (const file of modified) {
      try {
        await callDccTool('cube_reindex', { path: `${projectPath}/${file}` }, projectPath);
      } catch {
        // Skip files that fail
      }
    }

    for (const file of added) {
      try {
        await callDccTool('cube_index_file', { file_path: `${projectPath}/${file}` }, projectPath);
      } catch {
        // Skip
      }
    }

    await saveLastIndexedCommit(projectPath, headCommit);

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
    dccState.indexingInProgress = false;
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
  if (dccState.indexingInProgress) {
    console.warn('[DCC] Indexing already in progress, skipping');
    return null;
  }

  const totalFiles = changedFiles.length + addedFiles.length;
  if (totalFiles === 0) {
    return null;
  }

  dccState.indexingInProgress = true;
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

    const headCommit = await getCurrentCommit(projectPath);
    if (headCommit) await saveLastIndexedCommit(projectPath, headCommit);
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
    dccState.indexingInProgress = false;
  }
}
