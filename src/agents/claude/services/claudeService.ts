/**
 * Claude Service
 *
 * Service for interacting with Claude CLI.
 * Part of the Claude agent plugin.
 */

import { readTextFile, exists, readDir } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import type { BuildCommandOptions } from '../../../plugins/types/plugin';

// ==================== Types ====================

export interface ClaudeSession {
  sessionId: string;
  workingDirectory?: string;
  createdAt?: number;
}

// ==================== Config Paths ====================

/**
 * Get the path to Claude CLI config directory
 */
async function getClaudeConfigDir(): Promise<string> {
  const home = await homeDir();
  return `${home}.claude/`;
}

// ==================== Session Functions ====================

/**
 * Read Claude CLI session-env file if it exists
 * The session-env file contains environment variables from active Claude sessions
 */
export async function readSessionEnv(): Promise<Record<string, string> | null> {
  try {
    const claudeDir = await getClaudeConfigDir();
    const sessionEnvPath = `${claudeDir}session-env`;

    const fileExists = await exists(sessionEnvPath);
    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(sessionEnvPath);
    const env: Record<string, string> = {};

    // Parse KEY=VALUE lines
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        let value = trimmed.substring(eqIndex + 1);
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key] = value;
      }
    }

    return env;
  } catch (error) {
    console.error('[ClaudeService] Failed to read session-env:', error);
    return null;
  }
}

/**
 * Get current Claude session ID from environment
 */
export async function getCurrentSessionId(): Promise<string | null> {
  const env = await readSessionEnv();
  return env?.CLAUDE_SESSION_ID || null;
}

/**
 * List available Claude sessions from the projects directory
 */
export async function listClaudeSessions(): Promise<ClaudeSession[]> {
  try {
    const claudeDir = await getClaudeConfigDir();
    const projectsDir = `${claudeDir}projects/`;

    const dirExists = await exists(projectsDir);
    if (!dirExists) {
      return [];
    }

    const entries = await readDir(projectsDir);
    const sessions: ClaudeSession[] = [];

    for (const entry of entries) {
      if (entry.isDirectory && entry.name) {
        // Each directory in projects/ is a project with sessions
        const projectPath = `${projectsDir}${entry.name}/`;
        try {
          const projectEntries = await readDir(projectPath);
          for (const sessionEntry of projectEntries) {
            if (sessionEntry.isDirectory && sessionEntry.name) {
              sessions.push({
                sessionId: sessionEntry.name,
                workingDirectory: decodeURIComponent(entry.name),
              });
            }
          }
        } catch {
          // Skip if we can't read the directory
        }
      }
    }

    return sessions;
  } catch (error) {
    console.error('[ClaudeService] Failed to list Claude sessions:', error);
    return [];
  }
}

// ==================== Command Building ====================

/**
 * Build Claude CLI command with optional flags
 */
export function buildClaudeCommand(options: BuildCommandOptions): string {
  const args: string[] = ['claude'];

  // Session handling: --resume for existing sessions, --session-id for new
  if (options.resume && options.sessionId) {
    args.push('--resume', options.sessionId);
  } else if (options.sessionId) {
    args.push('--session-id', options.sessionId);
  } else {
    args.push('--new-session');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.mcpDesktop) {
    args.push('--mcp-desktop');
  }

  if (options.mcpDefault === false) {
    args.push('--no-mcp-default');
  }

  // Additional args
  if (options.additionalArgs) {
    args.push(...options.additionalArgs);
  }

  return args.join(' ');
}
