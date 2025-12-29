import { useEffect, useCallback, useRef } from 'react';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { appDataDir } from '@tauri-apps/api/path';
import type { Project } from '../types';

interface PersistedConfig {
  projects: Project[];
  activeProjectId: string | null;
  activeTerminalId: string | null;
  selectedModel: 'haiku' | 'sonnet' | 'opus';
  mcpDesktopEnabled: boolean;
  mcpDefaultEnabled: boolean;
  // Global settings
  defaultIDE?: 'cursor' | 'code' | 'antigravity';
  backgroundImage?: string;
  backgroundOpacity?: number;
  terminalOpacity?: number;
}

const CONFIG_FILENAME = 'agentcockpit-config.json';

async function getConfigPath(): Promise<string> {
  const dataDir = await appDataDir();
  // Ensure path ends with separator
  const separator = dataDir.endsWith('/') || dataDir.endsWith('\\') ? '' : '/';
  return `${dataDir}${separator}${CONFIG_FILENAME}`;
}

async function ensureDataDir(): Promise<void> {
  const dataDir = await appDataDir();
  const dirExists = await exists(dataDir);
  if (!dirExists) {
    await mkdir(dataDir, { recursive: true });
  }
}

export async function loadConfig(): Promise<PersistedConfig | null> {
  try {
    const configPath = await getConfigPath();
    console.log('[Persistence] Loading config from:', configPath);

    const fileExists = await exists(configPath);
    console.log('[Persistence] File exists:', fileExists);

    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(configPath);
    const config = JSON.parse(content) as PersistedConfig;
    console.log('[Persistence] Loaded config:', Object.keys(config));

    // Validate and clean up: remove terminals (they need to be re-created as PTYs)
    const cleanedConfig: PersistedConfig = {
      ...config,
      projects: config.projects.map(p => ({
        ...p,
        terminals: [], // Clear terminals - PTYs don't persist
      })),
      activeTerminalId: null, // No active terminal on load
    };

    return cleanedConfig;
  } catch (error) {
    console.error('Failed to load config:', error);
    return null;
  }
}

export async function saveConfig(config: PersistedConfig): Promise<void> {
  try {
    await ensureDataDir();
    const configPath = await getConfigPath();
    console.log('[Persistence] Saving config to:', configPath);

    // Clean config before saving (remove runtime-only data)
    const cleanedConfig: PersistedConfig = {
      ...config,
      projects: config.projects.map(p => ({
        ...p,
        terminals: [], // Don't persist terminals
      })),
      activeTerminalId: null,
    };

    console.log('[Persistence] Saving settings:', {
      defaultIDE: cleanedConfig.defaultIDE,
      backgroundImage: cleanedConfig.backgroundImage ? '(set)' : '(not set)',
      backgroundOpacity: cleanedConfig.backgroundOpacity,
      terminalOpacity: cleanedConfig.terminalOpacity,
      projectsCount: cleanedConfig.projects.length,
    });

    const content = JSON.stringify(cleanedConfig, null, 2);
    await writeTextFile(configPath, content);
    console.log('[Persistence] Config saved successfully');
  } catch (error) {
    console.error('[Persistence] Failed to save config:', error);
  }
}

interface UsePersistenceOptions {
  onLoad: (config: PersistedConfig | null) => void;
  getState: () => PersistedConfig;
}

export function usePersistence({ onLoad, getState }: UsePersistenceOptions) {
  const isLoadedRef = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);

  // Load config on mount
  useEffect(() => {
    if (isLoadedRef.current) return;
    isLoadedRef.current = true;

    loadConfig().then(config => {
      onLoad(config); // Always call onLoad, even if null
    }).catch(() => {
      onLoad(null); // Handle errors gracefully
    });
  }, [onLoad]);

  // Debounced save function
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      const currentState = getState();
      saveConfig(currentState);
      saveTimeoutRef.current = null;
    }, 1000); // Debounce 1 second
  }, [getState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Save immediately on unmount
        const currentState = getState();
        saveConfig(currentState);
      }
    };
  }, [getState]);

  return { scheduleSave };
}
