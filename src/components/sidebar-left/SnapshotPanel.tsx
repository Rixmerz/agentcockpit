/**
 * History Panel (formerly Snapshot Panel)
 *
 * Shows version history including:
 * - Snapshots (V1, V2, V3...) - automatic saves before agent interactions
 * - Manual commits - user commits made outside of snapshots
 *
 * Allows restoring to previous snapshot versions.
 */

import { useState, useEffect, useCallback } from 'react';
import { History, RotateCcw, Check, Loader2, AlertCircle, GitCommit, Camera } from 'lucide-react';
import { getHistory, restoreSnapshot, getCurrentVersion, type HistoryItem } from '../../services/snapshotService';
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

// Truncate commit message to fit in the panel
function truncateMessage(message: string, maxLength: number = 25): string {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength - 3) + '...';
}

export function SnapshotPanel({ projectPath, onRestore }: SnapshotPanelProps) {
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load history
  const loadHistory = useCallback(async () => {
    if (!projectPath) return;

    setIsLoading(true);
    setError(null);

    try {
      const [history, current] = await Promise.all([
        getHistory(projectPath, 50),
        getCurrentVersion(projectPath),
      ]);

      setHistoryItems(history);
      setCurrentVersion(current);
    } catch (err) {
      console.error('[SnapshotPanel] Load error:', err);
      setError('Error cargando historial');
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

  // Initial load
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Listen for new snapshots - delay to ensure metadata is written
  useSnapshotEvent('created', (data) => {
    if (data.projectPath === projectPath) {
      // Small delay to ensure metadata file is fully written before reading
      setTimeout(() => loadHistory(), 500);
    }
  }, [projectPath, loadHistory]);

  // Listen for restored snapshots
  useSnapshotEvent('restored', (data) => {
    if (data.projectPath === projectPath) {
      setCurrentVersion(data.version);
      loadHistory();
    }
  }, [projectPath, loadHistory]);

  // Listen for cleanup events (when pushed snapshots are removed)
  useSnapshotEvent('cleanup', (data) => {
    if (data.projectPath === projectPath) {
      loadHistory();
    }
  }, [projectPath, loadHistory]);

  // Handle restore (only for snapshots)
  const handleRestore = useCallback(async (item: HistoryItem) => {
    if (item.type !== 'snapshot' || !item.version) return;
    if (item.version === currentVersion) return;

    setIsRestoring(item.version);
    setError(null);

    try {
      await restoreSnapshot(projectPath, item.version, true);

      snapshotEvents.emit('restored', {
        version: item.version,
        projectPath,
      });

      setCurrentVersion(item.version);
      onRestore?.(item.version);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Error: ${errorMsg}`);
    } finally {
      setIsRestoring(null);
    }
  }, [projectPath, currentVersion, onRestore]);

  // Count snapshots vs commits
  const snapshotCount = historyItems.filter(i => i.type === 'snapshot').length;
  const commitCount = historyItems.filter(i => i.type === 'commit').length;

  // Don't show if loading
  if (isLoading) {
    return (
      <div className="snapshot-panel">
        <div className="snapshot-panel-header">
          <History size={12} />
          <span>Historial</span>
        </div>
        <div className="snapshot-panel-loading">
          <Loader2 size={14} className="animate-spin" />
        </div>
      </div>
    );
  }

  if (historyItems.length === 0) {
    return (
      <div className="snapshot-panel">
        <div className="snapshot-panel-header">
          <History size={12} />
          <span>Historial</span>
        </div>
        <div className="snapshot-panel-empty">
          Sin historial
        </div>
      </div>
    );
  }

  return (
    <div className="snapshot-panel">
      <div className="snapshot-panel-header">
        <History size={12} />
        <span>Historial</span>
        <span className="snapshot-panel-counts">
          {snapshotCount > 0 && <span className="count-snapshots" title="Snapshots">{snapshotCount}</span>}
          {commitCount > 0 && <span className="count-commits" title="Commits">{commitCount}</span>}
        </span>
      </div>

      {error && (
        <div className="snapshot-panel-error">
          <AlertCircle size={12} />
          <span>{error}</span>
        </div>
      )}

      <div className="snapshot-panel-list">
        {historyItems.map((item) => {
          const isSnapshot = item.type === 'snapshot';
          const isCurrent = isSnapshot && item.version === currentVersion;
          const canRestore = isSnapshot && !isCurrent;

          return (
            <button
              key={item.commitHash}
              className={`snapshot-panel-item ${item.type} ${isCurrent ? 'current' : ''}`}
              onClick={() => canRestore && handleRestore(item)}
              disabled={isRestoring !== null || !canRestore}
              title={isSnapshot
                ? `V${item.version}: ${item.filesChanged?.length || 0} archivos cambiados`
                : `${item.shortHash}: ${item.message}`
              }
            >
              {/* Type indicator */}
              <span className="history-type-icon">
                {isSnapshot ? (
                  <Camera size={10} />
                ) : (
                  <GitCommit size={10} />
                )}
              </span>

              {/* Version/Hash */}
              <span className="history-label">
                {isSnapshot ? `V${item.version}` : item.shortHash}
              </span>

              {/* Message (for commits) or time */}
              {isSnapshot ? (
                <span className="snapshot-time">{formatRelativeTime(item.timestamp)}</span>
              ) : (
                <span className="commit-message" title={item.message}>
                  {truncateMessage(item.message)}
                </span>
              )}

              {/* Action icon */}
              {isSnapshot && (
                <>
                  {isRestoring === item.version ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : isCurrent ? (
                    <Check size={12} className="snapshot-current-icon" />
                  ) : (
                    <RotateCcw size={12} className="snapshot-restore-icon" />
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
