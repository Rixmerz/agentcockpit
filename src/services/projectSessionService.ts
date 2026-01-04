import { invoke } from '@tauri-apps/api/core';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { withTimeout, TimeoutError } from '../core/utils/promiseTimeout';

// Timeout for execute_command operations (prevents infinite hangs in bundled app)
const INVOKE_TIMEOUT_MS = 5000;

export interface ProjectSession {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number;
  model?: string;
  terminalId?: string;
  wasPreExisting?: boolean;  // true = usar --resume, false = usar --session-id
}

export interface ProjectConfig {
  sessions: ProjectSession[];
  defaultModel: string;
  mcpPreferences: {
    enableDesktop: boolean;
    enableCode: boolean;
    selectedServers: string[];
  };
}

const CONFIG_FILENAME = 'one-term-project.json';

function generateSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Fallback: Read config using Tauri FS plugin (doesn't require shell)
 */
async function readProjectConfigFS(projectPath: string): Promise<ProjectConfig | null> {
  console.log('[ProjectSession:FS] Reading config from:', projectPath);

  try {
    const configPath = `${projectPath}/${CONFIG_FILENAME}`;
    const fileExists = await withTimeout(exists(configPath), 2000, 'check exists');

    if (!fileExists) {
      console.log('[ProjectSession:FS] Config file does not exist');
      return null;
    }

    const content = await withTimeout(
      readTextFile(configPath),
      INVOKE_TIMEOUT_MS,
      `readTextFile ${configPath}`
    );

    console.log('[ProjectSession:FS] Config read successfully');
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error('[ProjectSession:FS] Timeout:', error.message);
    } else {
      console.error('[ProjectSession:FS] Error:', error);
    }
    return null;
  }
}

async function readProjectConfig(projectPath: string): Promise<ProjectConfig | null> {
  console.log('[ProjectSession:Shell] Reading config from:', projectPath);

  // Try execute_command first (works in dev, may hang in bundled)
  try {
    const invokePromise = invoke<string>('execute_command', {
      cmd: `cat "${CONFIG_FILENAME}"`,
      cwd: projectPath,
    });

    const result = await withTimeout(
      invokePromise,
      INVOKE_TIMEOUT_MS,
      `readProjectConfig from ${projectPath}`
    );

    console.log('[ProjectSession:Shell] Config read successfully');
    return JSON.parse(result);
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.warn('[ProjectSession:Shell] Timed out, trying FS plugin');
      return await readProjectConfigFS(projectPath);
    }
    // Other errors (file not found, etc.) - try FS fallback
    console.log('[ProjectSession:Shell] Shell failed, trying FS plugin');
    return await readProjectConfigFS(projectPath);
  }
}

/**
 * Fallback: Write config using Tauri FS plugin (doesn't require shell)
 */
async function writeProjectConfigFS(projectPath: string, config: ProjectConfig): Promise<void> {
  console.log('[ProjectSession:FS] Writing config:', projectPath);
  const configPath = `${projectPath}/${CONFIG_FILENAME}`;
  const json = JSON.stringify(config, null, 2);

  await withTimeout(
    writeTextFile(configPath, json),
    INVOKE_TIMEOUT_MS,
    `writeTextFile ${configPath}`
  );
  console.log('[ProjectSession:FS] Config written successfully');
}

async function writeProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
  console.log('[ProjectSession:Shell] Writing config to:', projectPath);
  const json = JSON.stringify(config, null, 2);
  // Escape single quotes for shell
  const escaped = json.replace(/'/g, "'\\''");

  try {
    const invokePromise = invoke<string>('execute_command', {
      cmd: `echo '${escaped}' > "${CONFIG_FILENAME}"`,
      cwd: projectPath,
    });

    await withTimeout(invokePromise, INVOKE_TIMEOUT_MS, 'writeProjectConfig');
    console.log('[ProjectSession:Shell] Config written successfully');
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.warn('[ProjectSession:Shell] Write timed out, trying FS plugin');
    } else {
      console.log('[ProjectSession:Shell] Shell write failed, trying FS plugin');
    }
    await writeProjectConfigFS(projectPath, config);
  }
}

export async function getProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const existing = await readProjectConfig(projectPath);
  if (existing) {
    return existing;
  }

  // Return default config
  return {
    sessions: [],
    defaultModel: 'sonnet',
    mcpPreferences: {
      enableDesktop: true,
      enableCode: true,
      selectedServers: [],
    },
  };
}

export async function saveProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
  await writeProjectConfig(projectPath, config);
}

export async function createSession(
  projectPath: string,
  name?: string,
  model?: string
): Promise<ProjectSession> {
  const config = await getProjectConfig(projectPath);

  const session: ProjectSession = {
    id: generateSessionId(),
    name: name || `Session ${config.sessions.length + 1}`,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    model: model || config.defaultModel,
    wasPreExisting: false,  // Sesiones nuevas NO usan --resume, usan --session-id
  };

  config.sessions.push(session);
  await saveProjectConfig(projectPath, config);

  return session;
}

export async function updateSessionLastUsed(
  projectPath: string,
  sessionId: string,
  terminalId?: string
): Promise<void> {
  const config = await getProjectConfig(projectPath);
  const session = config.sessions.find(s => s.id === sessionId);

  if (session) {
    session.lastUsed = Date.now();
    if (terminalId) {
      session.terminalId = terminalId;
    }
    await saveProjectConfig(projectPath, config);
  }
}

/**
 * Mark a session as pre-existing (already persisted in Claude CLI).
 * After this, the session will use --resume instead of --session-id.
 */
export async function markSessionAsPreExisting(
  projectPath: string,
  sessionId: string
): Promise<void> {
  const config = await getProjectConfig(projectPath);
  const session = config.sessions.find(s => s.id === sessionId);

  if (session) {
    session.wasPreExisting = true;
    await saveProjectConfig(projectPath, config);
    console.log(`[ProjectSession] Marked session ${sessionId} as pre-existing`);
  }
}

export async function deleteSession(projectPath: string, sessionId: string): Promise<void> {
  const config = await getProjectConfig(projectPath);
  config.sessions = config.sessions.filter(s => s.id !== sessionId);
  await saveProjectConfig(projectPath, config);
}

export async function getSessions(projectPath: string): Promise<ProjectSession[]> {
  const config = await getProjectConfig(projectPath);
  // Sort by last used, most recent first
  return config.sessions.sort((a, b) => b.lastUsed - a.lastUsed);
}

export async function updateMcpPreferences(
  projectPath: string,
  preferences: ProjectConfig['mcpPreferences']
): Promise<void> {
  const config = await getProjectConfig(projectPath);
  config.mcpPreferences = preferences;
  await saveProjectConfig(projectPath, config);
}

/**
 * Check if a session UUID is currently in use by a running Claude process
 */
export async function validateSessionNotInUse(
  sessionId: string
): Promise<boolean> {
  try {
    const result = await withTimeout(
      invoke<string>('execute_command', {
        cmd: `ps aux | grep -i "claude.*${sessionId}" | grep -v grep`,
        cwd: '/',
      }),
      INVOKE_TIMEOUT_MS,
      'validate session not in use'
    );
    return result.trim().length === 0; // true if NOT in use
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.warn('[SessionValidation] Timeout checking session:', error.message);
    }
    return true; // Assume not in use if error/timeout
  }
}

/**
 * Kill all running processes associated with a Claude session ID
 * @returns number of processes killed
 */
export async function killProcessesBySessionId(
  sessionId: string
): Promise<number> {
  try {
    // 1. Find processes with session ID
    const psResult = await withTimeout(
      invoke<string>('execute_command', {
        cmd: `ps aux | grep -i "claude.*${sessionId}" | grep -v grep`,
        cwd: '/',
      }),
      INVOKE_TIMEOUT_MS,
      'find processes by session'
    );

    if (psResult.trim().length === 0) {
      return 0; // No processes found
    }

    // 2. Parse PIDs from ps aux output
    const lines = psResult.trim().split('\n');
    const pids: number[] = [];

    for (const line of lines) {
      // ps aux format: USER PID %CPU %MEM ... COMMAND
      // Split by whitespace, PID is at index 1
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const pid = parseInt(parts[1], 10);
        if (!isNaN(pid)) {
          pids.push(pid);
        }
      }
    }

    if (pids.length === 0) {
      return 0;
    }

    // 3. Kill each process with SIGKILL (-9)
    console.log(`[ZombieKill] Killing ${pids.length} processes for session ${sessionId}:`, pids);

    for (const pid of pids) {
      try {
        await withTimeout(
          invoke<string>('execute_command', {
            cmd: `kill -9 ${pid}`,
            cwd: '/',
          }),
          INVOKE_TIMEOUT_MS,
          `kill process ${pid}`
        );
      } catch (err) {
        if (err instanceof TimeoutError) {
          console.warn(`[ZombieKill] Timeout killing PID ${pid}`);
        } else {
          // Process may have already died, ignore errors
          console.warn(`[ZombieKill] Failed to kill PID ${pid}:`, err);
        }
      }
    }

    // 4. Verify processes are gone
    await new Promise(resolve => setTimeout(resolve, 200)); // Give OS time to cleanup

    try {
      const verifyResult = await withTimeout(
        invoke<string>('execute_command', {
          cmd: `ps aux | grep -i "claude.*${sessionId}" | grep -v grep`,
          cwd: '/',
        }),
        INVOKE_TIMEOUT_MS,
        'verify processes killed'
      );

      if (verifyResult.trim().length > 0) {
        console.error(`[ZombieKill] Processes still alive after kill -9 for session ${sessionId}`);
      }
    } catch (verifyError) {
      if (verifyError instanceof TimeoutError) {
        console.warn('[ZombieKill] Timeout verifying killed processes');
      }
    }

    return pids.length;
  } catch (error) {
    if (error instanceof TimeoutError) {
      console.error(`[ZombieKill] Timeout: ${error.message}`);
    } else {
      console.error(`[ZombieKill] Error killing processes for session ${sessionId}:`, error);
    }
    return 0;
  }
}

/**
 * Clean up stale sessions on app startup.
 * Kills zombie Claude processes and removes their session records.
 */
export async function cleanStaleSessionsOnStartup(
  projectPath: string
): Promise<void> {
  const config = await getProjectConfig(projectPath);
  const validSessions: ProjectSession[] = [];
  let totalKilled = 0;
  const staleCount = { value: 0 };

  for (const session of config.sessions) {
    const isValid = await validateSessionNotInUse(session.id);
    if (isValid) {
      validSessions.push(session);
    } else {
      // Kill zombie processes before removing session record
      console.warn(`[SessionCleanup] Killing zombie processes for session: ${session.id} (${session.name})`);
      const killed = await killProcessesBySessionId(session.id);
      totalKilled += killed;
      console.log(`[SessionCleanup] Killed ${killed} processes for session ${session.id}`);
      staleCount.value++;
    }
  }

  if (staleCount.value > 0) {
    config.sessions = validSessions;
    await saveProjectConfig(projectPath, config);
    console.log(`[SessionCleanup] Cleaned ${staleCount.value} stale sessions, killed ${totalKilled} zombie processes`);
  }
}
