/**
 * Snapshot Selector
 *
 * Dropdown/button group for selecting and restoring snapshots.
 * Displays in TerminalHeader, shows V1, V2, V3...
 */

import { useState, useEffect, useCallback } from 'react';
import { Clock, ChevronDown, AlertCircle, Check, RotateCcw } from 'lucide-react';
import { listSnapshots, restoreSnapshot, getCurrentVersion, type Snapshot } from '../../services/snapshotService';
import { useSnapshotEvent, snapshotEvents } from '../../core/utils/eventBus';
import { useApp } from '../../contexts/AppContext';

interface SnapshotSelectorProps {
  projectPath: string;
}

// Format relative time (e.g., "2m ago", "1h ago")
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'now';
}

export function SnapshotSelector({ projectPath }: SnapshotSelectorProps) {
  const { writeToActiveTerminal } = useApp();

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<number | null>(null);

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
      console.error('[SnapshotSelector] Load error:', err);
      setError('Error loading snapshots');
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

  // Handle restore click
  const handleRestoreClick = useCallback((version: number) => {
    // If clicking current version, do nothing
    if (version === currentVersion) {
      setIsOpen(false);
      return;
    }

    // Ask for confirmation
    setConfirmRestore(version);
  }, [currentVersion]);

  // Confirm restore
  const handleConfirmRestore = useCallback(async () => {
    if (confirmRestore === null) return;

    setIsRestoring(true);
    setError(null);

    try {
      // Force restore (skip uncommitted changes check for now)
      await restoreSnapshot(projectPath, confirmRestore, true);

      // Notify agent via terminal
      const message = `version V${confirmRestore}\n`;
      await writeToActiveTerminal(message);

      // Emit restored event
      snapshotEvents.emit('restored', {
        version: confirmRestore,
        projectPath,
      });

      setCurrentVersion(confirmRestore);
      setConfirmRestore(null);
      setIsOpen(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (errorMsg === 'UNCOMMITTED_CHANGES') {
        setError('Uncommitted changes detected. Changes will be lost.');
        // Still proceed with force restore
        try {
          await restoreSnapshot(projectPath, confirmRestore, true);
          await writeToActiveTerminal(`version V${confirmRestore}\n`);
          snapshotEvents.emit('restored', {
            version: confirmRestore,
            projectPath,
          });
          setCurrentVersion(confirmRestore);
          setConfirmRestore(null);
          setIsOpen(false);
        } catch (innerErr) {
          setError(`Restore failed: ${innerErr}`);
        }
      } else {
        setError(`Restore failed: ${errorMsg}`);
      }
    } finally {
      setIsRestoring(false);
    }
  }, [confirmRestore, projectPath, writeToActiveTerminal]);

  // Cancel restore
  const handleCancelRestore = useCallback(() => {
    setConfirmRestore(null);
    setError(null);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.snapshot-selector')) {
        setIsOpen(false);
        setConfirmRestore(null);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  // Always show - even with 0 snapshots to indicate the feature exists
  return (
    <div className="snapshot-selector">
      {/* Trigger button */}
      <button
        className="snapshot-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading || isRestoring}
        title="Version snapshots"
      >
        <Clock size={12} />
        <span className="snapshot-current">
          {isLoading ? '...' : currentVersion ? `V${currentVersion}` : 'V0'}
        </span>
        <ChevronDown size={10} className={`snapshot-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="snapshot-dropdown">
          {/* Error message */}
          {error && (
            <div className="snapshot-error">
              <AlertCircle size={12} />
              <span>{error}</span>
            </div>
          )}

          {/* Confirmation dialog */}
          {confirmRestore !== null && (
            <div className="snapshot-confirm">
              <p>Restore to V{confirmRestore}?</p>
              <p className="snapshot-confirm-warning">Current changes will be lost.</p>
              <div className="snapshot-confirm-actions">
                <button
                  className="btn-secondary btn-sm"
                  onClick={handleCancelRestore}
                  disabled={isRestoring}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary btn-sm"
                  onClick={handleConfirmRestore}
                  disabled={isRestoring}
                >
                  {isRestoring ? 'Restoring...' : 'Restore'}
                </button>
              </div>
            </div>
          )}

          {/* Snapshot list */}
          {confirmRestore === null && (
            <div className="snapshot-list">
              {snapshots.length === 0 ? (
                <div className="snapshot-empty">No snapshots yet</div>
              ) : (
                snapshots.slice().reverse().map(snapshot => (
                  <button
                    key={snapshot.version}
                    className={`snapshot-item ${snapshot.version === currentVersion ? 'current' : ''}`}
                    onClick={() => handleRestoreClick(snapshot.version)}
                    disabled={isRestoring}
                  >
                    <span className="snapshot-version">V{snapshot.version}</span>
                    <span className="snapshot-time">{formatRelativeTime(snapshot.timestamp)}</span>
                    {snapshot.version === currentVersion ? (
                      <Check size={12} className="snapshot-check" />
                    ) : (
                      <RotateCcw size={12} className="snapshot-restore-icon" />
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
