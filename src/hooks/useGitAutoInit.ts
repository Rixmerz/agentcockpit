/**
 * useGitAutoInit Hook
 *
 * Automatically initializes a git repository when a project is opened
 * if it doesn't already have one.
 */

import { useEffect, useRef, useState } from 'react';
import { isGitRepository, isGitInstalled, initRepository } from '../services/gitService';

interface GitAutoInitState {
  isChecking: boolean;
  isRepository: boolean;
  wasInitialized: boolean;
  error: string | null;
}

interface UseGitAutoInitOptions {
  autoInit?: boolean; // Default: true
  onInitialized?: (projectPath: string) => void;
  onError?: (error: string) => void;
}

/**
 * Hook to auto-initialize git in projects without a repository
 *
 * @param projectPath - Absolute path to the project directory
 * @param options - Configuration options
 */
export function useGitAutoInit(
  projectPath: string | null,
  options: UseGitAutoInitOptions = {}
): GitAutoInitState {
  const { autoInit = true, onInitialized, onError } = options;

  const [state, setState] = useState<GitAutoInitState>({
    isChecking: false,
    isRepository: false,
    wasInitialized: false,
    error: null,
  });

  // Track initialization to prevent duplicate runs
  const initializedPathsRef = useRef<Set<string>>(new Set());
  const checkingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!projectPath) {
      setState({
        isChecking: false,
        isRepository: false,
        wasInitialized: false,
        error: null,
      });
      return;
    }

    // Skip if already checked/initialized this path
    if (initializedPathsRef.current.has(projectPath)) {
      return;
    }

    // Prevent concurrent checks
    if (checkingRef.current) {
      return;
    }

    const checkAndInit = async () => {
      checkingRef.current = true;
      setState(prev => ({ ...prev, isChecking: true, error: null }));

      try {
        // First check if git is installed
        const gitInstalled = await isGitInstalled();
        if (!gitInstalled) {
          const error = 'Git is not installed. Please install git to use snapshot features.';
          setState({
            isChecking: false,
            isRepository: false,
            wasInitialized: false,
            error,
          });
          onError?.(error);
          return;
        }

        // Check if already a repository
        const isRepo = await isGitRepository(projectPath);

        if (isRepo) {
          setState({
            isChecking: false,
            isRepository: true,
            wasInitialized: false,
            error: null,
          });
          initializedPathsRef.current.add(projectPath);
          return;
        }

        // Not a repository - auto-init if enabled
        if (autoInit) {
          console.log(`[GitAutoInit] Initializing git in: ${projectPath}`);
          await initRepository(projectPath);

          setState({
            isChecking: false,
            isRepository: true,
            wasInitialized: true,
            error: null,
          });

          initializedPathsRef.current.add(projectPath);
          onInitialized?.(projectPath);

          console.log(`[GitAutoInit] Git initialized successfully in: ${projectPath}`);
        } else {
          setState({
            isChecking: false,
            isRepository: false,
            wasInitialized: false,
            error: null,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[GitAutoInit] Error:', error);

        setState({
          isChecking: false,
          isRepository: false,
          wasInitialized: false,
          error,
        });

        onError?.(error);
      } finally {
        checkingRef.current = false;
      }
    };

    checkAndInit();
  }, [projectPath, autoInit, onInitialized, onError]);

  return state;
}

/**
 * Manually trigger git init for a path
 * Useful when autoInit is disabled
 */
export async function manualGitInit(projectPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    const gitInstalled = await isGitInstalled();
    if (!gitInstalled) {
      return { success: false, error: 'Git is not installed' };
    }

    const isRepo = await isGitRepository(projectPath);
    if (isRepo) {
      return { success: true }; // Already a repo
    }

    await initRepository(projectPath);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}
