import { useState, useCallback } from 'react';
import { getActivePorts, killPort, type PortInfo } from '../services/portsService';

export interface UsePortsStatusResult {
  activePorts: PortInfo[];
  portsLoading: boolean;
  loadPorts: () => Promise<void>;
  handleKillPort: (port: number) => Promise<void>;
  handleOpenPort: (port: number) => void;
}

export function usePortsStatus(): UsePortsStatusResult {
  const [activePorts, setActivePorts] = useState<PortInfo[]>([]);
  const [portsLoading, setPortsLoading] = useState(false);

  const loadPorts = useCallback(async () => {
    setPortsLoading(true);
    try {
      const ports = await getActivePorts();
      setActivePorts(ports);
    } catch (error) {
      console.warn('[usePortsStatus] Error checking ports:', error);
    } finally {
      setPortsLoading(false);
    }
  }, []);

  const handleKillPort = useCallback(async (port: number) => {
    // Optimistic: remove from UI immediately
    setActivePorts(prev => prev.filter(p => p.port !== port));
    // Kill in background
    await killPort(port);
    // Delayed refresh to catch respawned processes
    setTimeout(loadPorts, 2000);
  }, [loadPorts]);

  const handleOpenPort = useCallback((port: number) => {
    window.open(`http://localhost:${port}`, '_blank');
  }, []);

  return {
    activePorts,
    portsLoading,
    loadPorts,
    handleKillPort,
    handleOpenPort,
  };
}
