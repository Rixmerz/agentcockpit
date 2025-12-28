import { invoke } from '@tauri-apps/api/core';

export interface ProjectSession {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number;
  model?: string;
  terminalId?: string;
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

async function readProjectConfig(projectPath: string): Promise<ProjectConfig | null> {
  try {
    const result = await invoke<string>('execute_command', {
      cmd: `cat "${CONFIG_FILENAME}"`,
      cwd: projectPath,
    });
    return JSON.parse(result);
  } catch {
    return null;
  }
}

async function writeProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
  const json = JSON.stringify(config, null, 2);
  // Escape single quotes for shell
  const escaped = json.replace(/'/g, "'\\''");
  await invoke<string>('execute_command', {
    cmd: `echo '${escaped}' > "${CONFIG_FILENAME}"`,
    cwd: projectPath,
  });
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
    const result = await invoke<string>('execute_command', {
      cmd: `ps aux | grep -i "claude.*${sessionId}" | grep -v grep`,
      cwd: '/',
    });
    return result.trim().length === 0; // true if NOT in use
  } catch {
    return true; // error = assume not in use
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
    const psResult = await invoke<string>('execute_command', {
      cmd: `ps aux | grep -i "claude.*${sessionId}" | grep -v grep`,
      cwd: '/',
    });

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
        await invoke<string>('execute_command', {
          cmd: `kill -9 ${pid}`,
          cwd: '/',
        });
      } catch (err) {
        // Process may have already died, ignore errors
        console.warn(`[ZombieKill] Failed to kill PID ${pid}:`, err);
      }
    }

    // 4. Verify processes are gone
    await new Promise(resolve => setTimeout(resolve, 200)); // Give OS time to cleanup

    const verifyResult = await invoke<string>('execute_command', {
      cmd: `ps aux | grep -i "claude.*${sessionId}" | grep -v grep`,
      cwd: '/',
    });

    if (verifyResult.trim().length > 0) {
      console.error(`[ZombieKill] Processes still alive after kill -9 for session ${sessionId}`);
    }

    return pids.length;
  } catch (error) {
    console.error(`[ZombieKill] Error killing processes for session ${sessionId}:`, error);
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
