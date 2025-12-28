/**
 * Actions Panel
 *
 * Main sidebar-right container with plugin-based agent integration.
 * Renders AgentTabs for plugin selection and active plugin components.
 */

import { useState, useCallback } from 'react';
import { Settings } from 'lucide-react';
import { usePlugins } from '../../plugins/context/PluginContext';
import { AgentTabs } from '../../core/components/AgentTabs';
import { SessionManager } from './SessionManager';
import { PortMonitor } from './PortMonitor';
import { SettingsModal } from '../settings/SettingsModal';
import { createSession, updateSessionLastUsed, type ProjectSession } from '../../services/projectSessionService';
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
  const [mcpsToInject, setMcpsToInject] = useState<McpServerInfo[]>([]);
  const [mcpsToRemove, setMcpsToRemove] = useState<string[]>([]);
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // Ensure session exists BEFORE building command
  const ensureSession = useCallback(async (): Promise<ProjectSession | null> => {
    if (!projectPath) return null;

    // Return existing session if available
    if (selectedSession) {
      await updateSessionLastUsed(projectPath, selectedSession.id, terminalId || undefined);
      return selectedSession;
    }

    // Auto-create new session (wasPreExisting=false → uses --session-id)
    const newSession = await createSession(projectPath);
    setSelectedSession(newSession);
    await updateSessionLastUsed(projectPath, newSession.id, terminalId || undefined);
    return newSession;
  }, [selectedSession, projectPath, terminalId]);

  // Handle launch command from plugin
  const handleLaunch = useCallback(async (command: string) => {
    await onWriteToTerminal(command + '\n');
  }, [onWriteToTerminal]);

  // Handle session creation
  const handleSessionCreated = useCallback((session: ProjectSession) => {
    setSelectedSession(session);
  }, []);

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

      {/* Sidebar Right Header */}
      <div className="sidebar-right-header">
        <h2>AGENTES</h2>
        <button
          className="settings-btn"
          onClick={() => setShowSettings(true)}
          title="Configuración"
        >
          <Settings size={16} />
        </button>
      </div>

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
    </div>
  );
}
