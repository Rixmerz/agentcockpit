import { invoke } from "@tauri-apps/api/core";

/**
 * Service for IPC communication between frontend (React) and backend (Rust/Tauri)
 * All Tauri command invocations go through here for centralized control
 */

export interface IpcRequest<T = unknown> {
  command: string;
  payload?: T;
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Execute a Tauri command with typed payload and response
 * @param command - The Tauri command name to invoke
 * @param payload - Optional payload to send to backend
 * @returns Promise with response data
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
 * Greet command example - calls Rust backend
 */
export async function greet(name: string): Promise<string> {
  return invokeCommand("greet", { name });
}

/**
 * Execute shell command in backend
 * Will be implemented in Rust backend
 */
export async function executeCommand(command: string): Promise<string> {
  return invokeCommand("execute_command", { command });
}
