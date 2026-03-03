/**
 * Git Push Service — push, squash snapshot commits
 */

import { invoke } from '@tauri-apps/api/core';
import { withTimeout } from '../../core/utils/promiseTimeout';
import { execGit, execGitSafe } from './gitCore';
import { listTags, deleteTag } from './gitTagService';

/**
 * Result of squashing snapshot commits
 */
export interface SquashResult {
  squashed: boolean;
  allSnapshots?: boolean;
  count?: number;
  tagsRemoved?: number;
}

export const SNAPSHOT_REGEX = /^Snapshot V\d+$/;

/**
 * Detect and squash consecutive snapshot commits from HEAD before pushing.
 *
 * Snapshot commits ("Snapshot V234") are internal-only return points created
 * on every Enter key press. They should never be pushed to remote.
 *
 * This function:
 * 1. Finds the upstream tracking branch
 * 2. Counts consecutive snapshot commits from HEAD backwards (up to upstream)
 * 3. Soft-resets them so changes remain staged
 * 4. Cleans up orphaned snapshot tags
 */
export async function squashSnapshotCommits(projectPath: string): Promise<SquashResult> {
  // Get current branch
  const branch = await execGitSafe(projectPath, 'rev-parse --abbrev-ref HEAD');
  if (!branch) return { squashed: false };

  // Get upstream tracking branch
  const upstream = await execGitSafe(projectPath, `rev-parse --abbrev-ref ${branch}@{upstream}`);
  if (!upstream) {
    // No upstream configured — skip, git push will error on its own
    return { squashed: false };
  }

  // Get commit messages between upstream and HEAD
  const logOutput = await execGitSafe(projectPath, `log --format=%s ${upstream}..HEAD`);
  if (!logOutput) return { squashed: false };

  const messages = logOutput.split('\n').filter(Boolean);
  if (messages.length === 0) return { squashed: false };

  // Count consecutive snapshot commits from HEAD backwards
  let snapshotCount = 0;
  for (const msg of messages) {
    if (SNAPSHOT_REGEX.test(msg)) {
      snapshotCount++;
    } else {
      break;
    }
  }

  if (snapshotCount === 0) return { squashed: false };

  // If ALL commits between upstream and HEAD are snapshots, block the push
  if (snapshotCount === messages.length) {
    return { squashed: false, allSnapshots: true, count: snapshotCount };
  }

  // Soft reset to remove snapshot commits but keep changes staged
  await execGit(projectPath, `reset --soft HEAD~${snapshotCount}`);

  // Clean up orphaned snapshot tags
  const snapshotTags = await listTags(projectPath, 'snapshot-v*');
  let tagsRemoved = 0;
  for (const tag of snapshotTags) {
    // Check if the tag's commit still exists in the reachable history
    const tagCommit = await execGitSafe(projectPath, `rev-list -n 1 ${tag}`);
    if (tagCommit) {
      const isReachable = await execGitSafe(projectPath, `merge-base --is-ancestor ${tagCommit} HEAD`);
      // merge-base --is-ancestor exits 0 (empty string) if ancestor, error if not
      if (isReachable === null) {
        await deleteTag(projectPath, tag);
        tagsRemoved++;
      }
    }
  }

  return { squashed: true, count: snapshotCount, tagsRemoved };
}

/**
 * Push commits to remote.
 * Automatically detects and squashes snapshot commits before pushing.
 * Throws descriptive errors when snapshots are found so the user can
 * create a real commit before retrying.
 */
export async function gitPush(projectPath: string, remote = 'origin'): Promise<void> {
  // Auto-squash snapshot commits before pushing
  const squashResult = await squashSnapshotCommits(projectPath);

  if (squashResult.allSnapshots) {
    throw new Error(
      `All ${squashResult.count} commit(s) ahead of remote are snapshots. ` +
      `Create a real commit with a descriptive message first, then push.`
    );
  }

  if (squashResult.squashed) {
    const tagMsg = squashResult.tagsRemoved
      ? ` (${squashResult.tagsRemoved} orphaned tag(s) cleaned up)`
      : '';
    throw new Error(
      `Auto-squashed ${squashResult.count} snapshot commit(s)${tagMsg}. ` +
      `Changes are staged — create a commit with a descriptive message, then push again.`
    );
  }

  // No snapshots found — proceed with normal push
  await withTimeout(
    invoke<string>('execute_command', {
      cmd: `git push ${remote}`,
      cwd: projectPath,
    }),
    30000,
    `git push ${remote}`
  );
}
