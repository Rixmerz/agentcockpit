import { useState, useEffect, useCallback, useRef } from 'react';
import {
  isDeltaCodeCubeInstalled,
  getIndexStats,
  reindexProject,
  type IndexStats,
} from '../services/deltacodecubeService';
import { useIndexEvent } from '../core/utils/indexEventBus';

export interface UseDccStatusResult {
  dccInstalled: boolean;
  indexStats: IndexStats | null;
  indexLoading: boolean;
  indexError: string | null;
  loadIndexInfo: () => Promise<void>;
  handleReindex: () => Promise<void>;
}

export function useDccStatus(projectPath: string | null): UseDccStatusResult {
  const [dccInstalled, setDccInstalled] = useState(false);
  const [indexStats, setIndexStats] = useState<IndexStats | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const indexCacheRef = useRef<Map<string, IndexStats>>(new Map());

  // Check DCC install only (lazy — stats loaded on-demand via dropdown)
  useEffect(() => {
    if (!projectPath) {
      setDccInstalled(false);
      setIndexStats(null);
      setIndexError(null);
      return;
    }
    setIndexError(null);
    const delay = setTimeout(() => {
      isDeltaCodeCubeInstalled().then(setDccInstalled).catch(() => setDccInstalled(false));
    }, 3000);
    return () => clearTimeout(delay);
  }, [projectPath]);

  // Listen for index events — update stats when indexing completes
  useIndexEvent('indexed', (data) => {
    if (data.projectPath === projectPath && dccInstalled) {
      getIndexStats(projectPath).then(stats => {
        if (stats) {
          setIndexStats(stats);
          indexCacheRef.current.set(projectPath, stats);
        }
      }).catch(() => {});
    }
  }, [projectPath, dccInstalled]);

  // Load index info on-demand (when dropdown opens)
  const loadIndexInfo = useCallback(async () => {
    if (!projectPath) return;
    try {
      const installed = await isDeltaCodeCubeInstalled();
      setDccInstalled(installed);
      if (installed) {
        const stats = await getIndexStats(projectPath);
        if (stats) {
          setIndexStats(stats);
          indexCacheRef.current.set(projectPath, stats);
        }
      }
    } catch (err) {
      console.warn('[useDccStatus] Failed to load index info:', err);
    }
  }, [projectPath]);

  // Handle reindex (explicit user action — starts DCC server if needed)
  const handleReindex = useCallback(async () => {
    if (!projectPath) return;
    setIndexLoading(true);
    setIndexError(null);
    try {
      const stats = await reindexProject(projectPath);
      if (stats) {
        setIndexStats(stats);
        indexCacheRef.current.set(projectPath, stats);
      } else {
        setIndexError('Indexing returned no results');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useDccStatus] Reindex failed:', msg);
      setIndexError(msg);
    } finally {
      setIndexLoading(false);
    }
  }, [projectPath]);

  return {
    dccInstalled,
    indexStats,
    indexLoading,
    indexError,
    loadIndexInfo,
    handleReindex,
  };
}
