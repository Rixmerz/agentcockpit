/**
 * GitHub Clone Modal
 *
 * UI for cloning repositories from GitHub.
 * Lists user's repos and allows searching.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Github,
  Search,
  Lock,
  Globe,
  Loader2,
  X,
  FolderOpen,
  Download,
  AlertCircle,
  Star,
} from 'lucide-react';
import {
  listRepositories,
  searchRepositories,
  cloneRepository,
  getCurrentUser,
  type GitHubRepo,
  type GitHubUser,
  GitHubAuthError,
} from '../../services/githubService';

interface GitHubCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCloned: (name: string, path: string) => void;
  basePath: string;
  onNeedLogin: () => void;
}

type CloneState =
  | { status: 'idle' }
  | { status: 'cloning'; repo: GitHubRepo }
  | { status: 'success'; repo: GitHubRepo; path: string }
  | { status: 'error'; message: string };

export function GitHubCloneModal({
  isOpen,
  onClose,
  onCloned,
  basePath,
  onNeedLogin,
}: GitHubCloneModalProps) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [cloneState, setCloneState] = useState<CloneState>({ status: 'idle' });
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [customPath, setCustomPath] = useState('');

  // Load user and repos on mount
  useEffect(() => {
    if (isOpen) {
      loadUserAndRepos();
    }
  }, [isOpen]);

  // Update custom path when repo selected
  useEffect(() => {
    if (selectedRepo) {
      setCustomPath(`${basePath}/${selectedRepo.name}`);
    }
  }, [selectedRepo, basePath]);

  const loadUserAndRepos = async () => {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      onNeedLogin();
      return;
    }

    setUser(currentUser);
    setIsLoadingRepos(true);

    try {
      const userRepos = await listRepositories(undefined, {
        sort: 'updated',
        per_page: 50,
      });
      setRepos(userRepos);
    } catch (error) {
      console.error('Failed to load repos:', error);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  // Search repositories
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      // Reset to user's repos
      loadUserAndRepos();
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchRepositories(searchQuery, undefined, 20);
      setRepos(results);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  // Handle search on Enter
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSearch();
      }
    },
    [handleSearch]
  );

  // Clone repository
  const handleClone = useCallback(async () => {
    if (!selectedRepo) return;

    setCloneState({ status: 'cloning', repo: selectedRepo });

    try {
      const targetPath = customPath || `${basePath}/${selectedRepo.name}`;
      await cloneRepository(selectedRepo.clone_url, targetPath);

      setCloneState({ status: 'success', repo: selectedRepo, path: targetPath });
      onCloned(selectedRepo.name, targetPath);

      // Auto-close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (error) {
      const message =
        error instanceof GitHubAuthError ? error.message : 'Clone failed';
      setCloneState({ status: 'error', message });
    }
  }, [selectedRepo, customPath, basePath, onCloned]);

  // Reset and close
  const handleClose = useCallback(() => {
    setSearchQuery('');
    setSelectedRepo(null);
    setCloneState({ status: 'idle' });
    setCustomPath('');
    onClose();
  }, [onClose]);

  // Format relative time
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 30) return `${Math.floor(days / 30)}mo ago`;
    if (days > 0) return `${days}d ago`;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours > 0) return `${hours}h ago`;

    return 'Just now';
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-container github-clone-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <Github size={20} />
            Clone Repository
          </h2>
          <button className="modal-close-btn" onClick={handleClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-content">
          {/* User info */}
          {user && (
            <div className="github-user-bar">
              <img src={user.avatar_url} alt={user.login} className="github-avatar-sm" />
              <span>@{user.login}</span>
            </div>
          )}

          {/* Search bar */}
          <div className="github-search-bar">
            <Search size={16} className="github-search-icon" />
            <input
              type="text"
              className="github-search-input"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {(isSearching || isLoadingRepos) && (
              <Loader2 size={16} className="animate-spin github-search-loader" />
            )}
          </div>

          {/* Repository list */}
          <div className="github-repo-list">
            {repos.length === 0 && !isLoadingRepos && (
              <div className="github-empty">
                <p>No repositories found</p>
              </div>
            )}

            {repos.map(repo => (
              <button
                key={repo.id}
                className={`github-repo-item ${selectedRepo?.id === repo.id ? 'selected' : ''}`}
                onClick={() => setSelectedRepo(repo)}
              >
                <div className="github-repo-header">
                  <span className="github-repo-name">{repo.name}</span>
                  {repo.private ? (
                    <Lock size={12} className="github-repo-visibility private" />
                  ) : (
                    <Globe size={12} className="github-repo-visibility public" />
                  )}
                </div>
                {repo.description && (
                  <p className="github-repo-description">{repo.description}</p>
                )}
                <div className="github-repo-meta">
                  <span className="github-repo-fullname">{repo.full_name}</span>
                  <span className="github-repo-updated">{formatDate(repo.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Clone panel */}
          {selectedRepo && (
            <div className="github-clone-panel">
              <div className="github-clone-path">
                <FolderOpen size={14} />
                <input
                  type="text"
                  className="github-path-input"
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  placeholder="Clone path..."
                />
              </div>

              {cloneState.status === 'error' && (
                <div className="github-clone-error">
                  <AlertCircle size={14} />
                  <span>{cloneState.message}</span>
                </div>
              )}

              {cloneState.status === 'success' && (
                <div className="github-clone-success">
                  <Star size={14} />
                  <span>Successfully cloned!</span>
                </div>
              )}

              <button
                className="btn-primary github-clone-btn"
                onClick={handleClone}
                disabled={cloneState.status === 'cloning'}
              >
                {cloneState.status === 'cloning' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Cloning...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Clone {selectedRepo.name}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
