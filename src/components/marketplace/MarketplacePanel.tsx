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
    <div className="marketplace-panel">
      <div className="marketplace-header">
        <h2>Marketplace</h2>
        <p>Manage integrations for AgentCockpit</p>
      </div>

      {message && (
        <div className={`marketplace-message marketplace-message-${message.type}`}>
          {message.type === 'error' && <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {error && (
        <div className="marketplace-error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading && (
        <div className="marketplace-loading">
          <Loader size={24} />
          <p>Loading integrations...</p>
        </div>
      )}

      {!loading && available.length === 0 && (
        <div className="marketplace-empty">
          No integrations available
        </div>
      )}

      {/* Demo Execution Launcher */}
      <DemoExecutionLauncher projectPath={projectPath || null} />

      {!loading && available.length > 0 && (
        <div className="marketplace-list">
          {available.map(integration => (
            <div key={integration.id} className="marketplace-item">
              <div className="marketplace-item-header">
                <div className="marketplace-item-info">
                  <h3>{integration.name}</h3>
                  <p>{integration.description}</p>
                  <span className="marketplace-item-meta">
                    v{integration.version} by {integration.author}
                  </span>
                </div>
                <div className={`marketplace-item-status marketplace-status-${integration.status}`}>
                  {integration.status === 'available' ? 'Available' : 'Installed'}
                </div>
              </div>

              <div className="marketplace-item-actions">
                {integration.status === 'available' && (
                  <button
                    onClick={() => handleInstall(integration.id)}
                    disabled={actionInProgress === integration.id}
                    className="marketplace-btn marketplace-btn-primary"
                  >
                    {actionInProgress === integration.id ? (
                      <Loader size={12} />
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
                        className="marketplace-btn marketplace-btn-success"
                      >
                        {actionInProgress === integration.id ? (
                          <Loader size={12} />
                        ) : (
                          <Play size={12} />
                        )}
                        Enable
                      </button>
                    )}
                    <button
                      onClick={() => handleUninstall(integration.id)}
                      disabled={actionInProgress === integration.id}
                      className="marketplace-btn marketplace-btn-danger"
                    >
                      {actionInProgress === integration.id ? (
                        <Loader size={12} />
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
