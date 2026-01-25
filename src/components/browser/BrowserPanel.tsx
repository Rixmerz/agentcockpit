import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Globe } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
} from '../../services/browserService';

interface BrowserPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
}

const TOOLBAR_HEIGHT = 44; // Increased to ensure toolbar is visible
const PANEL_HEIGHT = 400;

export function BrowserPanel({ isOpen, onClose, initialUrl = 'https://google.com' }: BrowserPanelProps) {
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isCreatingRef = useRef(false);

  // Update state from service
  const updateBrowserState = useCallback(() => {
    const state = getBrowserState();
    if (state.url) {
      setInputUrl(state.url);
    }
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
  }, []);

  // Get current position
  const getPosition = useCallback(() => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top + TOOLBAR_HEIGHT,
      width: rect.width,
      height: PANEL_HEIGHT - TOOLBAR_HEIGHT,
    };
  }, []);

  // Show/create webview when panel opens
  useEffect(() => {
    if (!isOpen) return;
    if (isCreatingRef.current) return;

    const timeoutId = setTimeout(async () => {
      const position = getPosition();
      if (!position) return;

      const state = getBrowserState();

      if (state.isOpen) {
        // Webview exists - just show it and update position
        console.log('[BrowserPanel] Showing existing webview');
        await showBrowserWebview();
        await updatePosition(position);
        updateBrowserState();
      } else {
        // Create new webview
        isCreatingRef.current = true;
        setIsLoading(true);

        try {
          const urlToLoad = state.url || initialUrl;
          console.log('[BrowserPanel] Creating webview:', { urlToLoad, position });
          await createBrowserWebview(urlToLoad, position);
          updateBrowserState();
        } catch (err) {
          console.error('[BrowserPanel] Error creating webview:', err);
        } finally {
          setIsLoading(false);
          isCreatingRef.current = false;
        }
      }
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [isOpen, initialUrl, getPosition, updateBrowserState]);

  // Hide webview when panel closes (don't destroy - keep state)
  useEffect(() => {
    if (isOpen) return;

    // Hide the webview when panel closes
    hideBrowserWebview();
  }, [isOpen]);

  // Handle window resize/move
  useEffect(() => {
    if (!isOpen) return;

    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;

    const handlePositionUpdate = () => {
      const position = getPosition();
      if (position) {
        updatePosition(position);
      }
    };

    let timeoutId: ReturnType<typeof setTimeout>;
    const debouncedUpdate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handlePositionUpdate, 16);
    };

    window.addEventListener('resize', debouncedUpdate);

    const setupTauriListeners = async () => {
      const mainWindow = getCurrentWindow();
      unlistenMove = await mainWindow.onMoved(debouncedUpdate);
      unlistenResize = await mainWindow.onResized(debouncedUpdate);
    };

    setupTauriListeners();

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', debouncedUpdate);
      unlistenMove?.();
      unlistenResize?.();
    };
  }, [isOpen, getPosition]);

  // Navigation handlers
  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    setIsLoading(true);
    await navigateTo(inputUrl.trim());
    updateBrowserState();
    setIsLoading(false);
  };

  const handleBack = async () => {
    setIsLoading(true);
    await goBack();
    updateBrowserState();
    setIsLoading(false);
  };

  const handleForward = async () => {
    setIsLoading(true);
    await goForward();
    updateBrowserState();
    setIsLoading(false);
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    await refresh();
    setIsLoading(false);
  };

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="browser-panel"
      style={{ height: PANEL_HEIGHT }}
    >
      <div className="browser-toolbar" style={{ height: TOOLBAR_HEIGHT }}>
        <div className="browser-nav-buttons">
          <button
            className="browser-nav-btn"
            onClick={handleBack}
            disabled={!canGoBack || isLoading}
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="browser-nav-btn"
            onClick={handleForward}
            disabled={!canGoForward || isLoading}
            title="Forward"
          >
            <ArrowRight size={16} />
          </button>
          <button
            className={`browser-nav-btn ${isLoading ? 'loading' : ''}`}
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh"
          >
            <RotateCw size={16} className={isLoading ? 'spin' : ''} />
          </button>
        </div>

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

        <button
          className="browser-close-btn"
          onClick={handleClose}
          title="Close browser"
        >
          <X size={16} />
        </button>
      </div>

      <div
        className="browser-webview-container"
        style={{ height: PANEL_HEIGHT - TOOLBAR_HEIGHT }}
      >
        {isLoading && (
          <div className="browser-loading">
            <div className="browser-loading-spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
