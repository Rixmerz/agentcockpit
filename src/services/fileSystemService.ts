import { open } from '@tauri-apps/plugin-dialog';
import { readDir, exists } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

// Open folder dialog
export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Seleccionar carpeta del proyecto',
  });

  return selected as string | null;
}

// Execute shell command and get output
export async function executeCommand(cmd: string, cwd: string): Promise<string> {
  // We'll use a simple command execution via Tauri
  // For now, spawn a shell command and capture output
  return invoke<string>('execute_command', { cmd, cwd });
}

// List directory contents
export async function listDirectory(path: string): Promise<string[]> {
  try {
    const entries = await readDir(path);
    return entries.map(entry => entry.name);
  } catch (error) {
    console.error('Failed to list directory:', error);
    return [];
  }
}

// Check if path exists
export async function pathExists(path: string): Promise<boolean> {
  try {
    return await exists(path);
  } catch {
    return false;
  }
}

// Get current working directory (via shell)
export async function getCurrentDirectory(): Promise<string> {
  try {
    const result = await executeCommand('pwd', '/');
    return result.trim();
  } catch {
    return '/';
  }
}

// Resolve path (handle ~, .., etc)
export function resolvePath(currentPath: string, newPath: string): string {
  // Handle home directory
  if (newPath.startsWith('~')) {
    const home = '/Users/' + (typeof window !== 'undefined' ? 'juanpablodiaz' : 'user');
    newPath = newPath.replace('~', home);
  }

  // Handle absolute path
  if (newPath.startsWith('/')) {
    return newPath;
  }

  // Handle relative path
  const parts = currentPath.split('/').filter(Boolean);

  for (const part of newPath.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '.' && part !== '') {
      parts.push(part);
    }
  }

  return '/' + parts.join('/');
}
