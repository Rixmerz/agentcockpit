/**
 * Ports Service
 *
 * Detects active processes listening on common dev ports.
 * Wraps direct `invoke('execute_command')` calls so components
 * never touch Tauri directly.
 */

import { invoke } from '@tauri-apps/api/core';

export interface PortInfo {
  port: number;
  process: string;
  pid?: number;
}

// Common dev ports to check
export const PORTS_TO_CHECK = [
  1420, 3000, 3001, 3002, 3003, 4000, 4173, 5000, 5173, 5174,
  8000, 8080, 8888, 5432, 6379, 27017,
];

/**
 * Check a single port. Returns PortInfo if something is listening, null otherwise.
 */
async function checkPort(port: number): Promise<PortInfo | null> {
  try {
    const result = await invoke<string>('execute_command', {
      cmd: `lsof -ti:${port} 2>/dev/null`,
      cwd: '/',
    });

    if (result.trim()) {
      const pid = parseInt(result.trim().split('\n')[0], 10);
      let processName = 'Unknown';
      try {
        const processResult = await invoke<string>('execute_command', {
          cmd: `ps -p ${pid} -o comm= 2>/dev/null`,
          cwd: '/',
        });
        processName = processResult.trim() || 'Unknown';
      } catch {
        // Ignore — processName stays 'Unknown'
      }
      return { port, process: processName, pid };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Scan all ports in PORTS_TO_CHECK and return those with active listeners.
 */
export async function getActivePorts(): Promise<PortInfo[]> {
  const results = await Promise.all(PORTS_TO_CHECK.map(checkPort));
  const active = results.filter((info): info is PortInfo => info !== null);
  active.sort((a, b) => a.port - b.port);
  return active;
}

/**
 * Kill the process listening on `port`.
 * Does not throw — errors are logged and silently ignored.
 */
export async function killPort(port: number): Promise<void> {
  try {
    const result = await invoke<string>('execute_command', {
      cmd: `lsof -ti:${port} 2>/dev/null`,
      cwd: '/',
    });
    const pid = result.trim().split('\n')[0];
    if (pid) {
      await invoke<string>('execute_command', {
        cmd: `kill -9 ${pid} 2>/dev/null || true`,
        cwd: '/',
      });
    }
  } catch (error) {
    console.warn(`[portsService] Error killing port ${port}:`, error);
  }
}
