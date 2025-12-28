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
 * Clean up stale sessions on app startup.
 * Removes sessions whose UUIDs are still in use by zombie Claude processes.
 */
export async function cleanStaleSessionsOnStartup(
  projectPath: string
): Promise<void> {
  const config = await getProjectConfig(projectPath);
  const validSessions: ProjectSession[] = [];
  let hasStale = false;

  for (const session of config.sessions) {
    const isValid = await validateSessionNotInUse(session.id);
    if (isValid) {
      validSessions.push(session);
    } else {
      console.warn(`[SessionCleanup] Removing stale session: ${session.id} (${session.name})`);
      hasStale = true;
    }
  }

  if (hasStale) {
    config.sessions = validSessions;
    await saveProjectConfig(projectPath, config);
    console.log(`[SessionCleanup] Cleaned ${config.sessions.length - validSessions.length} stale sessions`);
  }
}
