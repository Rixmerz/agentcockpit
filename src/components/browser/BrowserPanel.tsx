import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Globe } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  createBrowserWebview,
  showBrowserWebview,
  navigateTo,
  goBack,
  goForward,
  refresh,
  updatePosition,
  getBrowserState,
  onUrlChange,
} from '../../services/browserService';

interface BrowserPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
}

const TOOLBAR_HEIGHT = 48;
const PANEL_HEIGHT = 400;

export function BrowserPanel({ isOpen, onClose, initialUrl = 'https://google.com' }: BrowserPanelProps) {
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewReadyRef = useRef(false);

  const updateBrowserState = useCallback(() => {
    const state = getBrowserState();
    if (state.url) {
      setInputUrl(state.url);
    }
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
  }, []);

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

  // Effect for webview lifecycle - only handles OPENING
  // Closing is handled by handleBrowserToggle in App.tsx to avoid race conditions
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;

    const initWebview = async () => {
      await new Promise(r => setTimeout(r, 100));
      if (!mounted) return;

      const position = getPosition();
      if (!position) return;

      const state = getBrowserState();

      if (state.isOpen && !state.isVisible) {
        // Webview exists but hidden - show and reposition
        console.log('[BrowserPanel] Showing existing webview');
        await showBrowserWebview();
        if (mounted) {
          await updatePosition(position);
          updateBrowserState();
          webviewReadyRef.current = true;
        }
      } else if (!state.isOpen) {
        // No webview - create new
        setIsLoading(true);
        try {
          const urlToLoad = state.url || initialUrl;
          console.log('[BrowserPanel] Creating webview at:', position);
          await createBrowserWebview(urlToLoad, position);
          if (mounted) {
            updateBrowserState();
            webviewReadyRef.current = true;
          }
        } catch (err) {
          console.error('[BrowserPanel] Error:', err);
        } finally {
          if (mounted) setIsLoading(false);
        }
      } else {
        // Webview exists and visible - just update position
        await updatePosition(position);
        updateBrowserState();
        webviewReadyRef.current = true;
      }
    };

    const timeoutId = setTimeout(initWebview, 50);
    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [isOpen, initialUrl, getPosition, updateBrowserState]);

  // Subscribe to URL changes from webview navigation
  useEffect(() => {
    if (!isOpen) return;

    // Register callback for URL changes from Rust webview
    onUrlChange((newUrl: string) => {
      console.log('[BrowserPanel] URL changed:', newUrl);
      setInputUrl(newUrl);
      updateBrowserState();
    });
  }, [isOpen, updateBrowserState]);

  // Handle window resize/move
  useEffect(() => {
    if (!isOpen || !webviewReadyRef.current) return;

    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    let rafId: number;

    const handlePositionUpdate = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const position = getPosition();
        if (position) updatePosition(position);
      });
    };

    window.addEventListener('resize', handlePositionUpdate);

    const setupListeners = async () => {
      try {
        const mainWindow = getCurrentWindow();
        unlistenMove = await mainWindow.onMoved(handlePositionUpdate);
        unlistenResize = await mainWindow.onResized(handlePositionUpdate);
      } catch (e) {
        console.warn('[BrowserPanel] Could not setup listeners:', e);
      }
    };

    setupListeners();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handlePositionUpdate);
      unlistenMove?.();
      unlistenResize?.();
    };
  }, [isOpen, getPosition]);

  // Close: delegate to parent (handleBrowserToggle handles webview hiding)
  const handleClose = () => {
    onClose();
  };

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
