import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

const SUPPORTED_IDES = ['cursor', 'code', 'antigravity'] as const;

const IDE_APP_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  code: 'Visual Studio Code',
  antigravity: 'Antigravity',
};

/**
 * Hook for IDE selection and opening projects in an IDE.
 */
export function useIDEDetection(defaultIDE: string | undefined) {
  const [availableIDEs, setAvailableIDEs] = useState<string[]>([]);
  const [selectedIDE, setSelectedIDE] = useState<string | null>(null);

  useEffect(() => {
    setAvailableIDEs([...SUPPORTED_IDES]);

    if (defaultIDE && (SUPPORTED_IDES as readonly string[]).includes(defaultIDE)) {
      setSelectedIDE(defaultIDE);
    } else {
      setSelectedIDE('cursor');
    }
  }, [defaultIDE]);

  const handleOpenInIDE = useCallback(async (projectPath: string) => {
    if (!selectedIDE) {
      console.error('[IDE] No IDE selected');
      return;
    }

    const appName = IDE_APP_NAMES[selectedIDE] || selectedIDE;

    try {
      await invoke<string>('execute_command', {
        cmd: `open -a "${appName}" "${projectPath}"`,
        cwd: '/',
      });
      console.log(`[IDE] Opened ${projectPath} in ${appName}`);
    } catch {
      try {
        await invoke<string>('execute_command', {
          cmd: `${selectedIDE} "${projectPath}" &`,
          cwd: '/',
        });
        console.log(`[IDE] Opened ${projectPath} with ${selectedIDE} CLI`);
      } catch (error) {
        console.error(`[IDE] Failed to open in IDE:`, error);
      }
    }
  }, [selectedIDE]);

  return { availableIDEs, selectedIDE, handleOpenInIDE };
}
