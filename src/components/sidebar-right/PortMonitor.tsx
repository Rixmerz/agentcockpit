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

  // Ports to monitor (common development ports)
  const PORTS_TO_CHECK = [
    // Frontend
    3000, 3001, 3002, 4173, 5173, 8080,
    // Backend / Tauri
    1420, 4000, 5000, 8000,
    // Database
    5432, 27017, 6379
  ];

  const checkPorts = useCallback(async () => {
    setIsLoading(true);
    const portInfos: PortInfo[] = [];

    for (const port of PORTS_TO_CHECK) {
      try {
        const result = await invoke<string>('execute_command', {
          cmd: `lsof -ti:${port}`,
          cwd: '/',
        });

        if (result.trim()) {
          // Port is active - get PID and process
          const pid = parseInt(result.trim().split('\n')[0], 10);

          // Get process name
          let processName = 'Unknown';
          try {
            const processResult = await invoke<string>('execute_command', {
              cmd: `ps -p ${pid} -o comm=`,
              cwd: '/',
            });
            processName = processResult.trim();
          } catch {
            // Ignore if can't get process name
          }

          portInfos.push({
            port,
            status: 'active',
            pid,
            process: processName,
          });
        }
      } catch {
        // Port is inactive (lsof returns error when no process found)
        // Don't add inactive ports to keep the list clean
      }
    }

    // Sort active ports first, then by port number
    portInfos.sort((a, b) => a.port - b.port);

    setPorts(portInfos);
    setIsLoading(false);
  }, []);

  const killPort = useCallback(async (port: number) => {
    try {
      await invoke<string>('execute_command', {
        cmd: `lsof -ti:${port} | xargs kill -9`,
        cwd: '/',
      });

      // Refresh after killing
      setTimeout(() => checkPorts(), 500);
    } catch (error) {
      console.error(`Error killing port ${port}:`, error);
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
