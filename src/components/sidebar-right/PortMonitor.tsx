import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, X } from 'lucide-react';

interface PortInfo {
  port: number;
  status: 'active' | 'inactive';
  pid?: number;
  process?: string;
}

export function PortMonitor() {
  const [expanded, setExpanded] = useState(false);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Ports to monitor (common development ports with sequential ranges)
  const PORTS_TO_CHECK = [
    // Tauri
    1420,
    // React/Next.js/Create-React-App (3000-3020)
    ...Array.from({ length: 21 }, (_, i) => 3000 + i),
    // Additional frontend ports
    3030, 3050, 3100, 3200, 3300, 3333,
    // Backend APIs (4000-4010)
    ...Array.from({ length: 11 }, (_, i) => 4000 + i),
    // Vite preview
    4173,
    // Python/Flask/FastAPI (5000-5010)
    ...Array.from({ length: 11 }, (_, i) => 5000 + i),
    // Vite dev
    5173, 5174, 5175,
    // Redis
    6379,
    // Common backend (8000-8010)
    ...Array.from({ length: 11 }, (_, i) => 8000 + i),
    // Alternative HTTP (8080-8090)
    ...Array.from({ length: 11 }, (_, i) => 8080 + i),
    // PostgreSQL
    5432,
    // MongoDB
    27017,
  ];

  const checkPorts = useCallback(async () => {
    setIsLoading(true);
    const portInfos: PortInfo[] = [];

    // Check ports in parallel batches for better performance
    const checkPort = async (port: number): Promise<PortInfo | null> => {
      try {
        const result = await invoke<string>('execute_command', {
          cmd: `lsof -ti:${port} 2>/dev/null`,
          cwd: '/',
        });

        if (result.trim()) {
          // Port is active - get PID and process
          const pid = parseInt(result.trim().split('\n')[0], 10);

          // Get process name
          let processName = 'Unknown';
          try {
            const processResult = await invoke<string>('execute_command', {
              cmd: `ps -p ${pid} -o comm= 2>/dev/null`,
              cwd: '/',
            });
            processName = processResult.trim() || 'Unknown';
          } catch {
            // Ignore if can't get process name
          }

          return {
            port,
            status: 'active',
            pid,
            process: processName,
          };
        }
        return null;
      } catch {
        // Port is inactive or command failed
        return null;
      }
    };

    try {
      // Process ports in batches of 10 for better performance
      const batchSize = 10;
      for (let i = 0; i < PORTS_TO_CHECK.length; i += batchSize) {
        const batch = PORTS_TO_CHECK.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(checkPort));
        results.forEach(info => {
          if (info) portInfos.push(info);
        });
      }
    } catch (error) {
      console.warn('[PortMonitor] Error checking ports:', error);
    }

    // Sort by port number
    portInfos.sort((a, b) => a.port - b.port);

    setPorts(portInfos);
    setIsLoading(false);
  }, []);

  const killPort = useCallback(async (port: number) => {
    try {
      // Get PID first, then kill (more reliable than pipe)
      const result = await invoke<string>('execute_command', {
        cmd: `lsof -ti:${port} 2>/dev/null`,
        cwd: '/',
      });

      const pid = result.trim().split('\n')[0];
      if (pid) {
        await invoke<string>('execute_command', {
          cmd: `kill -9 ${pid} 2>/dev/null || true`,
          cwd: '/',
        });
      }

      // Refresh after killing
      setTimeout(() => checkPorts(), 500);
    } catch (error) {
      console.warn(`[PortMonitor] Error killing port ${port}:`, error);
      // Still refresh to update UI
      setTimeout(() => checkPorts(), 500);
    }
  }, [checkPorts]);

  // Auto-refresh every 5 seconds when expanded
  useEffect(() => {
    if (expanded) {
      checkPorts();
      const interval = setInterval(checkPorts, 5000);
      return () => clearInterval(interval);
    }
  }, [expanded, checkPorts]);

  const activePorts = ports.length;

  return (
    <div className="port-manager">
      <div
        className="port-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="port-title">
          Port Monitor ({activePorts})
        </span>
        <button
          className="port-refresh-btn"
          onClick={(e) => {
            e.stopPropagation();
            checkPorts();
          }}
          title="Refresh Ports"
          disabled={isLoading}
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
        </button>
        <span className="port-expand-icon">
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {expanded && (
        <div className="port-list">
          {ports.length === 0 ? (
            <div className="port-empty">
              {isLoading ? 'Escaneando...' : 'No hay puertos activos'}
            </div>
          ) : (
            ports.map(portInfo => (
              <div key={portInfo.port} className="port-item">
                <div className="port-info">
                  <span className="port-number">:{portInfo.port}</span>
                  <span className={`port-status ${portInfo.status}`}>
                    Activo
                  </span>
                  {portInfo.process && (
                    <span className="port-process" title={`PID: ${portInfo.pid}`}>
                      {portInfo.process}
                    </span>
                  )}
                </div>
                <button
                  className="port-kill-btn"
                  onClick={() => killPort(portInfo.port)}
                  title={`Kill process on port ${portInfo.port}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
