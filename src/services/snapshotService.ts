/**
 * Snapshot Service
 *
 * Manages automatic git snapshots before agent interactions.
 * Creates V1, V2, V3... versioned commits with git tags.
 */

import { invoke } from '@tauri-apps/api/core';
import { withTimeout, TimeoutError } from '../core/utils/promiseTimeout';
import {
  isGitRepository,
  initRepository,
  createCommit,
  createTag,
  deleteTag,
  listTags,
  getTagCommit,
  resetHard,
  getCommitFiles,
  getGitStatus,
} from './gitService';

// Constants
const SNAPSHOT_TAG_PREFIX = 'snapshot-v';
const METADATA_DIR = '.agentcockpit';
const METADATA_FILE = 'snapshots.json';
const MAX_SNAPSHOTS = 50;
const INVOKE_TIMEOUT_MS = 5000;
// Reserved for future use: const LOCK_FILE = 'snapshot.lock';

// Types
export interface Snapshot {
  version: number;
  commitHash: string;
  tag: string;
  timestamp: number;
  message: string;
  filesChanged: string[];
}

export interface SnapshotMetadata {
  snapshots: Snapshot[];
  nextVersion: number;
  currentVersion: number | null;
}

// Lock management to prevent race conditions
const lockMap = new Map<string, Promise<void>>();

async function acquireLock(projectPath: string): Promise<() => void> {
  // Wait for existing lock
  const existingLock = lockMap.get(projectPath);
  if (existingLock) {
    await existingLock;
  }

  // Create new lock
  let releaseLock: () => void;
  const lockPromise = new Promise<void>(resolve => {
    releaseLock = resolve;
  });

  lockMap.set(projectPath, lockPromise);

  return () => {
    lockMap.delete(projectPath);
    releaseLock!();
  };
}

// Metadata file operations using execute_command (bypasses Tauri FS permissions for hidden dirs)
async function ensureMetadataDir(projectPath: string): Promise<void> {
  const dirPath = `${projectPath}/${METADATA_DIR}`;
  try {
    await withTimeout(
      invoke<string>('execute_command', {
        cmd: `mkdir -p "${dirPath}"`,
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'mkdir metadata dir'
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error('[Snapshot] Timeout creating metadata dir:', error.message);
    }
    // Directory might already exist - don't throw
  }
}

async function readMetadata(projectPath: string): Promise<SnapshotMetadata> {
  const filePath = `${projectPath}/${METADATA_DIR}/${METADATA_FILE}`;

  try {
    // Check if file exists
    const checkResult = await withTimeout(
      invoke<string>('execute_command', {
        cmd: `test -f "${filePath}" && echo "exists" || echo "missing"`,
        cwd: projectPath,
      }),
      2000,
      'check file exists'
    );

    if (checkResult.trim() !== 'exists') {
      return {
        snapshots: [],
        nextVersion: 1,
        currentVersion: null,
      };
    }

    // Read file content
    const content = await withTimeout(
      invoke<string>('execute_command', {
        cmd: `cat "${filePath}"`,
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'read metadata file'
    );

    return JSON.parse(content) as SnapshotMetadata;
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error('[Snapshot] Timeout reading metadata:', error.message);
    }
    // File doesn't exist or is invalid, return default
    return {
      snapshots: [],
      nextVersion: 1,
      currentVersion: null,
    };
  }
}

async function writeMetadata(projectPath: string, metadata: SnapshotMetadata): Promise<void> {
  await ensureMetadataDir(projectPath);

  const filePath = `${projectPath}/${METADATA_DIR}/${METADATA_FILE}`;
  const content = JSON.stringify(metadata, null, 2);

  // Escape content for shell (use base64 to avoid escaping issues)
  const base64Content = btoa(content);

  try {
    await withTimeout(
      invoke<string>('execute_command', {
        cmd: `echo "${base64Content}" | base64 -d > "${filePath}"`,
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'write metadata file'
    );
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error('[Snapshot] Timeout writing metadata:', error.message);
      throw new Error('Snapshot metadata save timed out');
    }
    throw error;
  }
}

/**
 * Create a new snapshot before sending message to agent
 *
 * @param projectPath - Absolute path to project
 * @returns Created snapshot or null if nothing to snapshot
 */
export async function createSnapshot(projectPath: string): Promise<Snapshot | null> {
  const releaseLock = await acquireLock(projectPath);

  try {
    // Ensure git repository exists
    const isRepo = await isGitRepository(projectPath);
    if (!isRepo) {
      console.log('[Snapshot] Initializing git repository...');
      await initRepository(projectPath);
    }

    // Check git status
    const status = await getGitStatus(projectPath);

    // Skip if rebase/merge in progress
    if (status.isRebasing || status.isMerging) {
      console.log('[Snapshot] Skipping - git operation in progress');
      return null;
    }

    // Directories that should NOT count as "real changes" for snapshots
    // These are tool/IDE metadata that change frequently during normal usage
    const EXCLUDED_DIRS = [
      '.agentcockpit', // AgentCockpit snapshot metadata
      '.claude',       // Claude Code config, memory, sessions
      '.cursor',       // Cursor IDE settings
      '.vscode',       // VS Code settings
      '.idea',         // JetBrains IDEs
      '.git',          // Git internals (shouldn't appear but safety check)
    ];

    // Individual files that should NOT count as "real changes"
    const EXCLUDED_FILES = [
      'one-term-project.json', // AgentCockpit project config/sessions
    ];

    // Match excluded dirs at start OR anywhere in path (for subdirectory projects)
    // Examples that should match:
    //   ".agentcockpit/snapshots.json" (dir at root)
    //   "landing-fresh/.agentcockpit/snapshots.json" (project in subdirectory)
    //   "src/.claude/memory.db" (nested)
    const isExcludedPath = (f: string) => {
      const normalized = f.replace(/\\/g, '/');
      // Check if file matches any excluded file name (at root or in subdirs)
      const fileName = normalized.split('/').pop() || '';
      if (EXCLUDED_FILES.includes(fileName)) return true;
      // Check if path is inside excluded directory
      return EXCLUDED_DIRS.some(dir => {
        // Match: starts with "dir/" OR contains "/dir/"
        return normalized.startsWith(dir + '/') || normalized.includes('/' + dir + '/');
      });
    };

    // Filter to get only real code changes
    const realChanges = {
      untracked: status.untrackedFiles.filter(f => !isExcludedPath(f)),
      modified: status.modifiedFiles.filter(f => !isExcludedPath(f)),
      staged: status.stagedFiles.filter(f => !isExcludedPath(f)),
    };

    const excludedCount =
      (status.untrackedFiles.length - realChanges.untracked.length) +
      (status.modifiedFiles.length - realChanges.modified.length) +
      (status.stagedFiles.length - realChanges.staged.length);

    const hasRealChanges =
      realChanges.untracked.length > 0 ||
      realChanges.modified.length > 0 ||
      realChanges.staged.length > 0;

    // Debug log showing real vs excluded changes
    console.log(`[Snapshot] Changes: real=${realChanges.untracked.length + realChanges.modified.length + realChanges.staged.length}, excluded=${excludedCount}`);

    // Skip if no real uncommitted changes (tool/IDE files don't count)
    if (!hasRealChanges) {
      console.log('[Snapshot] Skipping - only tool/IDE metadata changed, no real code changes');
      return null;
    }

    // Read current metadata
    const metadata = await readMetadata(projectPath);
    const version = metadata.nextVersion;
    const tag = `${SNAPSHOT_TAG_PREFIX}${version}`;

    // Create commit message
    const message = `Snapshot V${version}`;

    // Collect all real files to stage (excluding tool/IDE metadata)
    const filesToStage = [
      ...realChanges.untracked,
      ...realChanges.modified,
      ...realChanges.staged,
    ];

    // DEBUG: Log files before passing to createCommit
    console.log('[Snapshot] DEBUG filesToStage:', filesToStage);
    console.log('[Snapshot] DEBUG filesToStage first chars:', filesToStage.map(f => ({ file: f, char0: f.charAt(0), code0: f.charCodeAt(0) })));

    // Create commit with only real changes (not tool/IDE metadata)
    const commitHash = await createCommit(projectPath, message, filesToStage);

    // Create tag for this snapshot
    await createTag(projectPath, tag, commitHash);

    // Get files changed in this commit
    const filesChanged = await getCommitFiles(projectPath, commitHash);

    // Create snapshot record
    const snapshot: Snapshot = {
      version,
      commitHash,
      tag,
      timestamp: Date.now(),
      message,
      filesChanged,
    };

    // Update metadata
    metadata.snapshots.push(snapshot);
    metadata.nextVersion = version + 1;
    metadata.currentVersion = version;

    // Prune old snapshots if needed
    if (metadata.snapshots.length > MAX_SNAPSHOTS) {
      const toRemove = metadata.snapshots.slice(0, metadata.snapshots.length - MAX_SNAPSHOTS);
      metadata.snapshots = metadata.snapshots.slice(-MAX_SNAPSHOTS);

      // Delete old tags
      for (const old of toRemove) {
        await deleteTag(projectPath, old.tag);
      }
    }

    // Save metadata
    await writeMetadata(projectPath, metadata);

    console.log(`[Snapshot] Created V${version} (${commitHash.substring(0, 7)})`);

    return snapshot;
  } catch (error) {
    console.error('[Snapshot] Error creating snapshot:', error);
    throw error;
  } finally {
    releaseLock();
  }
}

/**
 * Get commit info for a tag (timestamp, message, files changed)
 */
async function getTagInfo(projectPath: string, tagName: string): Promise<{
  commitHash: string;
  timestamp: number;
  message: string;
  filesChanged: string[];
} | null> {
  try {
    const commitHash = await getTagCommit(projectPath, tagName);
    if (!commitHash) return null;

    // Get commit timestamp and message
    const logOutput = await withTimeout(
      invoke<string>('execute_command', {
        cmd: `git log -1 --format="%at|%s" ${commitHash}`,
        cwd: projectPath,
      }),
      INVOKE_TIMEOUT_MS,
      'git log for tag info'
    );

    const [timestampStr, message] = logOutput.trim().split('|');
    const timestamp = parseInt(timestampStr, 10) * 1000;

    // Get files changed
    const filesChanged = await getCommitFiles(projectPath, commitHash);

    return {
      commitHash,
      timestamp,
      message: message || `Snapshot ${tagName}`,
      filesChanged,
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error('[Snapshot] Timeout getting tag info:', error.message);
    }
    return null;
  }
}

/**
 * List all available snapshots for a project
 * Discovers existing git tags and syncs with metadata
 */
export async function listSnapshots(projectPath: string): Promise<Snapshot[]> {
  const isRepo = await isGitRepository(projectPath);
  if (!isRepo) {
    return [];
  }

  const metadata = await readMetadata(projectPath);

  // Get all snapshot tags from git
  const tags = await listTags(projectPath, `${SNAPSHOT_TAG_PREFIX}*`);

  // Create a map of existing snapshots by tag
  const existingByTag = new Map<string, Snapshot>();
  for (const snapshot of metadata.snapshots) {
    existingByTag.set(snapshot.tag, snapshot);
  }

  // Build final list: keep valid existing + discover new from git
  const allSnapshots: Snapshot[] = [];
  let highestVersion = 0;

  for (const tag of tags) {
    // Extract version number from tag (snapshot-v1 -> 1)
    const versionMatch = tag.match(/^snapshot-v(\d+)$/);
    if (!versionMatch) continue;

    const version = parseInt(versionMatch[1], 10);
    highestVersion = Math.max(highestVersion, version);

    // Check if we already have this snapshot in metadata
    const existing = existingByTag.get(tag);
    if (existing) {
      allSnapshots.push(existing);
    } else {
      // Discover from git - this is a snapshot we don't have in metadata
      const tagInfo = await getTagInfo(projectPath, tag);
      if (tagInfo) {
        const discoveredSnapshot: Snapshot = {
          version,
          commitHash: tagInfo.commitHash,
          tag,
          timestamp: tagInfo.timestamp,
          message: tagInfo.message,
          filesChanged: tagInfo.filesChanged,
        };
        allSnapshots.push(discoveredSnapshot);
        console.log(`[Snapshot] Discovered existing V${version} from git tag`);
      }
    }
  }

  // Sort by version
  allSnapshots.sort((a, b) => a.version - b.version);

  // Update metadata with discovered snapshots
  const needsUpdate = allSnapshots.length !== metadata.snapshots.length ||
    allSnapshots.some((s, i) => metadata.snapshots[i]?.tag !== s.tag);

  if (needsUpdate) {
    metadata.snapshots = allSnapshots;
    metadata.nextVersion = highestVersion + 1;
    await writeMetadata(projectPath, metadata);
  }

  return allSnapshots;
}

/**
 * Get current snapshot version
 */
export async function getCurrentVersion(projectPath: string): Promise<number | null> {
  const metadata = await readMetadata(projectPath);
  return metadata.currentVersion;
}

/**
 * Restore a specific snapshot version
 *
 * @param projectPath - Absolute path to project
 * @param version - Snapshot version to restore (e.g., 1 for V1)
 * @param force - Skip uncommitted changes check
 */
export async function restoreSnapshot(
  projectPath: string,
  version: number,
  force: boolean = false
): Promise<void> {
  const releaseLock = await acquireLock(projectPath);

  try {
    // Read metadata
    const metadata = await readMetadata(projectPath);

    // Find snapshot
    const snapshot = metadata.snapshots.find(s => s.version === version);
    if (!snapshot) {
      throw new Error(`Snapshot V${version} not found`);
    }

    // Verify tag still exists
    const commitHash = await getTagCommit(projectPath, snapshot.tag);
    if (!commitHash) {
      throw new Error(`Snapshot V${version} tag no longer exists`);
    }

    // Check for uncommitted changes if not forcing
    if (!force) {
      const status = await getGitStatus(projectPath);
      if (status.hasUncommittedChanges) {
        throw new Error('UNCOMMITTED_CHANGES');
      }
    }

    // Hard reset to the snapshot commit
    await resetHard(projectPath, commitHash);

    // Update current version in metadata
    metadata.currentVersion = version;
    await writeMetadata(projectPath, metadata);

    console.log(`[Snapshot] Restored to V${version}`);
  } finally {
    releaseLock();
  }
}

/**
 * Delete a specific snapshot
 */
export async function deleteSnapshot(projectPath: string, version: number): Promise<void> {
  const releaseLock = await acquireLock(projectPath);

  try {
    const metadata = await readMetadata(projectPath);

    // Find and remove snapshot
    const index = metadata.snapshots.findIndex(s => s.version === version);
    if (index === -1) {
      return; // Already doesn't exist
    }

    const snapshot = metadata.snapshots[index];

    // Delete git tag
    await deleteTag(projectPath, snapshot.tag);

    // Remove from metadata
    metadata.snapshots.splice(index, 1);
    await writeMetadata(projectPath, metadata);

    console.log(`[Snapshot] Deleted V${version}`);
  } finally {
    releaseLock();
  }
}

/**
 * Prune old snapshots, keeping only the most recent N
 */
export async function pruneSnapshots(projectPath: string, keepLast: number = MAX_SNAPSHOTS): Promise<number> {
  const releaseLock = await acquireLock(projectPath);

  try {
    const metadata = await readMetadata(projectPath);

    if (metadata.snapshots.length <= keepLast) {
      return 0; // Nothing to prune
    }

    const toRemove = metadata.snapshots.slice(0, metadata.snapshots.length - keepLast);
    metadata.snapshots = metadata.snapshots.slice(-keepLast);

    // Delete old tags
    for (const snapshot of toRemove) {
      await deleteTag(projectPath, snapshot.tag);
    }

    await writeMetadata(projectPath, metadata);

    console.log(`[Snapshot] Pruned ${toRemove.length} old snapshots`);
    return toRemove.length;
  } finally {
    releaseLock();
  }
}

/**
 * Clean up snapshots that have been pushed to remote.
 * Once a commit is on origin, the local snapshot is redundant.
 *
 * Logic: If snapshot's commit is an ancestor of origin/HEAD, it's backed up → delete it
 */
export async function cleanupPushedSnapshots(projectPath: string): Promise<number> {
  const releaseLock = await acquireLock(projectPath);

  try {
    const metadata = await readMetadata(projectPath);

    if (metadata.snapshots.length === 0) {
      return 0;
    }

    // Get the remote HEAD commit (origin/master or origin/main)
    let remoteHead: string | null = null;
    try {
      const result = await withTimeout(
        invoke<string>('execute_command', {
          cmd: 'git rev-parse origin/master 2>/dev/null || git rev-parse origin/main 2>/dev/null || echo ""',
          cwd: projectPath,
        }),
        INVOKE_TIMEOUT_MS,
        'get remote HEAD'
      );
      remoteHead = result.trim() || null;
    } catch {
      // No remote or offline - can't cleanup
      console.log('[Snapshot] No remote found, skipping pushed cleanup');
      return 0;
    }

    if (!remoteHead) {
      console.log('[Snapshot] No remote HEAD, skipping pushed cleanup');
      return 0;
    }

    const toRemove: Snapshot[] = [];
    const toKeep: Snapshot[] = [];

    // Find the most recent snapshot - NEVER delete this one
    // Even if pushed, user needs at least one snapshot for rollback
    const maxVersion = Math.max(...metadata.snapshots.map(s => s.version));

    for (const snapshot of metadata.snapshots) {
      // ALWAYS keep the most recent snapshot
      if (snapshot.version === maxVersion) {
        toKeep.push(snapshot);
        continue;
      }

      // Check if this snapshot's commit is an ancestor of remote HEAD
      // (meaning it has been pushed and is safely backed up)
      try {
        const mergeBaseResult = await withTimeout(
          invoke<string>('execute_command', {
            cmd: `git merge-base --is-ancestor ${snapshot.commitHash} ${remoteHead} && echo "yes" || echo "no"`,
            cwd: projectPath,
          }),
          INVOKE_TIMEOUT_MS,
          'check ancestor'
        );

        const isPushed = mergeBaseResult.trim() === 'yes';

        if (isPushed) {
          toRemove.push(snapshot);
        } else {
          toKeep.push(snapshot);
        }
      } catch {
        // If check fails, keep the snapshot to be safe
        toKeep.push(snapshot);
      }
    }

    if (toRemove.length === 0) {
      console.log('[Snapshot] No pushed snapshots to clean up');
      return 0;
    }

    // Delete git tags for pushed snapshots
    for (const snapshot of toRemove) {
      await deleteTag(projectPath, snapshot.tag);
    }

    // Update metadata
    metadata.snapshots = toKeep;

    // Recalculate currentVersion if it was removed
    if (metadata.currentVersion !== null) {
      const stillExists = toKeep.some(s => s.version === metadata.currentVersion);
      if (!stillExists) {
        metadata.currentVersion = toKeep.length > 0 ? toKeep[toKeep.length - 1].version : null;
      }
    }

    await writeMetadata(projectPath, metadata);

    console.log(`[Snapshot] Cleaned up ${toRemove.length} pushed snapshots (backed up on remote)`);
    return toRemove.length;
  } finally {
    releaseLock();
  }
}

/**
 * Get snapshot by version
 */
export async function getSnapshot(projectPath: string, version: number): Promise<Snapshot | null> {
  const metadata = await readMetadata(projectPath);
  return metadata.snapshots.find(s => s.version === version) || null;
}

/**
 * Check if snapshots are available for this project
 */
export async function hasSnapshots(projectPath: string): Promise<boolean> {
  const snapshots = await listSnapshots(projectPath);
  return snapshots.length > 0;
}
