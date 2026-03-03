/**
 * Git Repository Service — init, clone, remove, detect repos
 */

import { invoke } from '@tauri-apps/api/core';
import { withTimeout, TimeoutError } from '../../core/utils/promiseTimeout';
import { execGit, execGitSafe, INVOKE_TIMEOUT_MS } from './gitCore';

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
 * Check if path is inside a git repository (may be in parent directory)
 * WARNING: This returns true even if .git is in a parent directory!
 * Use hasLocalGitRepo() for strict detection.
 */
export async function isGitRepository(projectPath: string): Promise<boolean> {
  const result = await execGitSafe(projectPath, 'rev-parse --is-inside-work-tree');
  return result === 'true';
}

/**
 * Check if path has its OWN .git directory (strict detection)
 * This does NOT detect parent directory repos - only repos in the exact path.
 * Use this for project-level git detection to avoid "phantom repo" issues.
 */
export async function hasLocalGitRepo(projectPath: string): Promise<boolean> {
  // Get the git directory path
  const gitDir = await execGitSafe(projectPath, 'rev-parse --git-dir');

  if (!gitDir) {
    return false;
  }

  // If gitDir is ".git", the repo is in projectPath itself
  if (gitDir === '.git') {
    return true;
  }

  // If gitDir is an absolute path, check if it's directly in projectPath
  // e.g., /Users/juan/project/.git should match /Users/juan/project
  const normalizedGitDir = gitDir.replace(/\/$/, ''); // Remove trailing slash
  const expectedGitDir = `${projectPath}/.git`.replace(/\/+/g, '/'); // Normalize slashes

  return normalizedGitDir === expectedGitDir || normalizedGitDir === '.git';
}

/**
 * Get the root directory of the git repository
 * Useful to detect if we're in a subdirectory of a repo
 */
export async function getGitRoot(projectPath: string): Promise<string | null> {
  const result = await execGitSafe(projectPath, 'rev-parse --show-toplevel');
  return result;
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
 * Remove git repository (.git directory) from a project
 */
export async function removeRepository(projectPath: string): Promise<void> {
  await withTimeout(
    invoke<string>('execute_command', {
      cmd: 'rm -rf .git',
      cwd: projectPath,
    }),
    INVOKE_TIMEOUT_MS,
    'rm -rf .git'
  );
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
