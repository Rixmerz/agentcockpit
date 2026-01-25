import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Globe } from 'lucide-react';
import {
  createBrowserWebview,
  closeBrowserWebview,
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

const TOOLBAR_HEIGHT = 40;
const PANEL_HEIGHT = 400;

export function BrowserPanel({ isOpen, onClose, initialUrl = 'https://google.com' }: BrowserPanelProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate and update webview position based on container
  const updateWebviewPosition = useCallback(() => {
    if (!containerRef.current || !isOpen) return;

    const rect = containerRef.current.getBoundingClientRect();
    const scaleFactor = window.devicePixelRatio || 1;

    // Position webview below the toolbar
    updatePosition({
      x: rect.left * scaleFactor,
      y: (rect.top + TOOLBAR_HEIGHT) * scaleFactor,
      width: rect.width * scaleFactor,
      height: (PANEL_HEIGHT - TOOLBAR_HEIGHT) * scaleFactor,
    });
  }, [isOpen]);

  // Create webview when panel opens
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const scaleFactor = window.devicePixelRatio || 1;

      setIsLoading(true);
      createBrowserWebview(url, {
        x: rect.left * scaleFactor,
        y: (rect.top + TOOLBAR_HEIGHT) * scaleFactor,
        width: rect.width * scaleFactor,
        height: (PANEL_HEIGHT - TOOLBAR_HEIGHT) * scaleFactor,
      })
        .then(() => {
          setIsLoading(false);
          updateBrowserState();
        })
        .catch((err) => {
          console.error('[BrowserPanel] Error creating webview:', err);
          setIsLoading(false);
        });
    }

    return () => {
      if (!isOpen) {
        closeBrowserWebview();
      }
    };
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

  // Update state from service
  const updateBrowserState = () => {
    const state = getBrowserState();
    setUrl(state.url);
    setInputUrl(state.url);
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
  };

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
          title="Close browser"
        >
          <X size={16} />
        </button>
      </div>

      {/* Webview container - native webview renders here */}
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
