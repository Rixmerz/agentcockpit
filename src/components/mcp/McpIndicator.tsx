/**
 * MCP Indicator
 *
 * Simple indicator for the sidebar that shows MCP count and opens the manager modal.
 */

import { useState, useEffect } from 'react';
import { Server, ChevronRight } from 'lucide-react';
import { getActiveMcpCount } from '../../services/mcpConfigService';
import { McpManagerModal } from './McpManagerModal';
import type { ClaudePluginConfig } from '../../services/pluginConfigService';

interface McpIndicatorProps {
  onPluginConfigChanged?: (config: ClaudePluginConfig) => void;
  onModalStateChange?: (isOpen: boolean) => void;
}

export function McpIndicator({ onPluginConfigChanged, onModalStateChange }: McpIndicatorProps) {
  const [count, setCount] = useState<number>(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Notify parent when modal opens/closes
  useEffect(() => {
    onModalStateChange?.(isModalOpen);
  }, [isModalOpen, onModalStateChange]);

  const loadCount = async () => {
    try {
      const activeCount = await getActiveMcpCount();
      setCount(activeCount);
    } catch (e) {
      console.error('[McpIndicator] Error loading count:', e);
    }
  };

  useEffect(() => {
    loadCount();
  }, []);

  const handleMcpsChanged = () => {
    loadCount();
  };

  return (
    <>
      <div className="mcp-indicator" onClick={() => setIsModalOpen(true)}>
        <Server size={16} className="mcp-indicator-icon" />
        <span className="mcp-indicator-text">MCP Servers</span>
        <span className="mcp-indicator-count">{count}</span>
        <ChevronRight size={14} className="mcp-indicator-arrow" />
      </div>

      <McpManagerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onMcpsChanged={handleMcpsChanged}
        onPluginConfigChanged={onPluginConfigChanged}
      />
    </>
  );
}
