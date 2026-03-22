import { useState, useCallback } from 'react';
import { loadMcpConfig } from '../services/mcpConfigService';

export interface McpStatus {
  name: string;
  connected: boolean;
}

export interface UseMcpStatusResult {
  mcpServers: McpStatus[];
  mcpLoading: boolean;
  showMcpManager: boolean;
  setShowMcpManager: (open: boolean) => void;
  loadMcps: () => Promise<void>;
}

export function useMcpStatus(): UseMcpStatusResult {
  const [mcpServers, setMcpServers] = useState<McpStatus[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [showMcpManager, setShowMcpManager] = useState(false);

  const loadMcps = useCallback(async () => {
    setMcpLoading(true);
    try {
      const config = await loadMcpConfig();
      const servers: McpStatus[] = Object.keys(config.mcpServers || {}).map(name => ({
        name,
        connected: false, // Would need to check actual connection status
      }));
      setMcpServers(servers);
    } catch (err) {
      console.warn('[useMcpStatus] Failed to load MCPs:', err);
    } finally {
      setMcpLoading(false);
    }
  }, []);

  return {
    mcpServers,
    mcpLoading,
    showMcpManager,
    setShowMcpManager,
    loadMcps,
  };
}
