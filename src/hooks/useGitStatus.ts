import { useState, useCallback } from 'react';
import { gitPush, type SyncStatus } from '../services/gitService';
import { useGitWatcherEvent } from '../core/utils/gitWatcherEventBus';
import { gitWatcherService } from '../services/gitWatcherService';

export interface GitInfo {
  branch: string | null;
  hasChanges: boolean;
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
  syncStatus: SyncStatus | null;
  hasRepo: boolean;
}

export interface UseGitStatusResult {
  gitInfo: GitInfo;
  isPushing: boolean;
  showGitSettings: boolean;
  setShowGitSettings: (open: boolean) => void;
  handlePush: () => Promise<void>;
}

const GIT_INFO_DEFAULTS: GitInfo = {
  branch: null,
  hasChanges: false,
  modifiedCount: 0,
  stagedCount: 0,
  untrackedCount: 0,
  syncStatus: null,
  hasRepo: false,
};

export function useGitStatus(projectPath: string | null): UseGitStatusResult {
  const [gitInfo, setGitInfo] = useState<GitInfo>(GIT_INFO_DEFAULTS);
  const [isPushing, setIsPushing] = useState(false);
  const [showGitSettings, setShowGitSettings] = useState(false);

  // Subscribe to git watcher status events
  useGitWatcherEvent('status', (data) => {
    if (data.projectPath !== projectPath) return;
    setGitInfo({
      branch: data.branch,
      hasChanges: data.hasChanges,
      modifiedCount: data.modifiedFiles.length,
      stagedCount: data.stagedFiles.length,
      untrackedCount: data.untrackedFiles.length,
      syncStatus: data.syncStatus,
      hasRepo: data.hasRepo,
    });
  }, [projectPath]);

  const handlePush = useCallback(async () => {
    if (!projectPath) return;
    setIsPushing(true);
    try {
      await gitPush(projectPath);
      gitWatcherService.pollNow();
    } catch (error) {
      console.error('[useGitStatus] Push failed:', error);
    } finally {
      setIsPushing(false);
    }
  }, [projectPath]);

  return {
    gitInfo,
    isPushing,
    showGitSettings,
    setShowGitSettings,
    handlePush,
  };
}
