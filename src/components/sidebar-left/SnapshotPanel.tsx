/**
 * Snapshot Panel
 *
 * Shows snapshot versions (V1, V2, V3...) in the left sidebar.
 * Allows restoring to previous versions.
 */

import { useState, useEffect, useCallback } from 'react';
import { History, RotateCcw, Check, Loader2, AlertCircle } from 'lucide-react';
import { listSnapshots, restoreSnapshot, getCurrentVersion, type Snapshot } from '../../services/snapshotService';
import { useSnapshotEvent, snapshotEvents } from '../../core/utils/eventBus';

interface SnapshotPanelProps {
  projectPath: string;
  onRestore?: (version: number) => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'ahora';
}

export function SnapshotPanel({ projectPath, onRestore }: SnapshotPanelProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load snapshots
  const loadSnapshots = useCallback(async () => {
    if (!projectPath) return;

    setIsLoading(true);
    setError(null);

    try {
      const [snapshotList, current] = await Promise.all([
        listSnapshots(projectPath),
        getCurrentVersion(projectPath),
      ]);

      setSnapshots(snapshotList);
      setCurrentVersion(current);
    } catch (err) {
      console.error('[SnapshotPanel] Load error:', err);
      setError('Error cargando snapshots');
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  // Initial load
  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // Listen for new snapshots
  useSnapshotEvent('created', (data) => {
    if (data.projectPath === projectPath) {
      loadSnapshots();
    }
  }, [projectPath, loadSnapshots]);

  // Listen for restored snapshots
  useSnapshotEvent('restored', (data) => {
    if (data.projectPath === projectPath) {
      setCurrentVersion(data.version);
      loadSnapshots();
    }
  }, [projectPath, loadSnapshots]);

  // Handle restore
  const handleRestore = useCallback(async (version: number) => {
    if (version === currentVersion) return;

    setIsRestoring(version);
    setError(null);

    try {
      await restoreSnapshot(projectPath, version, true);

      snapshotEvents.emit('restored', {
        version,
        projectPath,
      });

      setCurrentVersion(version);
      onRestore?.(version);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Error: ${errorMsg}`);
    } finally {
      setIsRestoring(null);
    }
  }, [projectPath, currentVersion, onRestore]);

  // Don't show if loading or no snapshots
  if (isLoading) {
    return (
      <div className="snapshot-panel">
        <div className="snapshot-panel-header">
          <History size={12} />
          <span>Versiones</span>
        </div>
        <div className="snapshot-panel-loading">
          <Loader2 size={14} className="animate-spin" />
        </div>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="snapshot-panel">
        <div className="snapshot-panel-header">
          <History size={12} />
          <span>Versiones</span>
        </div>
        <div className="snapshot-panel-empty">
          Sin versiones guardadas
        </div>
      </div>
    );
  }

  return (
    <div className="snapshot-panel">
      <div className="snapshot-panel-header">
        <History size={12} />
        <span>Versiones ({snapshots.length})</span>
      </div>

      {error && (
        <div className="snapshot-panel-error">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}

      <div className="snapshot-panel-list">
        {snapshots.slice().reverse().map(snapshot => (
          <button
            key={snapshot.version}
            className={`snapshot-panel-item ${snapshot.version === currentVersion ? 'current' : ''}`}
            onClick={() => handleRestore(snapshot.version)}
            disabled={isRestoring !== null || snapshot.version === currentVersion}
            title={`${snapshot.filesChanged.length} archivos cambiados`}
          >
            <span className="snapshot-version">V{snapshot.version}</span>
            <span className="snapshot-time">{formatRelativeTime(snapshot.timestamp)}</span>
            {isRestoring === snapshot.version ? (
              <Loader2 size={12} className="animate-spin" />
            ) : snapshot.version === currentVersion ? (
              <Check size={12} className="snapshot-current-icon" />
            ) : (
              <RotateCcw size={12} className="snapshot-restore-icon" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
