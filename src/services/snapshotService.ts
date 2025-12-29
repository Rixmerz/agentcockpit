/**
 * Snapshot Service
 *
 * Manages automatic git snapshots before agent interactions.
 * Creates V1, V2, V3... versioned commits with git tags.
 */

import { invoke } from '@tauri-apps/api/core';
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

// Metadata file operations
async function ensureMetadataDir(projectPath: string): Promise<void> {
  const dirPath = `${projectPath}/${METADATA_DIR}`;
  try {
    await invoke<string>('execute_command', {
      cmd: `mkdir -p "${dirPath}"`,
      cwd: projectPath,
    });
  } catch {
    // Directory might already exist
  }
}

async function readMetadata(projectPath: string): Promise<SnapshotMetadata> {
  const filePath = `${projectPath}/${METADATA_DIR}/${METADATA_FILE}`;

  try {
    const content = await invoke<string>('execute_command', {
      cmd: `cat "${filePath}"`,
      cwd: projectPath,
    });

    return JSON.parse(content) as SnapshotMetadata;
  } catch {
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

  // Base64 encode to handle special characters
  const base64 = btoa(unescape(encodeURIComponent(content)));

  await invoke<string>('execute_command', {
    cmd: `echo "${base64}" | base64 -d > "${filePath}"`,
    cwd: projectPath,
  });
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

    // Skip if no uncommitted changes
    if (!status.hasUncommittedChanges) {
      console.log('[Snapshot] Skipping - no uncommitted changes');
      return null;
    }

    // Read current metadata
    const metadata = await readMetadata(projectPath);
    const version = metadata.nextVersion;
    const tag = `${SNAPSHOT_TAG_PREFIX}${version}`;

    // Create commit message
    const message = `Snapshot V${version}`;

    // Create commit (stages all changes automatically)
    const commitHash = await createCommit(projectPath, message);

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
    const logOutput = await invoke<string>('execute_command', {
      cmd: `git log -1 --format="%at|%s" ${commitHash}`,
      cwd: projectPath,
    });

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
  } catch {
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
