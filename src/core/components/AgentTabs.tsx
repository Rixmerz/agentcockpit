/**
 * Agent Tabs
 *
 * Horizontal tab bar for switching between agent plugins.
 */

import { clsx } from 'clsx';
import type { AgentPlugin } from '../../plugins/types/plugin';

interface AgentTabsProps {
  plugins: AgentPlugin[];
  activePluginId: string | null;
  onSelect: (pluginId: string) => void;
}

export function AgentTabs({ plugins, activePluginId, onSelect }: AgentTabsProps) {
  if (plugins.length === 0) {
    return null;
  }

  return (
    <div className="agent-tabs">
      {plugins.map(plugin => (
        <button
          key={plugin.manifest.id}
          className={clsx('agent-tab', {
            active: plugin.manifest.id === activePluginId,
          })}
          onClick={() => onSelect(plugin.manifest.id)}
          title={plugin.manifest.name}
          style={{
            '--plugin-color': plugin.manifest.color,
          } as React.CSSProperties}
        >
          {plugin.manifest.icon.startsWith('/') || plugin.manifest.icon.startsWith('http') ? (
            <img
              src={plugin.manifest.icon}
              alt={plugin.manifest.name}
              className="agent-tab-icon"
            />
          ) : (
            <span className="agent-tab-emoji">{plugin.manifest.icon}</span>
          )}
        </button>
      ))}
    </div>
  );
}
