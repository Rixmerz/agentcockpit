import { invoke } from '@tauri-apps/api/core';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { withTimeout, TimeoutError } from '../core/utils/promiseTimeout';
import type { ProjectWorkflowConfig } from '../types';

// Timeout for execute_command operations (prevents infinite hangs in bundled app)
const INVOKE_TIMEOUT_MS = 5000;

export interface ProjectSession {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number;
  model?: string;
  terminalId?: string;
  wasPreExisting?: boolean;  // true = session captured from Claude's resume UUID
}

export interface ProjectConfig {
  sessions: ProjectSession[];
  defaultModel: string;
  mcpPreferences: {
    enableDesktop: boolean;
    enableCode: boolean;
    selectedServers: string[];
  };
  workflow?: ProjectWorkflowConfig;
}

const CONFIG_FILENAME = 'agentcockpit-project.json';


/**
 * Fallback: Read config using Tauri FS plugin (doesn't require shell)
 */
async function readProjectConfigFS(projectPath: string): Promise<ProjectConfig | null> {
  try {
    const configPath = `${projectPath}/${CONFIG_FILENAME}`;
    const fileExists = await withTimeout(exists(configPath), 2000, 'check exists');

    if (!fileExists) {
      return null;
    }

    const content = await withTimeout(
      readTextFile(configPath),
      INVOKE_TIMEOUT_MS,
      `readTextFile ${configPath}`
    );

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

    return JSON.parse(result);
  } catch (error) {
    if (error instanceof TimeoutError) {
      return await readProjectConfigFS(projectPath);
    }
    // Other errors (file not found, etc.) - try FS fallback
    return await readProjectConfigFS(projectPath);
  }
}

/**
 * Fallback: Write config using Tauri FS plugin (doesn't require shell)
 */
async function writeProjectConfigFS(projectPath: string, config: ProjectConfig): Promise<void> {
  const configPath = `${projectPath}/${CONFIG_FILENAME}`;
  const json = JSON.stringify(config, null, 2);

  await withTimeout(
    writeTextFile(configPath, json),
    INVOKE_TIMEOUT_MS,
    `writeTextFile ${configPath}`
  );
}

async function writeProjectConfig(projectPath: string, config: ProjectConfig): Promise<void> {
  const json = JSON.stringify(config, null, 2);
  // Escape single quotes for shell
  const escaped = json.replace(/'/g, "'\\''");

  try {
    const invokePromise = invoke<string>('execute_command', {
      cmd: `echo '${escaped}' > "${CONFIG_FILENAME}"`,
      cwd: projectPath,
    });

    await withTimeout(invokePromise, INVOKE_TIMEOUT_MS, 'writeProjectConfig');
  } catch {
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

/**
 * Create a session from a detected Claude resume UUID.
 * Called when we detect `claude --resume <uuid>` in PTY output.
 */
export async function createSessionFromResume(
  projectPath: string,
  resumeId: string,
  terminalId?: string
): Promise<ProjectSession> {
  const config = await getProjectConfig(projectPath);

  // Don't create duplicate if already exists
  const existing = config.sessions.find(s => s.id === resumeId);
  if (existing) {
    existing.lastUsed = Date.now();
    if (terminalId) existing.terminalId = terminalId;
    await saveProjectConfig(projectPath, config);
    return existing;
  }

  const session: ProjectSession = {
    id: resumeId,
    name: `Session ${config.sessions.length + 1}`,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    wasPreExisting: true,
    terminalId,
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

// ============================================
// Workflow Configuration
// ============================================

/**
 * Get workflow configuration for a project
 * Note: 'enabled' now comes from .claude/workflow/config.json
 * Note: 'activeWorkflowId' now comes from .claude/workflow/state.json
 */
export async function getProjectWorkflowConfig(projectPath: string): Promise<ProjectWorkflowConfig> {
  const config = await getProjectConfig(projectPath);
  return config.workflow || {
    installedAt: null
  };
}

/**
 * Update workflow configuration for a project
 * Only manages installedAt now - enabled/activeWorkflow are in .claude/workflow/
 */
export async function updateProjectWorkflowConfig(
  projectPath: string,
  workflowConfig: Partial<ProjectWorkflowConfig>
): Promise<void> {
  const config = await getProjectConfig(projectPath);
  config.workflow = {
    ...config.workflow || {
      installedAt: null
    },
    ...workflowConfig
  };
  await saveProjectConfig(projectPath, config);
}
