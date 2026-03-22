import { useState, useEffect, useCallback } from 'react';
import {
  getHistory,
  restoreSnapshot,
  getCurrentVersion,
  type HistoryItem,
} from '../services/snapshotService';
import { useSnapshotEvent, snapshotEvents } from '../core/utils/eventBus';

export interface UseSnapshotStatusResult {
  historyItems: HistoryItem[];
  currentVersion: number | null;
  snapshotLoading: boolean;
  isRestoring: number | null;
  loadSnapshots: () => Promise<void>;
  handleRestoreSnapshot: (item: HistoryItem) => Promise<void>;
}

export function useSnapshotStatus(projectPath: string | null): UseSnapshotStatusResult {
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState<number | null>(null);

  const loadSnapshots = useCallback(async () => {
    if (!projectPath) {
      setHistoryItems([]);
      setCurrentVersion(null);
      return;
    }

    setSnapshotLoading(true);
    try {
      const [history, current] = await Promise.all([
        getHistory(projectPath, 20),
        getCurrentVersion(projectPath),
      ]);
      setHistoryItems(history.filter(i => i.type === 'snapshot'));
      setCurrentVersion(current);
    } catch (err) {
      console.warn('[useSnapshotStatus] Failed to load snapshots:', err);
    } finally {
      setSnapshotLoading(false);
    }
  }, [projectPath]);

  // Load snapshots on mount / project change
  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleRestoreSnapshot = useCallback(async (item: HistoryItem) => {
    if (!projectPath || item.type !== 'snapshot' || !item.version) return;
    if (item.version === currentVersion) return;

    setIsRestoring(item.version);
    try {
      await restoreSnapshot(projectPath, item.version, true);
      snapshotEvents.emit('restored', {
        version: item.version,
        projectPath,
      });
      setCurrentVersion(item.version);
    } catch (err) {
      console.error('[useSnapshotStatus] Failed to restore snapshot:', err);
    } finally {
      setIsRestoring(null);
    }
  }, [projectPath, currentVersion]);

  // Listen for snapshot events
  useSnapshotEvent('created', (data) => {
    if (data.projectPath === projectPath) {
      setTimeout(() => loadSnapshots(), 500);
    }
  }, [projectPath, loadSnapshots]);

  useSnapshotEvent('restored', (data) => {
    if (data.projectPath === projectPath) {
      setCurrentVersion(data.version);
      loadSnapshots();
    }
  }, [projectPath, loadSnapshots]);

  useSnapshotEvent('cleanup', (data) => {
    if (data.projectPath === projectPath) {
      loadSnapshots();
    }
  }, [projectPath, loadSnapshots]);

  return {
    historyItems,
    currentVersion,
    snapshotLoading,
    isRestoring,
    loadSnapshots,
    handleRestoreSnapshot,
  };
}
