import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// PTY Management

export async function ptySpawn(
  cmd: string,
  cwd: string,
  cols: number,
  rows: number
): Promise<number> {
  return invoke<number>('pty_spawn', { cmd, cwd, cols, rows });
}

export async function ptyWrite(id: number, data: string): Promise<void> {
  return invoke('pty_write', { id, data });
}

export async function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  return invoke('pty_resize', { id, cols, rows });
}

export async function ptyClose(id: number): Promise<void> {
  return invoke('pty_close', { id });
}

// PTY Events

export async function onPtyOutput(
  ptyId: number,
  callback: (data: string) => void
): Promise<UnlistenFn> {
  return listen<string>(`pty-output-${ptyId}`, (event) => {
    callback(event.payload);
  });
}

export async function onPtyClose(
  ptyId: number,
  callback: () => void
): Promise<UnlistenFn> {
  return listen(`pty-close-${ptyId}`, () => {
    callback();
  });
}
