/**
 * Git Tag Service — create, delete, list tags
 */

import { execGit, execGitSafe } from './gitCore';

/**
 * Create a git tag
 */
export async function createTag(projectPath: string, tagName: string, commitHash?: string): Promise<void> {
  if (commitHash) {
    await execGit(projectPath, `tag ${tagName} ${commitHash}`);
  } else {
    await execGit(projectPath, `tag ${tagName}`);
  }
}

/**
 * Delete a git tag
 */
export async function deleteTag(projectPath: string, tagName: string): Promise<void> {
  await execGitSafe(projectPath, `tag -d ${tagName}`);
}

/**
 * List all tags matching pattern
 */
export async function listTags(projectPath: string, pattern?: string): Promise<string[]> {
  const args = pattern ? `tag -l "${pattern}"` : 'tag -l';
  const result = await execGitSafe(projectPath, args);
  if (!result) return [];
  return result.split('\n').filter(Boolean);
}

/**
 * Get commit hash for a tag
 */
export async function getTagCommit(projectPath: string, tagName: string): Promise<string | null> {
  return await execGitSafe(projectPath, `rev-list -n 1 ${tagName}`);
}
