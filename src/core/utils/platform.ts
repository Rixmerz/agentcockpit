/**
 * Platform detection utility for cross-platform support (macOS / Linux)
 *
 * Uses @tauri-apps/plugin-os to detect the OS at runtime and provides
 * helpers for platform-specific paths and commands.
 */

import { type as osType } from '@tauri-apps/plugin-os';

export type Platform = 'macos' | 'linux' | 'windows';

let _platformCache: string | null = null;

/**
 * Get the current platform. Result is cached after first call.
 */
export async function getPlatform(): Promise<Platform> {
  if (!_platformCache) {
    _platformCache = await osType();
  }
  if (_platformCache === 'macos') return 'macos';
  if (_platformCache === 'linux') return 'linux';
  return 'windows';
}

/**
 * Get the path to Claude Desktop's config file.
 * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Linux: ~/.config/Claude/claude_desktop_config.json
 */
export async function getClaudeDesktopConfigPath(home: string): Promise<string> {
  const platform = await getPlatform();
  if (platform === 'macos') {
    return `${home}/Library/Application Support/Claude/claude_desktop_config.json`;
  }
  return `${home}/.config/Claude/claude_desktop_config.json`;
}

/**
 * Get the relative path segment for Claude Desktop config (without home prefix).
 * - macOS: Library/Application Support/Claude/claude_desktop_config.json
 * - Linux: .config/Claude/claude_desktop_config.json
 */
export async function getClaudeDesktopConfigRelPath(): Promise<string> {
  const platform = await getPlatform();
  if (platform === 'macos') {
    return 'Library/Application Support/Claude/claude_desktop_config.json';
  }
  return '.config/Claude/claude_desktop_config.json';
}

/**
 * Get the command to open a file/URL with the OS default handler.
 * - macOS: open
 * - Linux: xdg-open
 */
export async function getOpenCommand(): Promise<string> {
  const platform = await getPlatform();
  return platform === 'macos' ? 'open' : 'xdg-open';
}
