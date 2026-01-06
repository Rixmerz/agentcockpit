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
import { SessionManager } from './SessionManager';
import { PortMonitor } from './PortMonitor';
import { GitSettings } from './GitSettings';
import { SettingsModal } from '../settings/SettingsModal';
import { GitHubLoginModal } from '../sidebar-left/GitHubLoginModal';
import { createSession, updateSessionLastUsed, getSessions, markSessionAsPreExisting, type ProjectSession } from '../../services/projectSessionService';
import { buildClaudeCommand } from '../../services/claudeService';
import { executeAction } from '../../core/utils/terminalCommands';
import { getCurrentUser, type GitHubUser } from '../../services/githubService';
import type { McpServerInfo } from '../../plugins/types/plugin';

interface ActionsPanelProps {
  projectPath: string | null;
  terminalId: string | null;
  hasActiveTerminal: boolean;
  onWriteToTerminal: (data: string) => Promise<void>;
  availableIDEs: string[];
}

export function ActionsPanel({
  projectPath,
  terminalId,
  hasActiveTerminal,
  onWriteToTerminal,
  availableIDEs,
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

  // Ensure session exists BEFORE building command
  const ensureSession = useCallback(async (): Promise<ProjectSession | null> => {
    console.log('[ActionsPanel] ensureSession called', {
      projectPath,
      hasSession: !!selectedSession
    });

    if (!projectPath) {
      console.log('[ActionsPanel] No projectPath, returning null');
      return null;
    }

    // Return existing session if available
    if (selectedSession) {
      console.log('[ActionsPanel] Using existing session:', selectedSession.id);
      try {
        await updateSessionLastUsed(projectPath, selectedSession.id, terminalId || undefined);
      } catch (error) {
        console.warn('[ActionsPanel] Failed to update session lastUsed:', error);
        // Non-fatal, continue with session
      }
      return selectedSession;
    }

    // Try to load existing sessions from JSON file
    console.log('[ActionsPanel] No session selected, checking for existing sessions');
    try {
      const existingSessions = await getSessions(projectPath);

      if (existingSessions.length > 0) {
        // Use most recent existing session (already marked as wasPreExisting: true from JSON)
        const mostRecent = existingSessions[0];
        console.log('[ActionsPanel] Found existing session in JSON, using:', mostRecent.id);
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
      // Continue to create new session if loading fails
    }

    // No existing sessions found - create new one (wasPreExisting=false → uses --session-id)
    console.log('[ActionsPanel] No existing sessions, creating new one for project:', projectPath);
    try {
      const newSession = await createSession(projectPath);
      console.log('[ActionsPanel] New session created:', newSession.id);
      setSelectedSession(newSession);
      setSessionError(null);
      try {
        await updateSessionLastUsed(projectPath, newSession.id, terminalId || undefined);
      } catch (error) {
        console.warn('[ActionsPanel] Failed to update new session lastUsed:', error);
      }
      return newSession;
    } catch (error) {
      console.error('[ActionsPanel] Failed to create session:', error);
      const errorMsg = error instanceof Error ? error.message : 'Error desconocido al crear sesión';
      setSessionError(errorMsg);
      return null;
    }
  }, [selectedSession, projectPath, terminalId]);

  // Handle launch command from plugin
  const handleLaunch = useCallback(async (command: string) => {
    await onWriteToTerminal(command + '\n');
  }, [onWriteToTerminal]);

  // Handle session creation - auto-launch Claude to persist session
  const handleSessionCreated = useCallback(async (session: ProjectSession) => {
    setSelectedSession(session);

    // Auto-launch only if we have an active terminal and project
    if (!hasActiveTerminal || !projectPath) {
      console.log('[ActionsPanel] Cannot auto-launch: no terminal or project');
      return;
    }

    console.log('[ActionsPanel] Auto-launching Claude for new session:', session.id);

    // Build command with --session-id (new session)
    const claudeCommand = buildClaudeCommand({
      sessionId: session.id,
      resume: false, // New session, use --session-id
    });

    // Build full command with MCP operations
    const allCommands: string[] = [];
    if (mcpsToRemove.length > 0) {
      allCommands.push(...mcpsToRemove.map(name =>
        `claude mcp remove "${name}" 2>/dev/null || true`
      ));
    }
    if (mcpsToInject.length > 0) {
      allCommands.push(...mcpsToInject.map(mcp => {
        const jsonConfig = JSON.stringify(mcp.config);
        const escapedJson = jsonConfig.replace(/'/g, "'\"'\"'");
        return `claude mcp add-json "${mcp.name}" '${escapedJson}' -s user 2>/dev/null || true`;
      }));
    }
    allCommands.push(claudeCommand);

    const fullCommand = allCommands.join(' ; ');

    // Launch Claude
    await onWriteToTerminal(fullCommand + '\n');

    // Wait for Claude to initialize (2 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Send "hola" to persist the session (using executeAction for proper PTY interaction)
    await executeAction(onWriteToTerminal, 'hola');

    // Wait a bit for the message to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mark session as pre-existing so future launches use --resume
    try {
      await markSessionAsPreExisting(projectPath, session.id);
      // Update local state to reflect the change
      setSelectedSession(prev => prev ? { ...prev, wasPreExisting: true } : prev);
      console.log('[ActionsPanel] Session persisted and marked as pre-existing');
    } catch (error) {
      console.error('[ActionsPanel] Failed to mark session as pre-existing:', error);
    }
  }, [hasActiveTerminal, projectPath, mcpsToRemove, mcpsToInject, onWriteToTerminal]);

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
        <h2>AGENTES</h2>
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
            title={gitHubUser ? `@${gitHubUser.login}` : 'Iniciar sesión con GitHub'}
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
            title="Configuración"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Session Error Display */}
      {sessionError && (
        <div className="session-error" style={{
          padding: '12px',
          margin: '8px',
          borderRadius: '6px',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px' }}>Error de Sesión</div>
              <div style={{ fontSize: '11px', opacity: 0.9 }}>{sessionError}</div>
              <button
                style={{
                  fontSize: '11px',
                  textDecoration: 'underline',
                  marginTop: '8px',
                  opacity: 0.7,
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: 0
                }}
                onClick={() => setSessionError(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
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
            />
          )}

          {/* MCP Panel */}
          {activePlugin.McpPanel && (
            <activePlugin.McpPanel
              projectPath={projectPath}
              onMcpsChange={handleMcpsChange}
              // Legacy props for backwards compatibility
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
            No hay agentes instalados.
            <br />
            <span className="text-xs opacity-60">
              Instala Claude CLI: <code>npm install -g @anthropic-ai/claude-code</code>
            </span>
          </div>
        </div>
      )}

      {/* Core Components (always visible) */}
      <SessionManager
        projectPath={projectPath}
        selectedSession={selectedSession}
        onSessionSelect={setSelectedSession}
        onSessionCreated={handleSessionCreated}
      />

      <PortMonitor />

      <GitSettings projectPath={projectPath} />
    </div>
  );
}
