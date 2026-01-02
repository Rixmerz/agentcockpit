/**
 * Git Settings Component
 *
 * Easy change repository remote URL feature.
 * Allows users to reconfigure origin URL quickly.
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
} from 'lucide-react';
import {
  setRemoteUrl,
  listRemotes,
  getGitStatus,
  isGitRepository,
} from '../../services/gitService';

interface GitSettingsProps {
  projectPath: string | null;
}

interface GitState {
  isRepo: boolean;
  remotes: Array<{ name: string; url: string }>;
  currentBranch: string | null;
  isLoading: boolean;
  error: string | null;
}

export function GitSettings({ projectPath }: GitSettingsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [gitState, setGitState] = useState<GitState>({
    isRepo: false,
    remotes: [],
    currentBranch: null,
    isLoading: false,
    error: null,
  });

  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  // Load git info
  const loadGitInfo = useCallback(async () => {
    if (!projectPath) {
      setGitState({
        isRepo: false,
        remotes: [],
        currentBranch: null,
        isLoading: false,
        error: null,
      });
      return;
    }

    setGitState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const isRepo = await isGitRepository(projectPath);

      if (!isRepo) {
        setGitState({
          isRepo: false,
          remotes: [],
          currentBranch: null,
          isLoading: false,
          error: null,
        });
        return;
      }

      const [remotes, status] = await Promise.all([
        listRemotes(projectPath),
        getGitStatus(projectPath),
      ]);

      setGitState({
        isRepo: true,
        remotes,
        currentBranch: status.branch,
        isLoading: false,
        error: null,
      });

      // Set default remote URL if origin exists
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

  // Load on mount and when project changes
  useEffect(() => {
    console.log('[GitSettings] projectPath changed:', projectPath);
    setNewRemoteUrl(''); // Reset remote URL when project changes
    setSaveStatus('idle');
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

  return (
    <div className="git-settings">
      <div
        className="git-settings-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <GitBranch size={14} className="git-settings-icon" />
        <span className="git-settings-title">GIT</span>

        {gitState.isRepo && gitState.currentBranch && (
          <span className="git-branch-badge">{gitState.currentBranch}</span>
        )}

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

          {/* Not a repo */}
          {!gitState.isLoading && !gitState.isRepo && (
            <div className="git-not-repo">
              <AlertCircle size={14} />
              <span>Not a git repository</span>
            </div>
          )}

          {/* Error */}
          {gitState.error && (
            <div className="git-error">
              <AlertCircle size={14} />
              <span>{gitState.error}</span>
            </div>
          )}

          {/* Git info */}
          {!gitState.isLoading && gitState.isRepo && (
            <>
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

              {/* Change remote form */}
              <div className="git-change-remote">
                <label className="git-input-label">Change Remote URL</label>
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
