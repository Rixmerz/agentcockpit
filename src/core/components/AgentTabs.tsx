/**
 * Agent Tabs
 *
 * Horizontal tab bar for switching between agent plugins.
 * Features wave/pulse animation from active tab.
 * Shows placeholders for known but uninstalled agents.
 */

import { clsx } from 'clsx';
import type { AgentPlugin } from '../../plugins/types/plugin';

// Known agent CLIs - shown as placeholders if not installed
const KNOWN_AGENTS = [
  { id: 'claude', name: 'Claude Code', color: '#D97757', icon: '🤖' },
  { id: 'cursor-agent', name: 'Cursor Agent', color: '#FFFFFF', icon: '▶' },
  { id: 'gemini-cli', name: 'Gemini CLI', color: '#3186FF', icon: '✦' },
  { id: 'kiro', name: 'Kiro', color: '#00D4AA', icon: '◆' },
  { id: 'aider', name: 'Aider', color: '#A855F7', icon: '⬡' },
  { id: 'codex', name: 'Codex CLI', color: '#10B981', icon: '◈' },
  { id: 'cline', name: 'Cline', color: '#F59E0B', icon: '◇' },
];

interface AgentTabsProps {
  plugins: AgentPlugin[];
  activePluginId: string | null;
  onSelect: (pluginId: string) => void;
}

export function AgentTabs({ plugins, activePluginId, onSelect }: AgentTabsProps) {
  // Build combined list: installed plugins + placeholders for uninstalled known agents
  const installedIds = new Set(plugins.map(p => p.manifest.id));

  const allTabs = [
    // Installed plugins first (in their original order)
    ...plugins.map(plugin => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      color: plugin.manifest.color,
      icon: plugin.manifest.icon,
      installed: true,
      plugin,
    })),
    // Then placeholders for uninstalled known agents
    ...KNOWN_AGENTS
      .filter(agent => !installedIds.has(agent.id))
      .map(agent => ({
        id: agent.id,
        name: agent.name,
        color: agent.color,
        icon: agent.icon,
        installed: false,
        plugin: null,
      })),
  ];

  if (allTabs.length === 0) {
    return null;
  }

  // Find active plugin index and color
  const activeIndex = allTabs.findIndex(t => t.id === activePluginId);
  const activeColor = activeIndex >= 0 ? allTabs[activeIndex].color : '#00d4aa';

  return (
    <div
      className="agent-tabs"
      style={{
        '--active-plugin-color': activeColor,
        '--total-tabs': allTabs.length,
      } as React.CSSProperties}
    >
      {allTabs.map((tab, index) => {
        const isActive = tab.id === activePluginId;
        // Wave delay based on position (left to right flow)
        const waveDelay = index * 0.12; // 120ms between each tab

        return (
          <button
            key={tab.id}
            className={clsx('agent-tab', {
              'active': isActive,
              'agent-tab--down': index % 2 === 0,
              'agent-tab--up': index % 2 === 1,
              'agent-tab--wave': activeIndex >= 0,
              'agent-tab--placeholder': !tab.installed,
            })}
            onClick={() => tab.installed && onSelect(tab.id)}
            title={tab.installed ? tab.name : `${tab.name} (not installed)`}
            disabled={!tab.installed}
            style={{
              '--plugin-color': tab.color,
              '--wave-delay': `${waveDelay}s`,
              '--tab-index': index,
            } as React.CSSProperties}
          >
            {tab.installed && tab.plugin && (tab.icon.startsWith('/') || tab.icon.startsWith('http')) ? (
              <img
                src={tab.icon}
                alt={tab.name}
                className="agent-tab-icon"
              />
            ) : (
              <span className="agent-tab-emoji">{tab.installed ? tab.icon : ''}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
