/**
 * File Watcher Service (Singleton)
 *
 * Bridges Tauri native file change events (dcc:files-changed) to DCC
 * incremental reindexing. Debounces rapid file edits and accumulates
 * changed files across the debounce window before triggering reindex.
 *
 * Lifecycle: start(projectPath) → [events] → stop()
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { indexEvents } from '../core/utils/indexEventBus';
import { isDeltaCodeCubeInstalled } from './deltacodecubeService';
import { isIndexing, incrementalReindex } from './dcc/dccIndexService';

// =====================================================
// Constants
// =====================================================

const DEBOUNCE_MS = 2000;

const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java',
  'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'swift',
  'kt', 'scala', 'vue', 'svelte', 'lua',
]);

// =====================================================
// Module-level singleton state
// =====================================================

let _unlisten: UnlistenFn | null = null;
let _projectPath: string | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
const _pendingFiles: Set<string> = new Set();

// =====================================================
// Internal: Reindex trigger
// =====================================================

async function _triggerReindex(projectPath: string, files: string[]): Promise<void> {
  const installed = await isDeltaCodeCubeInstalled();
  if (!installed) return;

  if (isIndexing()) return;

  // Separate absolute paths into relative changed files for incrementalReindex.
  // The native watcher emits absolute paths; incrementalReindex expects relative paths.
  const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
  const relativeFiles = files
    .filter(f => f.startsWith(prefix))
    .map(f => f.slice(prefix.length));

  if (relativeFiles.length === 0) return;

  await incrementalReindex(projectPath, relativeFiles, []);
}

// =====================================================
// Internal: Event handler
// =====================================================

function _handleFileChange(payload: { projectPath: string; files: string[]; timestamp: number }): void {
  if (payload.projectPath !== _projectPath) return;

  const filtered = payload.files.filter(f => {
    const ext = f.split('.').pop()?.toLowerCase() ?? '';
    return SOURCE_EXTENSIONS.has(ext);
  });

  if (filtered.length === 0) return;

  for (const f of filtered) {
    _pendingFiles.add(f);
  }

  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;

    const files = [..._pendingFiles];
    _pendingFiles.clear();

    if (files.length === 0) return;

    const projectPath = _projectPath;
    if (!projectPath) return;

    indexEvents.emit('file_change', {
      projectPath,
      files,
      timestamp: Date.now(),
    });

    _triggerReindex(projectPath, files).catch(() => {
      // Silent fail — DCC may not be running
    });
  }, DEBOUNCE_MS);
}

// =====================================================
// Public API
// =====================================================

async function start(projectPath: string): Promise<void> {
  if (_projectPath === projectPath && _unlisten !== null) return;

  if (_unlisten !== null) {
    await stop();
  }

  await invoke('file_watcher_start', { projectPath });

  _unlisten = await listen<{ projectPath: string; files: string[]; timestamp: number }>(
    'dcc:files-changed',
    (event) => {
      _handleFileChange(event.payload);
    },
  );

  _projectPath = projectPath;
}

async function stop(): Promise<void> {
  if (_unlisten !== null) {
    _unlisten();
    _unlisten = null;
  }

  try {
    await invoke('file_watcher_stop');
  } catch {
    // Best-effort stop — ignore errors if watcher was not active
  }

  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  _pendingFiles.clear();
  _projectPath = null;
}

async function isActive(): Promise<boolean> {
  try {
    const result = await invoke<{ active: boolean }>('file_watcher_status');
    return result.active;
  } catch {
    return false;
  }
}

export const fileWatcherService = {
  start,
  stop,
  isActive,
};
