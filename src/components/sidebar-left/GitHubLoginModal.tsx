/**
 * GitHub Login Modal
 *
 * OAuth Device Flow UI - shows user code for github.com/login/device
 */

import { useState, useCallback, useEffect } from 'react';
import { Github, ExternalLink, Copy, Check, Loader2, X, AlertCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import {
  startDeviceFlow,
  pollForToken,
  validateToken,
  getCurrentUser,
  deleteToken,
  type GitHubUser,
  type DeviceCodeResponse,
  GitHubAuthError,
} from '../../services/githubService';

interface GitHubLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (user: GitHubUser) => void;
  clientId?: string;
}

type AuthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'device_code'; data: DeviceCodeResponse; polling: boolean }
  | { status: 'success'; user: GitHubUser }
  | { status: 'error'; message: string };

export function GitHubLoginModal({
  isOpen,
  onClose,
  onLogin,
  clientId,
}: GitHubLoginModalProps) {
  const [authState, setAuthState] = useState<AuthState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);
  const [currentUser, setCurrentUser] = useState<GitHubUser | null>(null);

  // Check for existing login on mount
  useEffect(() => {
    if (isOpen) {
      getCurrentUser().then(user => {
        if (user) {
          setCurrentUser(user);
          setAuthState({ status: 'success', user });
        }
      });
    }
  }, [isOpen]);

  // Start authentication
  const handleStartAuth = useCallback(async () => {
    setAuthState({ status: 'loading' });

    try {
      const deviceCode = await startDeviceFlow(clientId);

      // Show code immediately (not polling yet)
      setAuthState({ status: 'device_code', data: deviceCode, polling: false });

      // Auto-copy code to clipboard (best effort)
      try {
        await navigator.clipboard.writeText(deviceCode.user_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } catch (clipErr) {
        console.warn('[GitHub] Clipboard failed:', clipErr);
      }

      // Start polling after a short delay (keep code visible!)
      setTimeout(async () => {
        // Update to polling state but keep showing the code
        setAuthState({ status: 'device_code', data: deviceCode, polling: true });

        try {
          const token = await pollForToken(
            deviceCode.device_code,
            deviceCode.interval,
            clientId
          );

          const user = await validateToken(token);
          if (user) {
            setCurrentUser(user);
            setAuthState({ status: 'success', user });
            onLogin(user);
          } else {
            setAuthState({ status: 'error', message: 'Failed to get user info' });
          }
        } catch (error) {
          const message =
            error instanceof GitHubAuthError
              ? error.message
              : 'Authentication failed';
          setAuthState({ status: 'error', message });
        }
      }, 500);
    } catch (error) {
      const message =
        error instanceof GitHubAuthError
          ? error.message
          : 'Failed to start authentication';
      setAuthState({ status: 'error', message });
    }
  }, [clientId, onLogin]);

  // Copy code to clipboard
  const handleCopyCode = useCallback(async () => {
    if (authState.status === 'device_code') {
      await navigator.clipboard.writeText(authState.data.user_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [authState]);

  // Open verification URL
  const handleOpenGitHub = useCallback(async () => {
    if (authState.status === 'device_code') {
      try {
        await open(authState.data.verification_uri);
      } catch (err) {
        console.warn('[GitHub] Open URL failed:', err);
      }
    }
  }, [authState]);

  // Logout
  const handleLogout = useCallback(async () => {
    await deleteToken();
    setCurrentUser(null);
    setAuthState({ status: 'idle' });
  }, []);

  // Reset on close
  const handleClose = useCallback(() => {
    if (authState.status !== 'device_code' || !authState.polling) {
      setAuthState({ status: 'idle' });
      setCopied(false);
    }
    onClose();
  }, [authState, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-container github-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            <Github size={20} />
            GitHub Login
          </h2>
          <button className="modal-close-btn" onClick={handleClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-content">
          {/* Already logged in */}
          {currentUser && authState.status === 'success' && (
            <div className="github-logged-in">
              <div className="github-user-info">
                <img
                  src={currentUser.avatar_url}
                  alt={currentUser.login}
                  className="github-avatar"
                />
                <div className="github-user-details">
                  <span className="github-user-name">
                    {currentUser.name || currentUser.login}
                  </span>
                  <span className="github-user-login">@{currentUser.login}</span>
                </div>
              </div>
              <button className="btn-secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>
          )}

          {/* Idle state - show login button */}
          {authState.status === 'idle' && !currentUser && (
            <div className="github-idle">
              <div className="github-icon-container">
                <Github size={48} />
              </div>
              <p className="github-description">
                Conecta tu cuenta de GitHub para clonar repositorios privados
                y acceder a tus proyectos.
              </p>
              <button className="btn-primary github-login-btn" onClick={handleStartAuth}>
                <Github size={18} />
                Iniciar sesión con GitHub
              </button>
            </div>
          )}

          {/* Loading */}
          {authState.status === 'loading' && (
            <div className="github-loading">
              <Loader2 size={32} className="animate-spin" />
              <p>Conectando con GitHub...</p>
            </div>
          )}

          {/* Device Code - stays visible while polling */}
          {authState.status === 'device_code' && (
            <div className="github-device-code">
              <p className="github-instruction">
                Ingresa este código en <strong>github.com/login/device</strong>
              </p>

              <div className="github-code-box">
                <span className="github-code">{authState.data.user_code}</span>
                <button
                  className="btn-icon github-copy-btn"
                  onClick={handleCopyCode}
                  title="Copiar código"
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>

              {copied && (
                <p className="github-copied-notice">Código copiado al portapapeles</p>
              )}

              <button className="btn-primary github-open-btn" onClick={handleOpenGitHub}>
                <ExternalLink size={16} />
                Abrir GitHub
              </button>

              {/* Polling indicator */}
              {authState.polling && (
                <div className="github-polling-inline">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Esperando autorización...</span>
                </div>
              )}

              <p className="github-expires">
                El código expira en {Math.floor(authState.data.expires_in / 60)} minutos
              </p>
            </div>
          )}

          {/* Error */}
          {authState.status === 'error' && (
            <div className="github-error">
              <AlertCircle size={32} />
              <p className="github-error-message">{authState.message}</p>
              <button className="btn-secondary" onClick={() => setAuthState({ status: 'idle' })}>
                Intentar de nuevo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
