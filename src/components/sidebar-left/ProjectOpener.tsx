/**
 * Project Opener
 *
 * Tabbed interface for opening projects:
 * - Local: Navigate filesystem and create project
 * - GitHub: Clone from GitHub repositories
 */

import { useState, useCallback, useEffect } from 'react';
import { FolderOpen, Github, Search, Lock, Globe, Loader2, Download, AlertCircle, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { PathNavigator } from './PathNavigator';
import {
  listRepositories,
  searchRepositories,
  cloneRepository,
  getCurrentUser,
  type GitHubRepo,
  type GitHubUser,
  GitHubAuthError,
} from '../../services/githubService';

interface ProjectOpenerProps {
  onCreateProject: (name: string, path: string) => void;
  onNeedLogin: () => void;
}

type Tab = 'local' | 'github';

type CloneState =
  | { status: 'idle' }
  | { status: 'cloning'; repo: GitHubRepo }
  | { status: 'success'; repo: GitHubRepo; path: string }
  | { status: 'error'; message: string };

const HOME = '/Users/juanpablodiaz';

export function ProjectOpener({ onCreateProject, onNeedLogin }: ProjectOpenerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('local');

  // GitHub state
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [clonePath, setClonePath] = useState(HOME);
  const [cloneState, setCloneState] = useState<CloneState>({ status: 'idle' });

  // Load GitHub data when tab switches
  useEffect(() => {
    if (activeTab === 'github') {
      loadUserAndRepos();
    }
  }, [activeTab]);

  // Update clone path when repo selected
  useEffect(() => {
    if (selectedRepo) {
      setClonePath(`${HOME}/${selectedRepo.name}`);
    }
  }, [selectedRepo]);

  const loadUserAndRepos = async () => {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      onNeedLogin();
      setActiveTab('local');
      return;
    }

    setUser(currentUser);
    setIsLoadingRepos(true);

    try {
      const userRepos = await listRepositories(undefined, {
        sort: 'updated',
        per_page: 30,
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
      loadUserAndRepos();
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchRepositories(searchQuery, undefined, 15);
      setRepos(results);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

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
      // Ensure parent directory exists
      const parentDir = clonePath.substring(0, clonePath.lastIndexOf('/'));
      await invoke<string>('execute_command', {
        cmd: `mkdir -p "${parentDir}"`,
        cwd: '/',
      });

      await cloneRepository(selectedRepo.clone_url, clonePath);

      setCloneState({ status: 'success', repo: selectedRepo, path: clonePath });

      // Create project after successful clone
      onCreateProject(selectedRepo.name, clonePath);

      // Reset after success
      setTimeout(() => {
        setSelectedRepo(null);
        setCloneState({ status: 'idle' });
      }, 2000);
    } catch (error) {
      const message =
        error instanceof GitHubAuthError ? error.message : 'Clone failed';
      setCloneState({ status: 'error', message });
    }
  }, [selectedRepo, clonePath, onCreateProject]);

  // Format relative time
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days > 30) return `${Math.floor(days / 30)}mo`;
    if (days > 0) return `${days}d`;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours > 0) return `${hours}h`;

    return 'now';
  };

  return (
    <div className="project-opener">
      {/* Tabs */}
      <div className="project-opener-tabs">
        <button
          className={`project-opener-tab ${activeTab === 'local' ? 'active' : ''}`}
          onClick={() => setActiveTab('local')}
        >
          <FolderOpen size={14} />
          Local
        </button>
        <button
          className={`project-opener-tab ${activeTab === 'github' ? 'active' : ''}`}
          onClick={() => setActiveTab('github')}
        >
          <Github size={14} />
          GitHub
        </button>
      </div>

      {/* Content */}
      <div className="project-opener-content">
        {activeTab === 'local' && (
          <PathNavigator onCreateProject={onCreateProject} />
        )}

        {activeTab === 'github' && (
          <div className="github-panel">
            {/* User info */}
            {user && (
              <div className="github-user-mini">
                <img src={user.avatar_url} alt={user.login} />
                <span>@{user.login}</span>
              </div>
            )}

            {/* Search */}
            <div className="github-search-inline">
              <Search size={14} />
              <input
                type="text"
                placeholder="Search repositories..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              {(isSearching || isLoadingRepos) && (
                <Loader2 size={14} className="animate-spin" />
              )}
            </div>

            {/* Repo list */}
            <div className="github-repo-list-inline">
              {repos.length === 0 && !isLoadingRepos && (
                <div className="github-empty-inline">
                  No repositories
                </div>
              )}

              {repos.map(repo => (
                <button
                  key={repo.id}
                  className={`github-repo-item-inline ${selectedRepo?.id === repo.id ? 'selected' : ''}`}
                  onClick={() => setSelectedRepo(repo)}
                >
                  <div className="repo-main">
                    <span className="repo-name">{repo.name}</span>
                    {repo.private ? (
                      <Lock size={10} className="repo-visibility private" />
                    ) : (
                      <Globe size={10} className="repo-visibility public" />
                    )}
                  </div>
                  <span className="repo-updated">{formatDate(repo.updated_at)}</span>
                </button>
              ))}
            </div>

            {/* Clone section */}
            {selectedRepo && (
              <div className="github-clone-inline">
                <div className="clone-path-input">
                  <FolderOpen size={12} />
                  <input
                    type="text"
                    value={clonePath}
                    onChange={e => setClonePath(e.target.value)}
                    placeholder="Destination path..."
                  />
                </div>

                {cloneState.status === 'error' && (
                  <div className="clone-error">
                    <AlertCircle size={12} />
                    <span>{cloneState.message}</span>
                  </div>
                )}

                {cloneState.status === 'success' && (
                  <div className="clone-success">
                    <Check size={12} />
                    <span>Cloned successfully</span>
                  </div>
                )}

                <button
                  className="btn-clone"
                  onClick={handleClone}
                  disabled={cloneState.status === 'cloning'}
                >
                  {cloneState.status === 'cloning' ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Cloning...
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      Clone {selectedRepo.name}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
