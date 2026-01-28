import { useState, useEffect, useCallback } from 'react';
import { Download, Trash2, Play, AlertCircle, Loader } from 'lucide-react';
import { marketplaceService, type AvailableIntegration } from '../../services/marketplaceService';
import { DemoExecutionLauncher } from './DemoExecutionLauncher';

interface MarketplacePanelProps {
  projectPath?: string | null;
}

export function MarketplacePanel({ projectPath }: MarketplacePanelProps) {
  const [available, setAvailable] = useState<AvailableIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const availableList = await marketplaceService.listAvailable();
      setAvailable(availableList);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load integrations';
      setError(message);
      console.error('[MarketplacePanel] Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  const handleInstall = useCallback(async (integrationId: string) => {
    setActionInProgress(integrationId);
    try {
      const result = await marketplaceService.install(integrationId);
      if (result.success) {
        showMessage('success', result.message);
        await refreshLists();
      } else {
        showMessage('error', result.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Installation failed';
      showMessage('error', msg);
    } finally {
      setActionInProgress(null);
    }
  }, [refreshLists, showMessage]);

  const handleUninstall = useCallback(async (integrationId: string) => {
    if (!confirm(`Are you sure you want to uninstall ${integrationId}?`)) return;

    setActionInProgress(integrationId);
    try {
      const result = await marketplaceService.uninstall(integrationId);
      if (result.success) {
        showMessage('success', result.message);
        await refreshLists();
      } else {
        showMessage('error', result.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Uninstallation failed';
      showMessage('error', msg);
    } finally {
      setActionInProgress(null);
    }
  }, [refreshLists, showMessage]);

  const handleEnable = useCallback(async (integrationId: string) => {
    if (!projectPath) {
      showMessage('error', 'No project path provided');
      return;
    }

    setActionInProgress(integrationId);
    try {
      const result = await marketplaceService.enable(integrationId, projectPath);
      if (result.success) {
        showMessage('success', result.message);
        await refreshLists();
      } else {
        showMessage('error', result.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Enable failed';
      showMessage('error', msg);
    } finally {
      setActionInProgress(null);
    }
  }, [projectPath, refreshLists, showMessage]);


  return (
    <div className="marketplace-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflow: 'auto' }}>
      <div>
        <h2 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600 }}>Marketplace</h2>
        <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>Manage integrations for AgentCockpit</p>
      </div>

      {message && (
        <div style={{
          padding: '12px',
          borderRadius: '4px',
          backgroundColor: message.type === 'success' ? '#d4edda' : '#f8d7da',
          color: message.type === 'success' ? '#155724' : '#721c24',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {message.type === 'error' && <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px',
          borderRadius: '4px',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#666' }}>
          <Loader size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
          <p>Loading integrations...</p>
        </div>
      )}

      {!loading && available.length === 0 && (
        <div style={{ textAlign: 'center', padding: '24px', color: '#666' }}>
          No integrations available
        </div>
      )}

      {/* Demo Execution Launcher */}
      <DemoExecutionLauncher projectPath={projectPath || null} />

      {!loading && available.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {available.map(integration => (
            <div
              key={integration.id}
              style={{
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '12px',
                backgroundColor: '#f9f9f9',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600 }}>
                    {integration.name}
                  </h3>
                  <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
                    {integration.description}
                  </p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#999' }}>
                    v{integration.version} by {integration.author}
                  </p>
                </div>
                <div style={{
                  padding: '2px 8px',
                  borderRadius: '3px',
                  fontSize: '11px',
                  fontWeight: 500,
                  backgroundColor: integration.status === 'installed' ? '#d4edda' : '#e2e3e5',
                  color: integration.status === 'installed' ? '#155724' : '#383d41',
                  whiteSpace: 'nowrap'
                }}>
                  {integration.status === 'available' ? 'Available' : 'Installed'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                {integration.status === 'available' && (
                  <button
                    onClick={() => handleInstall(integration.id)}
                    disabled={actionInProgress === integration.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: actionInProgress === integration.id ? 'not-allowed' : 'pointer',
                      opacity: actionInProgress === integration.id ? 0.6 : 1,
                      transition: 'opacity 0.2s'
                    }}
                  >
                    {actionInProgress === integration.id ? (
                      <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Download size={12} />
                    )}
                    Install
                  </button>
                )}

                {integration.status === 'installed' && (
                  <>
                    {projectPath && (
                      <button
                        onClick={() => handleEnable(integration.id)}
                        disabled={actionInProgress === integration.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '6px 12px',
                          fontSize: '12px',
                          backgroundColor: '#28a745',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: actionInProgress === integration.id ? 'not-allowed' : 'pointer',
                          opacity: actionInProgress === integration.id ? 0.6 : 1,
                          transition: 'opacity 0.2s'
                        }}
                      >
                        {actionInProgress === integration.id ? (
                          <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                        ) : (
                          <Play size={12} />
                        )}
                        Enable
                      </button>
                    )}
                    <button
                      onClick={() => handleUninstall(integration.id)}
                      disabled={actionInProgress === integration.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: actionInProgress === integration.id ? 'not-allowed' : 'pointer',
                        opacity: actionInProgress === integration.id ? 0.6 : 1,
                        transition: 'opacity 0.2s'
                      }}
                    >
                      {actionInProgress === integration.id ? (
                        <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Uninstall
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
