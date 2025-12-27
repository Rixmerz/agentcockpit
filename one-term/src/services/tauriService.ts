import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/**
 * Service for IPC communication between frontend (React) and backend (Rust/Tauri)
 * All Tauri command invocations go through here for centralized control
 */

/**
 * Execute a Tauri command with typed payload and response
 */
export async function invokeCommand<T, R = unknown>(
  command: string,
  payload?: T
): Promise<R> {
  try {
    const response = await invoke<R>(command, payload || {});
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`IPC Error [${command}]: ${errorMessage}`);
  }
}

/**
 * Execute shell command in backend (simple, non-interactive)
 */
export async function executeCommand(command: string, cwd?: string): Promise<string> {
  return invokeCommand("execute_command", { command, cwd });
}

// ============ PTY Functions ============

/**
 * Spawn a new PTY session
 */
export async function ptySpawn(cols: number, rows: number): Promise<void> {
  return invokeCommand("pty_spawn", { cols, rows });
}

/**
 * Write data to PTY (user input)
 */
export async function ptyWrite(data: string): Promise<void> {
  // Convert string to byte array
  const encoder = new TextEncoder();
  const bytes = Array.from(encoder.encode(data));
  return invokeCommand("pty_write", { data: bytes });
}

/**
 * Resize PTY
 */
export async function ptyResize(cols: number, rows: number): Promise<void> {
  return invokeCommand("pty_resize", { cols, rows });
}

/**
 * Check if PTY is active
 */
export async function ptyIsActive(): Promise<boolean> {
  return invokeCommand("pty_is_active", {});
}

/**
 * Close PTY session
 */
export async function ptyClose(): Promise<void> {
  return invokeCommand("pty_close", {});
}

/**
 * Listen for PTY output events
 */
export async function onPtyOutput(
  callback: (data: Uint8Array) => void
): Promise<UnlistenFn> {
  return listen<number[]>("pty-output", (event) => {
    callback(new Uint8Array(event.payload));
  });
}
