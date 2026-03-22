/**
 * Git Staging Service — stage files, create commits
 */

import { execGit, execGitSafe } from './gitCore';
import { getGitStatus } from './gitStatusService';

/**
 * Stage all changes
 */
export async function stageAll(projectPath: string): Promise<void> {
  await execGit(projectPath, 'add -A');
}

/**
 * Stage specific files only
 */
export async function stageFiles(projectPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  // Quote file paths to handle spaces and special characters
  const quotedFiles = files.map(f => `"${f.replace(/"/g, '\\"')}"`).join(' ');
  await execGit(projectPath, `add ${quotedFiles}`);
}

/**
 * Create a commit with message
 * If specificFiles is provided, only stage those files instead of all changes
 * Returns the commit hash
 */
export async function createCommit(
  projectPath: string,
  message: string,
  specificFiles?: string[]
): Promise<string> {
  // Stage changes - either specific files or all
  if (specificFiles && specificFiles.length > 0) {
    await stageFiles(projectPath, specificFiles);
  } else {
    await stageAll(projectPath);
  }

  // Check if there's anything to commit
  const status = await getGitStatus(projectPath);
  if (!status.hasUncommittedChanges && status.stagedFiles.length === 0) {
    // Nothing to commit, get current HEAD
    const head = await execGitSafe(projectPath, 'rev-parse HEAD');
    if (head) return head;

    // No commits yet, create initial commit
    await execGit(projectPath, `commit --allow-empty -m "${message.replace(/"/g, '\\"')}"`);
  } else {
    // Create commit
    await execGit(projectPath, `commit -m "${message.replace(/"/g, '\\"')}"`);
  }

  // Get the commit hash
  const hash = await execGit(projectPath, 'rev-parse HEAD');
  return hash;
}
