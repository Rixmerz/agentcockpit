/**
 * Git Settings Component
 *
 * Manages git repository configuration with explicit user control.
 * Features:
 * - Strict local repo detection (avoids parent directory repos)
 * - Manual git init button
 * - Remote URL management
 * - Clear state indicators
 */

import { useState, useCallback, useEffect } from 'react';
import {
  GitBranch,
  Globe,
  RefreshCw,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  Copy,
  FolderGit2,
  Plus,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  FileEdit,
  FilePlus,
  FileCheck,
} from 'lucide-react';
import {
  setRemoteUrl,
  listRemotes,
  getGitStatus,
  hasLocalGitRepo,
  getGitRoot,
  initRepository,
  getSyncStatus,
  type SyncStatus,
} from '../../services/gitService';

interface GitSettingsProps {
  projectPath: string | null;
  onGitInit?: () => void; // Callback when git is initialized
}

type GitRepoState = 'none' | 'local' | 'remote' | 'parent';

interface GitState {
  repoState: GitRepoState;
  parentRepoPath: string | null;
  remotes: Array<{ name: string; url: string }>;
  currentBranch: string | null;
  isLoading: boolean;
  error: string | null;
  // Change counts
  modifiedCount: number;
  stagedCount: number;
  untrackedCount: number;
  // Sync status
  syncStatus: SyncStatus | null;
}

export function GitSettings({ projectPath, onGitInit }: GitSettingsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [gitState, setGitState] = useState<GitState>({
    repoState: 'none',
    parentRepoPath: null,
    remotes: [],
    currentBranch: null,
    isLoading: false,
    error: null,
    modifiedCount: 0,
    stagedCount: 0,
    untrackedCount: 0,
    syncStatus: null,
  });

  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  // Load git info with strict detection
  const loadGitInfo = useCallback(async () => {
    if (!projectPath) {
      setGitState({
        repoState: 'none',
        parentRepoPath: null,
        remotes: [],
        currentBranch: null,
        isLoading: false,
        error: null,
        modifiedCount: 0,
        stagedCount: 0,
        untrackedCount: 0,
        syncStatus: null,
      });
      return;
    }

    setGitState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Check for LOCAL repo (strict detection - not parent directories)
      const hasLocal = await hasLocalGitRepo(projectPath);

      if (!hasLocal) {
        // Check if there's a parent repo (to warn user)
        const gitRoot = await getGitRoot(projectPath);

        if (gitRoot && gitRoot !== projectPath) {
          setGitState({
            repoState: 'parent',
            parentRepoPath: gitRoot,
            remotes: [],
            currentBranch: null,
            isLoading: false,
            error: null,
            modifiedCount: 0,
            stagedCount: 0,
            untrackedCount: 0,
            syncStatus: null,
          });
        } else {
          setGitState({
            repoState: 'none',
            parentRepoPath: null,
            remotes: [],
            currentBranch: null,
            isLoading: false,
            error: null,
            modifiedCount: 0,
            stagedCount: 0,
            untrackedCount: 0,
            syncStatus: null,
          });
        }
        return;
      }

      // Has local repo - get details
      const [remotes, status, syncStatus] = await Promise.all([
        listRemotes(projectPath),
        getGitStatus(projectPath),
        getSyncStatus(projectPath),
      ]);

      const hasRemote = remotes.length > 0;

      setGitState({
        repoState: hasRemote ? 'remote' : 'local',
        parentRepoPath: null,
        remotes,
        currentBranch: status.branch,
        isLoading: false,
        error: null,
        modifiedCount: status.modifiedFiles.length,
        stagedCount: status.stagedFiles.length,
        untrackedCount: status.untrackedFiles.length,
        syncStatus,
      });

      const origin = remotes.find((r: { name: string; url: string }) => r.name === 'origin');
      if (origin) {
        setNewRemoteUrl(origin.url);
      }
    } catch (error) {
      setGitState(prev => ({
        ...prev,
        isLoading: false,
        error: `Failed to load git info: ${error}`,
      }));
    }
  }, [projectPath]);

  // Handle git init
  const handleInitGit = useCallback(async () => {
    if (!projectPath) return;
    setIsInitializing(true);
    try {
      await initRepository(projectPath);
      await loadGitInfo();
      onGitInit?.();
    } catch (error) {
      setGitState(prev => ({
        ...prev,
        error: `Failed to initialize git: ${error}`,
      }));
    } finally {
      setIsInitializing(false);
    }
  }, [projectPath, loadGitInfo, onGitInit]);

  // Load on mount and when project changes
  useEffect(() => {
    console.log('[GitSettings] projectPath changed:', projectPath);

    // IMMEDIATELY reset all state when project changes
    setNewRemoteUrl('');
    setSaveStatus('idle');
    setCopied(false);
    setGitState({
      repoState: 'none',
      parentRepoPath: null,
      remotes: [],
      currentBranch: null,
      isLoading: true, // Show loading while we fetch new data
      error: null,
      modifiedCount: 0,
      stagedCount: 0,
      untrackedCount: 0,
      syncStatus: null,
    });

    // Then load the new project's git info
    loadGitInfo();
  }, [projectPath, loadGitInfo]);

  // Handle remote URL change
  const handleSaveRemote = useCallback(async () => {
    if (!projectPath || !newRemoteUrl.trim()) return;

    setIsSaving(true);
    setSaveStatus('idle');

    try {
      await setRemoteUrl(projectPath, newRemoteUrl.trim(), 'origin');
      setSaveStatus('success');
      await loadGitInfo();

      // Reset status after delay
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to set remote:', error);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [projectPath, newRemoteUrl, loadGitInfo]);

  // Copy current remote URL
  const handleCopyUrl = useCallback(async () => {
    const origin = gitState.remotes.find(r => r.name === 'origin');
    if (origin) {
      await navigator.clipboard.writeText(origin.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [gitState.remotes]);

  // No project selected
  if (!projectPath) {
    return null;
  }

  const originRemote = gitState.remotes.find(r => r.name === 'origin');
  const hasLocalOrRemote = gitState.repoState === 'local' || gitState.repoState === 'remote';

  // Total changes count for header badge
  const totalChanges = gitState.modifiedCount + gitState.stagedCount + gitState.untrackedCount;

  // Status badge based on state
  const getStatusBadge = () => {
    switch (gitState.repoState) {
      case 'remote':
        return <span className="git-branch-badge git-status-remote">{gitState.currentBranch || 'remote'}</span>;
      case 'local':
        return <span className="git-branch-badge git-status-local">{gitState.currentBranch || 'local'}</span>;
      case 'parent':
        return <span className="git-branch-badge git-status-warning">parent</span>;
      default:
        return <span className="git-branch-badge git-status-none">none</span>;
    }
  };

  // Sync status indicators (ahead/behind)
  const getSyncIndicators = () => {
    if (!gitState.syncStatus || !gitState.syncStatus.hasRemote) return null;

    const { ahead, behind } = gitState.syncStatus;
    if (ahead === 0 && behind === 0) return null;

    return (
      <div className="git-sync-indicators">
        {ahead > 0 && (
          <span className="git-sync-ahead" title={`${ahead} commit(s) ahead of remote`}>
            <ArrowUp size={10} />
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="git-sync-behind" title={`${behind} commit(s) behind remote`}>
            <ArrowDown size={10} />
            {behind}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="git-settings">
      <div
        className="git-settings-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <GitBranch size={14} className="git-settings-icon" />
        <span className="git-settings-title">GIT</span>

        {getStatusBadge()}

        {/* Change count badge */}
        {hasLocalOrRemote && totalChanges > 0 && (
          <span className="git-changes-badge" title={`${totalChanges} pending change(s)`}>
            {totalChanges}
          </span>
        )}

        {/* Sync indicators */}
        {getSyncIndicators()}

        <button
          className="git-refresh-btn"
          onClick={(e) => {
            e.stopPropagation();
            loadGitInfo();
          }}
          disabled={gitState.isLoading}
          title="Refresh"
        >
          <RefreshCw size={12} className={gitState.isLoading ? 'animate-spin' : ''} />
        </button>

        <ChevronDown
          size={12}
          className={`git-expand-icon ${isExpanded ? 'expanded' : ''}`}
        />
      </div>

      {isExpanded && (
        <div className="git-settings-content">
          {/* Loading */}
          {gitState.isLoading && (
            <div className="git-loading">
              <Loader2 size={16} className="animate-spin" />
              <span>Loading...</span>
            </div>
          )}

          {/* Error */}
          {gitState.error && (
            <div className="git-error">
              <AlertCircle size={14} />
              <span>{gitState.error}</span>
            </div>
          )}

          {/* No repo - show init button */}
          {!gitState.isLoading && gitState.repoState === 'none' && (
            <div className="git-no-repo">
              <div className="git-no-repo-message">
                <FolderGit2 size={16} />
                <span>No git repository</span>
              </div>
              <p className="git-no-repo-hint">
                Initialize git to enable snapshots and version control.
              </p>
              <button
                className="git-init-btn"
                onClick={handleInitGit}
                disabled={isInitializing}
              >
                {isInitializing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Initializing...</span>
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    <span>Initialize Git</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Parent repo warning */}
          {!gitState.isLoading && gitState.repoState === 'parent' && (
            <div className="git-parent-warning">
              <div className="git-warning-header">
                <AlertTriangle size={14} />
                <span>Git in parent directory</span>
              </div>
              <p className="git-warning-text">
                Found repo at: <code>{gitState.parentRepoPath}</code>
              </p>
              <p className="git-warning-hint">
                This project doesn't have its own git. Create one for snapshots?
              </p>
              <button
                className="git-init-btn"
                onClick={handleInitGit}
                disabled={isInitializing}
              >
                {isInitializing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Initializing...</span>
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    <span>Initialize Git Here</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Has local repo */}
          {!gitState.isLoading && hasLocalOrRemote && (
            <>
              {/* Changes summary */}
              {totalChanges > 0 && (
                <div className="git-changes-summary">
                  <div className="git-changes-title">Pending Changes</div>
                  <div className="git-changes-list">
                    {gitState.stagedCount > 0 && (
                      <div className="git-change-item git-staged">
                        <FileCheck size={12} />
                        <span>{gitState.stagedCount} staged</span>
                      </div>
                    )}
                    {gitState.modifiedCount > 0 && (
                      <div className="git-change-item git-modified">
                        <FileEdit size={12} />
                        <span>{gitState.modifiedCount} modified</span>
                      </div>
                    )}
                    {gitState.untrackedCount > 0 && (
                      <div className="git-change-item git-untracked">
                        <FilePlus size={12} />
                        <span>{gitState.untrackedCount} untracked</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sync status details */}
              {gitState.syncStatus?.hasRemote && (
                <div className="git-sync-summary">
                  {gitState.syncStatus.ahead === 0 && gitState.syncStatus.behind === 0 ? (
                    <div className="git-sync-status git-synced">
                      <Check size={12} />
                      <span>Up to date with {gitState.syncStatus.remoteBranch}</span>
                    </div>
                  ) : (
                    <div className="git-sync-status git-out-of-sync">
                      {gitState.syncStatus.ahead > 0 && (
                        <span className="git-sync-detail">
                          <ArrowUp size={12} />
                          {gitState.syncStatus.ahead} to push
                        </span>
                      )}
                      {gitState.syncStatus.behind > 0 && (
                        <span className="git-sync-detail">
                          <ArrowDown size={12} />
                          {gitState.syncStatus.behind} to pull
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Local-only indicator */}
              {gitState.repoState === 'local' && !originRemote && (
                <div className="git-local-only">
                  <FolderGit2 size={12} />
                  <span>Local repository (snapshots enabled)</span>
                </div>
              )}

              {/* Current remote */}
              {originRemote && (
                <div className="git-remote-info">
                  <div className="git-remote-label">
                    <Globe size={12} />
                    <span>Origin</span>
                    <button
                      className="git-copy-btn"
                      onClick={handleCopyUrl}
                      title="Copy URL"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div className="git-remote-url">{originRemote.url}</div>
                </div>
              )}

              {/* Add/Change remote form */}
              <div className="git-change-remote">
                <label className="git-input-label">
                  {originRemote ? 'Change Remote URL' : 'Add Remote (origin)'}
                </label>
                <div className="git-input-row">
                  <input
                    type="text"
                    className="git-remote-input"
                    value={newRemoteUrl}
                    onChange={(e) => setNewRemoteUrl(e.target.value)}
                    placeholder="https://github.com/user/repo.git"
                  />
                  <button
                    className="git-save-btn"
                    onClick={handleSaveRemote}
                    disabled={isSaving || !newRemoteUrl.trim()}
                  >
                    {isSaving ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : saveStatus === 'success' ? (
                      <Check size={14} />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                </div>

                {saveStatus === 'success' && (
                  <div className="git-save-success">Remote updated!</div>
                )}

                {saveStatus === 'error' && (
                  <div className="git-save-error">Failed to update remote</div>
                )}
              </div>

              {/* Other remotes */}
              {gitState.remotes.filter(r => r.name !== 'origin').length > 0 && (
                <div className="git-other-remotes">
                  <div className="git-section-title">Other Remotes</div>
                  {gitState.remotes
                    .filter(r => r.name !== 'origin')
                    .map(remote => (
                      <div key={remote.name} className="git-remote-item">
                        <span className="git-remote-name">{remote.name}</span>
                        <span className="git-remote-url-small">{remote.url}</span>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
