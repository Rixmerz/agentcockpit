/**
 * Debug API — window.__debug
 *
 * Exposes internal services, event buses, and state
 * for testing from DevTools console and via the HTTP bridge.
 *
 * DEV-only: mounted in main.tsx when import.meta.env.DEV.
 */

import { invoke } from '@tauri-apps/api/core';
import { debugStateRegistry } from './debugStateRegistry';

// Services
import * as gitService from '../services/gitService';
import { gitWatcherService } from '../services/gitWatcherService';
import * as dccService from '../services/deltacodecubeService';
import * as snapshotService from '../services/snapshotService';
import { pipelineService } from '../services/pipeline';
import * as mcpConfigService from '../services/mcpConfigService';
import * as browserService from '../services/browserService';
import * as hookService from '../services/hookService';
import { backgroundPtyService } from '../services/backgroundPtyService';

// Event buses
import { gitWatcherEvents } from './utils/gitWatcherEventBus';
import { indexEvents } from './utils/indexEventBus';

// Types
import type { AppState, Project } from '../types';

// =====================================================
// Action Router (used by HTTP bridge via _invoke)
// =====================================================

type ActionHandler = (params: Record<string, unknown>) => Promise<unknown>;

const actionHandlers: Record<string, ActionHandler> = {
  // State
  'state.get': async () => {
    const state = debugStateRegistry.get();
    if (!state) return { error: 'State not available yet' };
    return {
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      activeTerminalId: state.activeTerminalId,
      selectedModel: state.selectedModel,
      isLoading: state.isLoading,
    };
  },
  'state.activeProject': async () => debugStateRegistry.getActiveProject(),
  'state.projects': async () => debugStateRegistry.get()?.projects ?? [],

  // Git
  'git.status': async (p) => {
    const path = p.path as string;
    return gitService.getGitStatus(path);
  },
  'git.hasRepo': async (p) => gitService.hasLocalGitRepo(p.path as string),
  'git.syncStatus': async (p) => gitService.getSyncStatus(p.path as string),
  'git.commits': async (p) => gitService.listCommits(p.path as string, (p.limit as number) || 10),
  'git.createCommit': async (p) => gitService.createCommit(p.path as string, p.message as string),

  // Git Watcher
  'gitWatcher.pollNow': async () => { gitWatcherService.pollNow(); return { ok: true }; },
  'gitWatcher.start': async (p) => { gitWatcherService.start(p.path as string); return { ok: true }; },
  'gitWatcher.stop': async () => { gitWatcherService.stop(); return { ok: true }; },

  // DCC (DeltaCodeCube)
  'dcc.indexProject': async (p) => dccService.indexProject(p.path as string),
  'dcc.reindexProject': async (p) => dccService.reindexProject(p.path as string),
  'dcc.incrementalReindex': async (p) =>
    dccService.incrementalReindex(p.path as string, p.changedFiles as string[], p.addedFiles as string[]),
  'dcc.getIndexStats': async (p) => dccService.getIndexStats(p.path as string),
  'dcc.getTensions': async (p) => dccService.getTensions(p.path as string),
  'dcc.getDebt': async (p) => dccService.getDebt(p.path as string),

  // Snapshots
  'snapshot.create': async (p) => snapshotService.createSnapshot(p.path as string),
  'snapshot.list': async (p) => snapshotService.listSnapshots(p.path as string),
  'snapshot.restore': async (p) => snapshotService.restoreSnapshot(p.path as string, p.version as number),
  'snapshot.history': async (p) => snapshotService.getHistory(p.path as string, (p.limit as number) || 20),

  // Pipeline
  'pipeline.getStatus': async (p) => pipelineService.getStatus(p.path as string),
  'pipeline.activate': async (p) => pipelineService.activatePipeline(p.path as string, p.name as string),
  'pipeline.reset': async (p) => pipelineService.resetPipeline(p.path as string),

  // MCP Config
  'mcpConfig.load': async () => mcpConfigService.loadMcpConfig(),
  'mcpConfig.getActive': async () => mcpConfigService.getActiveMcps(),

  // Hooks
  'hooks.isInstalled': async (p) => hookService.isPipelineHooksInstalled(p.path as string),
  'hooks.install': async (p) => hookService.installPipelineHooks(p.path as string),

  // Special: capture events (used by MCP server)
  '_captureEvents': async (p) => {
    const busName = p.bus as string;
    const event = p.event as string;
    const durationMs = (p.durationMs as number) || 5000;
    const bus = busName === 'gitWatcher' ? gitWatcherEvents : indexEvents;
    return captureEvents(bus, event, durationMs);
  },
};

async function invokeAction(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const handler = actionHandlers[action];
  if (!handler) {
    return { error: `Unknown action: ${action}`, available: Object.keys(actionHandlers) };
  }
  try {
    return await handler(params);
  } catch (err) {
    return { error: String(err) };
  }
}

// =====================================================
// captureEvents helper
// =====================================================

type EventBus = typeof gitWatcherEvents | typeof indexEvents;

function captureEvents(
  bus: EventBus,
  event: string,
  durationMs: number = 5000
): Promise<unknown[]> {
  return new Promise((resolve) => {
    const captured: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsub = (bus as any).on(event, (data: unknown) => {
      captured.push({ event, data, capturedAt: Date.now() });
    });
    setTimeout(() => {
      unsub();
      resolve(captured);
    }, durationMs);
  });
}

// =====================================================
// Public API type + factory
// =====================================================

export interface DebugAPI {
  services: {
    git: typeof gitService;
    gitWatcher: typeof gitWatcherService;
    dcc: typeof dccService;
    snapshot: typeof snapshotService;
    pipeline: typeof pipelineService;
    mcpConfig: typeof mcpConfigService;
    browser: typeof browserService;
    hook: typeof hookService;
    bgPty: typeof backgroundPtyService;
  };
  events: {
    gitWatcher: typeof gitWatcherEvents;
    index: typeof indexEvents;
  };
  state: {
    get: () => AppState | null;
    activeProject: () => Project | null;
    projects: () => Project[];
  };
  test: {
    pollGitNow: () => void;
    forceFullIndex: (path: string) => Promise<unknown>;
    forceReindex: (path: string) => Promise<unknown>;
    createSnapshot: (path: string) => Promise<unknown>;
    getGitStatus: (path: string) => Promise<unknown>;
    captureEvents: (bus: EventBus, event: string, durationMs?: number) => Promise<unknown[]>;
  };
  _invoke: (action: string, params?: Record<string, unknown>) => Promise<unknown>;
}

export function createDebugAPI(): DebugAPI {
  return {
    services: {
      git: gitService,
      gitWatcher: gitWatcherService,
      dcc: dccService,
      snapshot: snapshotService,
      pipeline: pipelineService,
      mcpConfig: mcpConfigService,
      browser: browserService,
      hook: hookService,
      bgPty: backgroundPtyService,
    },
    events: {
      gitWatcher: gitWatcherEvents,
      index: indexEvents,
    },
    state: {
      get: () => debugStateRegistry.get(),
      activeProject: () => debugStateRegistry.getActiveProject(),
      projects: () => debugStateRegistry.get()?.projects ?? [],
    },
    test: {
      pollGitNow: () => gitWatcherService.pollNow(),
      forceFullIndex: (path: string) => dccService.indexProject(path),
      forceReindex: (path: string) => dccService.reindexProject(path),
      createSnapshot: (path: string) => snapshotService.createSnapshot(path),
      getGitStatus: (path: string) => gitService.getGitStatus(path),
      captureEvents,
    },
    _invoke: invokeAction,
  };
}
