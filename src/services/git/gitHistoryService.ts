/**
 * Git History Service — checkout, reset, stash
 */

import { execGit } from './gitCore';

/**
 * Checkout to a specific commit (detached HEAD)
 */
export async function checkoutCommit(projectPath: string, commitHash: string): Promise<void> {
  await execGit(projectPath, `checkout ${commitHash}`);
}

/**
 * Hard reset to a specific commit (destructive)
 */
export async function resetHard(projectPath: string, commitHash: string): Promise<void> {
  await execGit(projectPath, `reset --hard ${commitHash}`);
}

/**
 * Stash current changes
 */
export async function stash(projectPath: string, message?: string): Promise<void> {
  const args = message ? `stash push -m "${message.replace(/"/g, '\\"')}"` : 'stash';
  await execGit(projectPath, args);
}

/**
 * Pop stashed changes
 */
export async function stashPop(projectPath: string): Promise<void> {
  await execGit(projectPath, 'stash pop');
}
