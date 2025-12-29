/**
 * Git Service
 *
 * Wrapper for git commands executed via Tauri backend.
 * Foundation for snapshot and repository management features.
 */

import { invoke } from '@tauri-apps/api/core';
import { withTimeout, TimeoutError } from '../core/utils/promiseTimeout';
import { backgroundPtyService } from './backgroundPtyService';

// Timeout for execute_command operations (prevents infinite hangs in bundled app)
const INVOKE_TIMEOUT_MS = 5000;

// Flag to enable background PTY for snapshot git commands
// Set to false to revert to execute_command behavior (for debugging)
const USE_BACKGROUND_PTY = true;

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

// Execute git command in project directory with timeout
// For snapshot commands (add, commit, tag), uses background PTY to avoid TCC cascade
async function execGit(projectPath: string, args: string): Promise<string> {
  // Detect snapshot-related git commands that should use background PTY
  // These are fire-and-forget commands where we don't need output
  const isSnapshotCommand =
    args.startsWith('add -A') ||
    args.startsWith('commit -m') ||
    args.startsWith('tag snapshot-');

  if (USE_BACKGROUND_PTY && isSnapshotCommand) {
    // Execute via background PTY (fire-and-forget, no return value)
    // This prevents TCC permission cascade in bundled macOS app
    await backgroundPtyService.execGit(projectPath, args);
    return ''; // Empty string, callers don't use return value for these commands
  }

  // For other git commands (status, diff, log, etc.), use execute_command with timeout
  try {
    const result = await withTimeout(
      invoke<string>('execute_command', {
        cmd: `git ${args}`,
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      `git ${args.substring(0, 50)}`
    );
    return result.trim();
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error(`[GitService] Timeout: ${error.message}`);
      throw new Error(`Git timeout: ${args.substring(0, 50)}`);
    }
    const errorStr = String(error);
    // Re-throw with more context
    throw new Error(`Git error: ${errorStr}`);
  }
}

// Execute git command, return null on error instead of throwing
async function execGitSafe(projectPath: string, args: string): Promise<string | null> {
  try {
    return await execGit(projectPath, args);
  } catch {
    return null;
  }
}

/**
 * Check if git is installed on the system
 */
export async function isGitInstalled(): Promise<boolean> {
  try {
    await withTimeout(
      invoke<string>('execute_command', {
        cmd: 'which git',
        cwd: '/',
      }),
      INVOKE_TIMEOUT_MS,
      'which git'
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if path is a git repository
 */
export async function isGitRepository(projectPath: string): Promise<boolean> {
  const result = await execGitSafe(projectPath, 'rev-parse --is-inside-work-tree');
  return result === 'true';
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
    const file = line.substring(3);

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
    // Check if rebase is in progress (either rebase-merge or rebase-apply dir exists)
    const rebaseCheck = await withTimeout(
      invoke<string>('execute_command', {
        cmd: 'test -d .git/rebase-merge -o -d .git/rebase-apply && echo "yes" || echo "no"',
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'check rebase status'
    );
    isRebasing = rebaseCheck.trim() === 'yes';

    // Check if merge is in progress (MERGE_HEAD file exists)
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
 * Get list of uncommitted changes (simplified)
 */
export async function getUncommittedChanges(projectPath: string): Promise<string[]> {
  const status = await getGitStatus(projectPath);
  return [...status.untrackedFiles, ...status.modifiedFiles, ...status.stagedFiles];
}

/**
 * Initialize a new git repository
 */
export async function initRepository(projectPath: string): Promise<void> {
  await execGit(projectPath, 'init');

  // Create initial .gitignore if it doesn't exist
  const gitignoreContent = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
.cursor/
*.swp
*.swo
.DS_Store

# AI Tools
.agentcockpit/
.claude/
`;

  try {
    await withTimeout(
      invoke<string>('execute_command', {
        cmd: `cat > .gitignore << 'EOF'
${gitignoreContent}
EOF`,
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'create .gitignore'
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.warn('[GitService] .gitignore creation timed out');
    } else {
      console.warn('[GitService] Failed to create .gitignore');
    }
  }
}

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
 * Stage all changes
 */
export async function stageAll(projectPath: string): Promise<void> {
  await execGit(projectPath, 'add -A');
}

/**
 * Create a commit with message
 * Returns the commit hash
 */
export async function createCommit(projectPath: string, message: string): Promise<string> {
  // Stage all changes first
  await stageAll(projectPath);

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

/**
 * Clone a repository
 */
export async function cloneRepository(url: string, targetPath: string, token?: string): Promise<void> {
  let cloneUrl = url;

  // If token provided, inject into URL for HTTPS
  if (token && url.startsWith('https://github.com/')) {
    cloneUrl = url.replace('https://github.com/', `https://${token}@github.com/`);
  }

  // Clone can take longer - use 30s timeout
  await withTimeout(
    invoke<string>('execute_command', {
      cmd: `git clone "${cloneUrl}" "${targetPath}"`,
      cwd: '/',
    }),
    30000,
    `git clone ${url}`
  );
}

/**
 * Get files changed in a commit
 */
export async function getCommitFiles(projectPath: string, commitHash: string): Promise<string[]> {
  const result = await execGitSafe(projectPath, `diff-tree --no-commit-id --name-only -r ${commitHash}`);
  if (!result) return [];
  return result.split('\n').filter(Boolean);
}
