/**
 * Git Status Service — status, commits, diffs
 */

import { invoke } from '@tauri-apps/api/core';
import { withTimeout } from '../../core/utils/promiseTimeout';
import { execGitSafe, INVOKE_TIMEOUT_MS } from './gitCore';
import { isGitRepository } from './gitRepoService';

// Types
export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  timestamp: number;
}

export interface GitStatus {
  isRepository: boolean;
  branch: string | null;
  hasUncommittedChanges: boolean;
  untrackedFiles: string[];
  modifiedFiles: string[];
  stagedFiles: string[];
  isRebasing: boolean;
  isMerging: boolean;
}

/**
 * Get full git status of repository
 */
export async function getGitStatus(projectPath: string): Promise<GitStatus> {
  const isRepo = await isGitRepository(projectPath);

  if (!isRepo) {
    return {
      isRepository: false,
      branch: null,
      hasUncommittedChanges: false,
      untrackedFiles: [],
      modifiedFiles: [],
      stagedFiles: [],
      isRebasing: false,
      isMerging: false,
    };
  }

  // Get current branch
  const branch = await execGitSafe(projectPath, 'rev-parse --abbrev-ref HEAD');

  // Get porcelain status
  const statusOutput = await execGitSafe(projectPath, 'status --porcelain') || '';

  const untrackedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const stagedFiles: string[] = [];

  for (const line of statusOutput.split('\n').filter(Boolean)) {
    const status = line.substring(0, 2);
    let fileStart = 2;
    while (fileStart < line.length && line[fileStart] === ' ') {
      fileStart++;
    }
    const file = line.substring(fileStart);

    if (status === '??') {
      untrackedFiles.push(file);
    } else if (status.startsWith(' ')) {
      modifiedFiles.push(file);
    } else if (!status.startsWith(' ')) {
      stagedFiles.push(file);
    }
  }

  // Check rebase/merge state by checking if the files/dirs actually exist
  let isRebasing = false;
  let isMerging = false;

  try {
    const rebaseCheck = await withTimeout(
      invoke<string>('execute_command', {
        cmd: 'test -d .git/rebase-merge -o -d .git/rebase-apply && echo "yes" || echo "no"',
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'check rebase status'
    );
    isRebasing = rebaseCheck.trim() === 'yes';

    const mergeCheck = await withTimeout(
      invoke<string>('execute_command', {
        cmd: 'test -f .git/MERGE_HEAD && echo "yes" || echo "no"',
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'check merge status'
    );
    isMerging = mergeCheck.trim() === 'yes';
  } catch {
    // Ignore errors, assume no operation in progress
  }

  return {
    isRepository: true,
    branch,
    hasUncommittedChanges: untrackedFiles.length > 0 || modifiedFiles.length > 0 || stagedFiles.length > 0,
    untrackedFiles,
    modifiedFiles,
    stagedFiles,
    isRebasing,
    isMerging,
  };
}

/**
 * Get the current HEAD commit hash.
 * Returns null if no commits exist yet.
 */
export async function getHeadCommitHash(projectPath: string): Promise<string | null> {
  return await execGitSafe(projectPath, 'rev-parse HEAD');
}

/**
 * Get list of uncommitted changes (simplified)
 */
export async function getUncommittedChanges(projectPath: string): Promise<string[]> {
  const status = await getGitStatus(projectPath);
  return [...status.untrackedFiles, ...status.modifiedFiles, ...status.stagedFiles];
}

/**
 * List commits (most recent first)
 */
export async function listCommits(projectPath: string, limit: number = 50): Promise<GitCommit[]> {
  const format = '%H|%h|%s|%an|%ai|%at';
  const result = await execGitSafe(projectPath, `log --format="${format}" -n ${limit}`);

  if (!result) return [];

  return result.split('\n').filter(Boolean).map(line => {
    const [hash, shortHash, message, author, date, timestamp] = line.split('|');
    return {
      hash,
      shortHash,
      message,
      author,
      date,
      timestamp: parseInt(timestamp, 10) * 1000,
    };
  });
}

/**
 * Get files changed in a commit
 */
export async function getCommitFiles(projectPath: string, commitHash: string): Promise<string[]> {
  const result = await execGitSafe(projectPath, `diff-tree --no-commit-id --name-only -r ${commitHash}`);
  if (!result) return [];
  return result.split('\n').filter(Boolean);
}

/**
 * Get files changed between two commits.
 * Returns relative paths of files that were added, modified, or deleted.
 */
export async function getFilesBetweenCommits(
  projectPath: string,
  fromHash: string,
  toHash: string
): Promise<{ changed: string[]; added: string[]; deleted: string[] }> {
  const result = await execGitSafe(projectPath, `diff --name-status ${fromHash}..${toHash}`);
  if (!result) return { changed: [], added: [], deleted: [] };

  const changed: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  for (const line of result.split('\n').filter(Boolean)) {
    const status = line[0];
    const file = line.substring(1).trim();
    if (status === 'A') {
      added.push(file);
    } else if (status === 'D') {
      deleted.push(file);
    } else {
      changed.push(file); // M, R, C, etc.
    }
  }

  return { changed, added, deleted };
}
