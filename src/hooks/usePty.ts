import { useCallback, useRef, useEffect } from 'react';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyClose } from '../services/tauriService';
import type { UnlistenFn } from '@tauri-apps/api/event';
// Re-enabled: Snapshots now use execute_command (bypasses Tauri FS permissions)
import { createSnapshot, cleanupPushedSnapshots } from '../services/snapshotService';
import { snapshotEvents } from '../core/utils/eventBus';

interface UsePtyOptions {
  onData?: (data: string) => void;
  onClose?: () => void;
}

interface UsePtyReturn {
  ptyId: number | null;
  spawn: (cmd: string, cwd: string, cols: number, rows: number) => Promise<number>;
  write: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  isActive: boolean;
}

// Commands that should NOT trigger snapshots (MCP management, internal commands)
const SNAPSHOT_SKIP_COMMANDS = ['claude mcp', '/mcp', 'claude --session'];

export function usePty(options: UsePtyOptions = {}): UsePtyReturn {
  const ptyIdRef = useRef<number | null>(null);
  const projectPathRef = useRef<string | null>(null);
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenCloseRef = useRef<UnlistenFn | null>(null);
  const optionsRef = useRef(options);
  // Re-enabled: Snapshots now use Tauri FS APIs (no TCC permission cascade)
  const isCreatingSnapshotRef = useRef(false);
  // Buffer to track recent input for snapshot skip detection
  const inputBufferRef = useRef<string>('');

  // Keep options ref updated
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Cleanup on unmount - only cleanup listeners, NOT the PTY
  // PTY is closed explicitly when terminal is removed from project
  useEffect(() => {
    return () => {
      // Do NOT close PTY here - it should persist across tab switches
      // Only cleanup event listeners
      unlistenOutputRef.current?.();
      unlistenCloseRef.current?.();
    };
  }, []);

  const spawn = useCallback(async (cmd: string, cwd: string, cols: number, rows: number): Promise<number> => {
    // Close existing PTY if any
    if (ptyIdRef.current !== null) {
      await ptyClose(ptyIdRef.current).catch(console.error);
      unlistenOutputRef.current?.();
      unlistenCloseRef.current?.();
    }

    // Store project path for snapshot creation
    projectPathRef.current = cwd;

    // Spawn new PTY
    const id = await ptySpawn(cmd, cwd, cols, rows);
    ptyIdRef.current = id;

    // Setup event listeners
    unlistenOutputRef.current = await onPtyOutput(id, (data) => {
      optionsRef.current.onData?.(data);
    });

    unlistenCloseRef.current = await onPtyClose(id, () => {
      ptyIdRef.current = null;
      optionsRef.current.onClose?.();
    });

    return id;
  }, []);

  const write = useCallback(async (data: string): Promise<void> => {
    if (ptyIdRef.current === null) {
      throw new Error('PTY not spawned');
    }

    // CRITICAL: Send input to terminal IMMEDIATELY - never block on snapshot
    await ptyWrite(ptyIdRef.current, data);

    // Accumulate input buffer for command detection
    // Handle backspace by removing last character
    if (data === '\x7f' || data === '\b') {
      inputBufferRef.current = inputBufferRef.current.slice(0, -1);
    } else {
      inputBufferRef.current += data;
    }
    // Keep buffer limited to last 200 chars
    if (inputBufferRef.current.length > 200) {
      inputBufferRef.current = inputBufferRef.current.slice(-200);
    }

    // Snapshot creation on Enter (using Tauri FS APIs - no TCC permission cascade)
    const isEnterPressed = data.includes('\r') || data.includes('\n');
    const projectPath = projectPathRef.current;

    if (isEnterPressed && projectPath && !isCreatingSnapshotRef.current) {
      // Check if current command should skip snapshot
      const currentBuffer = inputBufferRef.current.toLowerCase();
      const shouldSkipSnapshot = SNAPSHOT_SKIP_COMMANDS.some(cmd => currentBuffer.includes(cmd.toLowerCase()));

      // Clear buffer after Enter
      inputBufferRef.current = '';

      if (shouldSkipSnapshot) {
        console.log('[usePty] Skipping snapshot for MCP/session command');
        return;
      }

      isCreatingSnapshotRef.current = true;

      createSnapshot(projectPath)
        .then(snapshot => {
          if (snapshot) {
            snapshotEvents.emit('created', {
              version: snapshot.version,
              projectPath,
              commitHash: snapshot.commitHash,
              timestamp: snapshot.timestamp,
            });
            console.log('[usePty] Snapshot V' + snapshot.version + ' created');

            // Fire-and-forget: Clean up snapshots that have been pushed to remote
            cleanupPushedSnapshots(projectPath)
              .then(cleaned => {
                if (cleaned > 0) {
                  console.log(`[usePty] Cleaned ${cleaned} pushed snapshots`);
                }
              })
              .catch(() => {}); // Ignore cleanup errors
          }
        })
        .catch(err => {
          console.error('[usePty] Snapshot failed:', err);
        })
        .finally(() => {
          isCreatingSnapshotRef.current = false;
        });
    }
  }, []);

  const resize = useCallback(async (cols: number, rows: number): Promise<void> => {
    if (ptyIdRef.current === null) {
      return; // Silently ignore if no PTY
    }
    await ptyResize(ptyIdRef.current, cols, rows);
  }, []);

  const close = useCallback(async (): Promise<void> => {
    if (ptyIdRef.current === null) {
      return;
    }
    await ptyClose(ptyIdRef.current);
    ptyIdRef.current = null;
    unlistenOutputRef.current?.();
    unlistenCloseRef.current?.();
  }, []);

  return {
    ptyId: ptyIdRef.current,
    spawn,
    write,
    resize,
    close,
    isActive: ptyIdRef.current !== null,
  };
}
