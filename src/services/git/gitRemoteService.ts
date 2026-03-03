/**
 * Git Remote Service — remotes, sync status
 */

import { execGit, execGitSafe } from './gitCore';
import { hasLocalGitRepo } from './gitRepoService';

/**
 * Check if remote exists
 */
export async function hasRemote(projectPath: string, remoteName: string = 'origin'): Promise<boolean> {
  const result = await execGitSafe(projectPath, `remote get-url ${remoteName}`);
  return result !== null;
}

/**
 * Get remote URL
 */
export async function getRemoteUrl(projectPath: string, remoteName: string = 'origin'): Promise<string | null> {
  return await execGitSafe(projectPath, `remote get-url ${remoteName}`);
}

/**
 * List all remotes with their URLs
 */
export async function listRemotes(projectPath: string): Promise<Array<{ name: string; url: string }>> {
  const result = await execGitSafe(projectPath, 'remote -v');
  if (!result) return [];

  const remotes: Array<{ name: string; url: string }> = [];
  const seen = new Set<string>();

  const lines = result.split('\n').filter(Boolean);
  for (const line of lines) {
    // Format: "origin\thttps://github.com/user/repo.git (fetch)"
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      remotes.push({
        name: match[1],
        url: match[2],
      });
    }
  }

  return remotes;
}

/**
 * Add a new remote
 */
export async function addRemote(projectPath: string, remoteName: string, url: string): Promise<void> {
  await execGit(projectPath, `remote add ${remoteName} ${url}`);
}

/**
 * Set remote URL (update existing or add new)
 */
export async function setRemoteUrl(projectPath: string, url: string, remoteName: string = 'origin'): Promise<void> {
  const exists = await hasRemote(projectPath, remoteName);

  if (exists) {
    await execGit(projectPath, `remote set-url ${remoteName} ${url}`);
  } else {
    await addRemote(projectPath, remoteName, url);
  }
}

/**
 * Sync status with remote
 */
export interface SyncStatus {
  ahead: number;
  behind: number;
  hasRemote: boolean;
  remoteBranch: string | null;
}

/**
 * Get sync status with remote (ahead/behind commits)
 * Uses local tracking info only - no network requests.
 * Returns null if not a repo or no remote configured.
 */
export async function getSyncStatus(projectPath: string, remoteName: string = 'origin'): Promise<SyncStatus | null> {
  const isRepo = await hasLocalGitRepo(projectPath);
  if (!isRepo) return null;

  const remoteExists = await hasRemote(projectPath, remoteName);
  if (!remoteExists) {
    return {
      ahead: 0,
      behind: 0,
      hasRemote: false,
      remoteBranch: null,
    };
  }

  // Get current branch
  const branch = await execGitSafe(projectPath, 'rev-parse --abbrev-ref HEAD');
  if (!branch) return null;

  // Get the upstream tracking branch (if set)
  const upstream = await execGitSafe(projectPath, `rev-parse --abbrev-ref ${branch}@{upstream}`);

  if (!upstream) {
    // No upstream tracking branch configured
    return {
      ahead: 0,
      behind: 0,
      hasRemote: true,
      remoteBranch: null,
    };
  }

  // Get ahead/behind counts using local refs (no network)
  const result = await execGitSafe(projectPath, `rev-list --left-right --count ${branch}...${upstream}`);

  if (!result) {
    return {
      ahead: 0,
      behind: 0,
      hasRemote: true,
      remoteBranch: upstream,
    };
  }

  const [ahead, behind] = result.trim().split(/\s+/).map(Number);

  return {
    ahead: ahead || 0,
    behind: behind || 0,
    hasRemote: true,
    remoteBranch: upstream,
  };
}
