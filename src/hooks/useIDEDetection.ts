import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';

const SUPPORTED_IDES = ['cursor', 'code', 'antigravity'] as const;

// macOS uses app bundle names, Linux/other uses CLI binary names
const IDE_APP_NAMES_MACOS: Record<string, string> = {
  cursor: 'Cursor',
  code: 'Visual Studio Code',
  antigravity: 'Antigravity',
};

/**
 * Check if a CLI binary exists on the system via `which`.
 */
async function isBinaryAvailable(binary: string): Promise<boolean> {
  try {
    await invoke<string>('execute_command', {
      cmd: `which ${binary}`,
      cwd: '/',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * On macOS, check if an app bundle exists in /Applications.
 */
async function isMacAppAvailable(appName: string): Promise<boolean> {
  try {
    const check = await invoke<string>('execute_command', {
      cmd: `test -d "/Applications/${appName}.app" && echo "yes" || echo "no"`,
      cwd: '/',
    });
    return check.trim() === 'yes';
  } catch {
    return false;
  }
}

/**
 * Hook for IDE selection and opening projects in an IDE.
 * Actually detects which IDEs are installed on the system.
 */
export function useIDEDetection(defaultIDE: string | undefined) {
  const [availableIDEs, setAvailableIDEs] = useState<string[]>([]);
  const [selectedIDE, setSelectedIDE] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function detectIDEs() {
      const currentPlatform = platform();
      const isMacOS = currentPlatform === 'macos';

      const detected: string[] = [];

      for (const ide of SUPPORTED_IDES) {
        let available = false;

        if (isMacOS) {
          // Check app bundle first, then CLI
          const appName = IDE_APP_NAMES_MACOS[ide];
          available = await isMacAppAvailable(appName) || await isBinaryAvailable(ide);
        } else {
          // Linux: check CLI binary in PATH
          available = await isBinaryAvailable(ide);
        }

        if (available) {
          detected.push(ide);
        }
      }

      if (cancelled) return;

      setAvailableIDEs(detected);

      // Select IDE: prefer user's saved default, then first available, then null
      if (defaultIDE && detected.includes(defaultIDE)) {
        setSelectedIDE(defaultIDE);
      } else if (detected.length > 0) {
        setSelectedIDE(detected[0]);
      } else {
        setSelectedIDE(null);
      }
    }

    detectIDEs();

    return () => { cancelled = true; };
  }, [defaultIDE]);

  const handleOpenInIDE = useCallback(async (projectPath: string) => {
    if (!selectedIDE) {
      console.error('[IDE] No IDE selected');
      return;
    }

    const currentPlatform = platform();
    const isMacOS = currentPlatform === 'macos';

    if (isMacOS) {
      // macOS: try `open -a "App Name"` first, fallback to CLI
      const appName = IDE_APP_NAMES_MACOS[selectedIDE] || selectedIDE;
      try {
        await invoke<string>('execute_command', {
          cmd: `open -a "${appName}" "${projectPath}"`,
          cwd: '/',
        });
        console.log(`[IDE] Opened ${projectPath} in ${appName}`);
        return;
      } catch {
        // Fall through to CLI method
      }
    }

    // Linux / fallback: use CLI binary name directly
    try {
      await invoke<string>('execute_command', {
        cmd: `${selectedIDE} "${projectPath}" &`,
        cwd: '/',
      });
      console.log(`[IDE] Opened ${projectPath} with ${selectedIDE} CLI`);
    } catch (error) {
      console.error(`[IDE] Failed to open in IDE:`, error);
    }
  }, [selectedIDE]);

  return { availableIDEs, selectedIDE, handleOpenInIDE };
}
