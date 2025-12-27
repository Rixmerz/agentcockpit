import { useCallback, useRef, useEffect } from 'react';
import { ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput, onPtyClose } from '../services/tauriService';
import type { UnlistenFn } from '@tauri-apps/api/event';

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
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenCloseRef = useRef<UnlistenFn | null>(null);
  const optionsRef = useRef(options);

  // Keep options ref updated
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ptyIdRef.current !== null) {
        ptyClose(ptyIdRef.current).catch(console.error);
      }
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
