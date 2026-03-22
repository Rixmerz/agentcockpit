/**
 * Git Watcher Service (Singleton)
 *
 * Centralized polling service that monitors git state every 10s.
 *
 * Events:
 * - 'status'  → every poll (UI: branch, changes count, sync)
 * - 'changed' → when dirty file set changes (new/removed files)
 * - 'commit'  → when HEAD hash changes (new commit detected)
 * - 'error'   → on poll failure
 *
 * DCC reindex triggers on 'commit' only — a commit is a stable
 * checkpoint where contracts, tensions, and debt analysis make sense.
 */

import { getGitStatus, getSyncStatus, hasLocalGitRepo, getHeadCommitHash } from './gitService';
import { enableAutoReindex, disableAutoReindex } from './dccAutoReindexService';
import { gitWatcherEvents } from '../core/utils/gitWatcherEventBus';

const POLL_INTERVAL_MS = 10_000;

// Module-level singleton state
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _projectPath: string | null = null;
let _isPolling = false;
let _lastFileSet: Set<string> = new Set();
let _lastHeadHash: string | null = null;

async function doPoll(): Promise<void> {
  if (_isPolling || !_projectPath) return;
  _isPolling = true;

  const projectPath = _projectPath;

  try {
    const hasRepo = await hasLocalGitRepo(projectPath);

    if (!hasRepo) {
      gitWatcherEvents.emit('status', {
        projectPath,
        branch: null,
        hasChanges: false,
        modifiedFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        syncStatus: null,
        hasRepo: false,
        timestamp: Date.now(),
      });
      _lastFileSet = new Set();
      _lastHeadHash = null;
      return;
    }

    const [status, syncStatus, headHash] = await Promise.all([
      getGitStatus(projectPath),
      getSyncStatus(projectPath),
      getHeadCommitHash(projectPath),
    ]);

    const allFiles = [
      ...status.modifiedFiles,
      ...status.stagedFiles,
      ...status.untrackedFiles,
    ];
    const currentFileSet = new Set(allFiles);

    // Always emit status (UI needs this every poll)
    gitWatcherEvents.emit('status', {
      projectPath,
      branch: status.branch,
      hasChanges: status.hasUncommittedChanges,
      modifiedFiles: status.modifiedFiles,
      stagedFiles: status.stagedFiles,
      untrackedFiles: status.untrackedFiles,
      syncStatus,
      hasRepo: true,
      timestamp: Date.now(),
    });

    // Detect dirty file set changes (new/removed files from working tree)
    const added = allFiles.filter(f => !_lastFileSet.has(f));
    const removed = [..._lastFileSet].filter(f => !currentFileSet.has(f));

    if (added.length > 0 || removed.length > 0) {
      gitWatcherEvents.emit('changed', {
        projectPath,
        changedFiles: [...added, ...removed],
        addedFiles: added,
        removedFiles: removed,
        timestamp: Date.now(),
      });
    }

    // Detect new commit (HEAD hash changed)
    if (headHash && _lastHeadHash !== null && headHash !== _lastHeadHash) {
      gitWatcherEvents.emit('commit', {
        projectPath,
        commitHash: headHash,
        previousHash: _lastHeadHash,
        timestamp: Date.now(),
      });
    }

    _lastFileSet = currentFileSet;
    _lastHeadHash = headHash;
  } catch (err) {
    console.warn('[GitWatcher] Poll error:', err);
    gitWatcherEvents.emit('error', {
      projectPath,
      error: String(err),
      timestamp: Date.now(),
    });
  } finally {
    _isPolling = false;
  }
}

function start(projectPath: string): void {
  if (_intervalId !== null) {
    stop();
  }

  _projectPath = projectPath;
  _lastFileSet = new Set();
  _lastHeadHash = null;

  // Immediate first poll (captures baseline, won't emit commit/changed)
  doPoll();

  _intervalId = setInterval(doPoll, POLL_INTERVAL_MS);
}

function stop(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _projectPath = null;
  _isPolling = false;
  _lastFileSet = new Set();
  _lastHeadHash = null;
}

function pollNow(): void {
  doPoll();
}

/**
 * Enable DCC auto-reindex on commit detection.
 * When enabled, commits trigger a debounced reindexProject() call.
 */
function setAutoReindex(projectPath: string, enabled: boolean): void {
  if (enabled) {
    enableAutoReindex(projectPath);
  } else {
    disableAutoReindex();
  }
}

export const gitWatcherService = { start, stop, pollNow, setAutoReindex };
