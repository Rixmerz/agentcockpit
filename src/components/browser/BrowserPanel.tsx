import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Globe } from 'lucide-react';
import {
  createBrowserWebview,
  closeBrowserWebview,
  hideBrowserWebview,
  showBrowserWebview,
  navigateTo,
  goBack,
  goForward,
  refresh,
  updatePosition,
  getBrowserState,
  isBrowserVisible,
} from '../../services/browserService';

interface BrowserPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
}

const TOOLBAR_HEIGHT = 40;
const PANEL_HEIGHT = 400;

export function BrowserPanel({ isOpen, onClose, initialUrl = 'https://google.com' }: BrowserPanelProps) {
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [webviewExists, setWebviewExists] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Update state from service
  const updateBrowserState = useCallback(() => {
    const state = getBrowserState();
    setInputUrl(state.url || initialUrl);
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
    setWebviewExists(state.isOpen);
  }, [initialUrl]);

  // Calculate and update webview position based on container
  const updateWebviewPosition = useCallback(() => {
    if (!containerRef.current || !isOpen) return;

    const rect = containerRef.current.getBoundingClientRect();

    // Position webview below the toolbar
    updatePosition({
      x: rect.left,
      y: rect.top + TOOLBAR_HEIGHT,
      width: rect.width,
      height: PANEL_HEIGHT - TOOLBAR_HEIGHT,
    });
  }, [isOpen]);

  // Create or show webview when panel opens
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const position = {
      x: rect.left,
      y: rect.top + TOOLBAR_HEIGHT,
      width: rect.width,
      height: PANEL_HEIGHT - TOOLBAR_HEIGHT,
    };

    const state = getBrowserState();

    if (state.isOpen) {
      // Webview exists, just show it and update position
      console.log('[BrowserPanel] Showing existing webview');
      showBrowserWebview().then(() => {
        updatePosition(position);
        updateBrowserState();
      });
    } else {
      // Create new webview
      console.log('[BrowserPanel] Creating new webview at:', position);
      setIsLoading(true);
      createBrowserWebview(initialUrl, position)
        .then(() => {
          setIsLoading(false);
          updateBrowserState();
        })
        .catch((err) => {
          console.error('[BrowserPanel] Error creating webview:', err);
          setIsLoading(false);
        });
    }
  }, [isOpen, initialUrl, updateBrowserState]);

  // Hide webview when panel closes (but don't destroy)
  useEffect(() => {
    if (!isOpen && isBrowserVisible()) {
      console.log('[BrowserPanel] Hiding webview');
      hideBrowserWebview();
    }
  }, [isOpen]);

  // Handle resize
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      updateWebviewPosition();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen, updateWebviewPosition]);

  // Handle navigation
  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    setIsLoading(true);
    await navigateTo(inputUrl.trim());
    setIsLoading(false);
    updateBrowserState();
  };

  const handleBack = async () => {
    setIsLoading(true);
    await goBack();
    setIsLoading(false);
    updateBrowserState();
  };

  const handleForward = async () => {
    setIsLoading(true);
    await goForward();
    setIsLoading(false);
    updateBrowserState();
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    await refresh();
    setIsLoading(false);
  };

  const handleClose = async () => {
    // Just hide, don't destroy - allows reopening with same state
    await hideBrowserWebview();
    onClose();
  };

  const handleCloseCompletely = async () => {
    // Destroy the webview completely
    await closeBrowserWebview();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="browser-panel"
      style={{ height: PANEL_HEIGHT }}
    >
      {/* Browser Toolbar */}
      <div className="browser-toolbar" style={{ height: TOOLBAR_HEIGHT }}>
        {/* Navigation buttons */}
        <div className="browser-nav-buttons">
          <button
            className="browser-nav-btn"
            onClick={handleBack}
            disabled={!canGoBack}
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="browser-nav-btn"
            onClick={handleForward}
            disabled={!canGoForward}
            title="Forward"
          >
            <ArrowRight size={16} />
          </button>
          <button
            className={`browser-nav-btn ${isLoading ? 'loading' : ''}`}
            onClick={handleRefresh}
            title="Refresh"
          >
            <RotateCw size={16} />
          </button>
        </div>

        {/* URL Bar */}
        <form onSubmit={handleNavigate} className="browser-url-form">
          <div className="browser-url-container">
            <Globe size={14} className="browser-url-icon" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="browser-url-input"
              placeholder="Enter URL..."
            />
          </div>
        </form>

        {/* Close button */}
        <button
          className="browser-close-btn"
          onClick={handleClose}
          onDoubleClick={handleCloseCompletely}
          title="Close (double-click to destroy)"
        >
          <X size={16} />
        </button>
      </div>

      {/* Webview container - native webview renders on top of this area */}
      <div
        className="browser-webview-container"
        style={{ height: PANEL_HEIGHT - TOOLBAR_HEIGHT }}
      >
        {isLoading && (
          <div className="browser-loading">
            <div className="browser-loading-spinner" />
          </div>
        )}
        {!webviewExists && !isLoading && (
          <div className="browser-placeholder">
            <Globe size={48} opacity={0.3} />
            <p>Browser loading...</p>
          </div>
        )}
      </div>
    </div>
  );
}
