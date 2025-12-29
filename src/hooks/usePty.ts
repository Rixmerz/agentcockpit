import { useCallback, useRef, useEffect } from 'react';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyClose } from '../services/tauriService';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { createSnapshot } from '../services/snapshotService';
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

export function usePty(options: UsePtyOptions = {}): UsePtyReturn {
  const ptyIdRef = useRef<number | null>(null);
  const projectPathRef = useRef<string | null>(null);
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenCloseRef = useRef<UnlistenFn | null>(null);
  const optionsRef = useRef(options);
  const isCreatingSnapshotRef = useRef(false);

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

    // Detect Enter key (\r or \n) and create snapshot before sending
    // Only create snapshot if projectPath is available and not already creating one
    const isEnterPressed = data.includes('\r') || data.includes('\n');
    const projectPath = projectPathRef.current;

    if (isEnterPressed && projectPath && !isCreatingSnapshotRef.current) {
      isCreatingSnapshotRef.current = true;

      try {
        const snapshot = await createSnapshot(projectPath);

        if (snapshot) {
          // Emit event for UI components to update
          snapshotEvents.emit('created', {
            version: snapshot.version,
            projectPath,
            commitHash: snapshot.commitHash,
            timestamp: snapshot.timestamp,
          });
        }
      } catch (err) {
        // Log error but don't block the write operation
        console.error('[usePty] Snapshot creation failed:', err);
      } finally {
        isCreatingSnapshotRef.current = false;
      }
    }

    await ptyWrite(ptyIdRef.current, data);
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
