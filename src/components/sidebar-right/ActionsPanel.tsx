/**
 * Actions Panel
 *
 * Main sidebar-right container with plugin-based agent integration.
 * Renders AgentTabs for plugin selection and active plugin components.
 */

import { useState, useCallback, useEffect } from 'react';
import { Settings, Github } from 'lucide-react';
import { usePlugins } from '../../plugins/context/PluginContext';
import { AgentTabs } from '../../core/components/AgentTabs';
import { SessionManager } from '../../agents/claude/components/SessionManager';
import { SettingsModal } from '../settings/SettingsModal';
import { GitHubLoginModal } from '../sidebar-left/GitHubLoginModal';
import { updateSessionLastUsed, getSessions, createSessionFromResume, type ProjectSession } from '../../services/projectSessionService';
import { getCurrentUser, type GitHubUser } from '../../services/githubService';
import { sessionEvents } from '../../core/utils/eventBus';
import { ErrorBanner } from '../common/ErrorBanner';
import { IndexDashboardPanel } from '../index-panel/IndexDashboardPanel';
import type { McpServerInfo } from '../../plugins/types/plugin';

interface ActionsPanelProps {
  projectPath: string | null;
  terminalId: string | null;
  hasActiveTerminal: boolean;
  onWriteToTerminal: (data: string) => Promise<void>;
  availableIDEs: string[];
  onModalStateChange?: (isOpen: boolean) => void;
}

export function ActionsPanel({
  projectPath,
  terminalId,
  hasActiveTerminal,
  onWriteToTerminal,
  availableIDEs,
  onModalStateChange,
}: ActionsPanelProps) {
  // Plugin context
  const { installedPlugins, activePlugin, setActivePlugin } = usePlugins();

  // Local state
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [mcpsToInject, setMcpsToInject] = useState<McpServerInfo[]>([]);
  const [mcpsToRemove, setMcpsToRemove] = useState<string[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showGitHubLogin, setShowGitHubLogin] = useState(false);
  const [gitHubUser, setGitHubUser] = useState<GitHubUser | null>(null);
  const [skipPermissions, setSkipPermissions] = useState(false);

  // Notify parent when any modal is open
  useEffect(() => {
    const anyModalOpen = showSettings || showGitHubLogin;
    onModalStateChange?.(anyModalOpen);
  }, [showSettings, showGitHubLogin, onModalStateChange]);

  // Clear session when project changes (fixes ghost session bug)
  useEffect(() => {
    setSelectedSession(null);
    setSessionError(null);
  }, [projectPath]);

  // Load GitHub user on mount (non-blocking)
  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then(user => {
        if (!cancelled && user) {
          setGitHubUser(user);
        }
      })
      .catch(err => {
        console.warn('[ActionsPanel] Failed to load GitHub user on mount:', err);
      });
    return () => { cancelled = true; };
  }, []);

  // Return selected session or try to load most recent. Returns null for new sessions.
  const ensureSession = useCallback(async (): Promise<ProjectSession | null> => {
    if (!projectPath) return null;

    // Return existing selected session
    if (selectedSession) {
      try {
        await updateSessionLastUsed(projectPath, selectedSession.id, terminalId || undefined);
      } catch (error) {
        console.warn('[ActionsPanel] Failed to update session lastUsed:', error);
      }
      return selectedSession;
    }

    // Try to load most recent session from config
    try {
      const existingSessions = await getSessions(projectPath);
      if (existingSessions.length > 0) {
        const mostRecent = existingSessions[0];
        setSelectedSession(mostRecent);
        setSessionError(null);
        try {
          await updateSessionLastUsed(projectPath, mostRecent.id, terminalId || undefined);
        } catch (error) {
          console.warn('[ActionsPanel] Failed to update session lastUsed:', error);
        }
        return mostRecent;
      }
    } catch (error) {
      console.warn('[ActionsPanel] Failed to load existing sessions:', error);
    }

    // No session → Claude will launch fresh, UUID captured from resume output
    return null;
  }, [selectedSession, projectPath, terminalId]);

  // Handle launch command from plugin
  const handleLaunch = useCallback(async (command: string) => {
    await onWriteToTerminal(command + '\n');
  }, [onWriteToTerminal]);

  // Listen for resume UUID detected in terminal output
  useEffect(() => {
    return sessionEvents.on('resume-detected', async ({ uuid, terminalId: tid }) => {
      if (!projectPath) return;
      console.log('[ActionsPanel] Resume UUID detected:', uuid, 'terminal:', tid);
      try {
        const session = await createSessionFromResume(projectPath, uuid, tid);
        setSelectedSession(session);
        setSessionError(null);
      } catch (error) {
        console.error('[ActionsPanel] Failed to create session from resume:', error);
      }
    });
  }, [projectPath]);

  // Handle MCP changes from plugin
  const handleMcpsChange = useCallback((toInject: McpServerInfo[], toRemove: string[]) => {
    setMcpsToInject(toInject);
    setMcpsToRemove(toRemove);
  }, []);

  // Legacy compatibility for McpPanel props
  const handleMcpsForInjection = useCallback((mcps: McpServerInfo[]) => {
    setMcpsToInject(mcps);
  }, []);

  const handleMcpsForRemoval = useCallback((names: string[]) => {
    setMcpsToRemove(names);
  }, []);

  return (
    <div className="actions-panel sidebar-right">
      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        availableIDEs={availableIDEs}
      />

      {/* GitHub Login Modal */}
      <GitHubLoginModal
        isOpen={showGitHubLogin}
        onClose={() => setShowGitHubLogin(false)}
        onLogin={(user) => setGitHubUser(user)}
      />

      {/* Sidebar Right Header */}
      <div className="sidebar-right-header">
        <h2>AGENTS</h2>
        <div className="header-actions">
          {/* GitHub Button / Avatar */}
          <button
            className={`github-btn ${gitHubUser ? 'logged-in' : ''}`}
            onClick={async () => {
              // Lazy load user status when button is clicked
              if (!gitHubUser) {
                try {
                  const user = await getCurrentUser();
                  if (user) setGitHubUser(user);
                } catch (err) {
                  console.warn('[ActionsPanel] Failed to get GitHub user:', err);
                }
              }
              setShowGitHubLogin(true);
            }}
            title={gitHubUser ? `@${gitHubUser.login}` : 'Sign in with GitHub'}
          >
            {gitHubUser ? (
              <img
                src={gitHubUser.avatar_url}
                alt={gitHubUser.login}
                className="github-avatar-btn"
              />
            ) : (
              <Github size={16} />
            )}
          </button>
          {/* Settings Button */}
          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Session Error Display */}
      {sessionError && (
        <ErrorBanner message={sessionError} onClose={() => setSessionError(null)} />
      )}

      {/* Agent Tabs */}
      <AgentTabs
        plugins={installedPlugins}
        activePluginId={activePlugin?.manifest.id ?? null}
        onSelect={setActivePlugin}
      />

      {/* Active Plugin Content */}
      {activePlugin && (
        <div className="plugin-content">
          {/* Quick Actions */}
          {activePlugin.QuickActions && (
            <activePlugin.QuickActions
              onWriteToTerminal={onWriteToTerminal}
              disabled={!hasActiveTerminal}
            />
          )}

          {/* Launcher */}
          {activePlugin.Launcher && (
            <activePlugin.Launcher
              projectPath={projectPath}
              session={selectedSession}
              hasActiveTerminal={hasActiveTerminal}
              mcpsToInject={mcpsToInject}
              mcpsToRemove={mcpsToRemove}
              ensureSession={ensureSession}
              onLaunch={handleLaunch}
              onWriteToTerminal={onWriteToTerminal}
              skipPermissions={skipPermissions}
              onSkipPermissionsChange={setSkipPermissions}
            />
          )}

          {/* MCP Panel - always show if plugin provides one */}
          {activePlugin.McpPanel && (
            <activePlugin.McpPanel
              projectPath={projectPath}
              onMcpsChange={handleMcpsChange}
              // Legacy props for backwards compatibility (Claude)
              selectedServers={selectedMcpServers}
              onSelectionChange={setSelectedMcpServers}
              onMcpsForInjection={handleMcpsForInjection}
              onMcpsForRemoval={handleMcpsForRemoval}
            />
          )}
        </div>
      )}

      {/* No plugins installed */}
      {installedPlugins.length === 0 && (
        <div className="panel-section">
          <div className="text-center text-sm text-muted p-4">
            No agents installed.
            <br />
            <span className="text-xs opacity-60">
              Install Claude CLI: <code>npm install -g @anthropic-ai/claude-code</code>
            </span>
          </div>
        </div>
      )}

      {/* Claude-specific components: Sessions */}
      {activePlugin?.manifest.id === 'claude' && (
        <SessionManager
          projectPath={projectPath}
          selectedSession={selectedSession}
          onSessionSelect={setSelectedSession}
        />
      )}

      {/* IndexDashboardPanel */}
      <IndexDashboardPanel projectPath={projectPath} />
    </div>
  );
}
