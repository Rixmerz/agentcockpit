import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Globe, Plus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  createBrowserWebview,
  showBrowserWebview,
  hideBrowserWebview,
  navigateTo,
  refresh,
  updatePosition,
  getBrowserState,
  onUrlChange,
} from '../../services/browserService';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  history: string[];
  historyIndex: number;
}

interface BrowserPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
  isIdle?: boolean;
  hideForModal?: boolean;
}

const TOOLBAR_HEIGHT = 48;
const TAB_BAR_HEIGHT = 32;
const PANEL_HEIGHT = 432; // Increased to accommodate tab bar
const IDLE_FADE_DURATION = 300;

let tabIdCounter = 0;
const generateTabId = () => `tab-${++tabIdCounter}`;

const createNewTab = (url: string = 'https://google.com'): BrowserTab => ({
  id: generateTabId(),
  url,
  title: getTabTitle(url),
  history: [url],
  historyIndex: 0,
});

const getTabTitle = (url: string): string => {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return hostname || 'New Tab';
  } catch {
    return 'New Tab';
  }
};

export function BrowserPanel({
  isOpen,
  onClose,
  initialUrl = 'https://google.com',
  isIdle = false,
  hideForModal = false
}: BrowserPanelProps) {
  // Tab state
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [createNewTab(initialUrl)]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || '');

  // UI state
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [webviewHidden, setWebviewHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewReadyRef = useRef(false);

  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId);
  const canGoBack = activeTab ? activeTab.historyIndex > 0 : false;
  const canGoForward = activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false;

  // Update active tab's URL
  const updateActiveTabUrl = useCallback((newUrl: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== activeTabId) return tab;

      // Don't add duplicate URLs
      if (tab.history[tab.historyIndex] === newUrl) {
        return { ...tab, url: newUrl, title: getTabTitle(newUrl) };
      }

      // Add to history
      const newHistory = tab.history.slice(0, tab.historyIndex + 1);
      newHistory.push(newUrl);

      return {
        ...tab,
        url: newUrl,
        title: getTabTitle(newUrl),
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }));
    setInputUrl(newUrl);
  }, [activeTabId]);

  // Hide webview when idle or modal is open
  useEffect(() => {
    const shouldHide = isIdle || hideForModal;

    if (shouldHide && isOpen && !webviewHidden) {
      hideBrowserWebview();
      setWebviewHidden(true);
    } else if (!shouldHide && isOpen && webviewHidden) {
      const timer = setTimeout(() => {
        showBrowserWebview();
        setWebviewHidden(false);
      }, IDLE_FADE_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isIdle, hideForModal, isOpen, webviewHidden]);

  const getPosition = useCallback(() => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top + TOOLBAR_HEIGHT + TAB_BAR_HEIGHT,
      width: rect.width,
      height: PANEL_HEIGHT - TOOLBAR_HEIGHT - TAB_BAR_HEIGHT,
    };
  }, []);

  // Initialize webview
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
        await showBrowserWebview();
        if (mounted) {
          await updatePosition(position);
          webviewReadyRef.current = true;
        }
      } else if (!state.isOpen) {
        setIsLoading(true);
        try {
          const urlToLoad = activeTab?.url || initialUrl;
          await createBrowserWebview(urlToLoad, position);
          if (mounted) {
            webviewReadyRef.current = true;
          }
        } catch (err) {
          console.error('[BrowserPanel] Error:', err);
        } finally {
          if (mounted) setIsLoading(false);
        }
      } else {
        await updatePosition(position);
        webviewReadyRef.current = true;
      }
    };

    const timeoutId = setTimeout(initWebview, 50);
    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [isOpen, initialUrl, getPosition, activeTab?.url]);

  // Subscribe to URL changes
  useEffect(() => {
    if (!isOpen) return;

    onUrlChange((newUrl: string) => {
      console.log('[BrowserPanel] URL changed:', newUrl);
      updateActiveTabUrl(newUrl);
    });
  }, [isOpen, updateActiveTabUrl]);

  // Sync input URL with active tab
  useEffect(() => {
    if (activeTab) {
      setInputUrl(activeTab.url);
    }
  }, [activeTabId, activeTab?.url]);

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

  // Tab actions
  const handleNewTab = useCallback(() => {
    const newTab = createNewTab();
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    navigateTo(newTab.url);
  }, []);

  const handleCloseTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    setTabs(prev => {
      if (prev.length === 1) {
        // Don't close last tab, just reset it
        const resetTab = createNewTab();
        navigateTo(resetTab.url);
        return [resetTab];
      }

      const newTabs = prev.filter(t => t.id !== tabId);

      // If closing active tab, switch to adjacent tab
      if (tabId === activeTabId) {
        const closedIndex = prev.findIndex(t => t.id === tabId);
        const newActiveTab = newTabs[Math.min(closedIndex, newTabs.length - 1)];
        setActiveTabId(newActiveTab.id);
        navigateTo(newActiveTab.url);
      }

      return newTabs;
    });
  }, [activeTabId]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    if (tabId === activeTabId) return;

    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      setActiveTabId(tabId);
      setInputUrl(tab.url);
      setIsLoading(true);
      await navigateTo(tab.url);
      setIsLoading(false);
    }
  }, [activeTabId, tabs]);

  // Navigation actions
  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;
    setIsLoading(true);
    await navigateTo(inputUrl.trim());
    setIsLoading(false);
  };

  const handleBack = async () => {
    if (!activeTab || activeTab.historyIndex <= 0) return;

    const newIndex = activeTab.historyIndex - 1;
    const newUrl = activeTab.history[newIndex];

    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, historyIndex: newIndex, url: newUrl }
        : tab
    ));

    setIsLoading(true);
    await navigateTo(newUrl);
    setInputUrl(newUrl);
    setIsLoading(false);
  };

  const handleForward = async () => {
    if (!activeTab || activeTab.historyIndex >= activeTab.history.length - 1) return;

    const newIndex = activeTab.historyIndex + 1;
    const newUrl = activeTab.history[newIndex];

    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId
        ? { ...tab, historyIndex: newIndex, url: newUrl }
        : tab
    ));

    setIsLoading(true);
    await navigateTo(newUrl);
    setInputUrl(newUrl);
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
      {/* Tab Bar */}
      <div className="browser-tab-bar" style={{ height: TAB_BAR_HEIGHT }}>
        <div className="browser-tabs">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`browser-tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => handleSwitchTab(tab.id)}
              title={tab.url}
            >
              <Globe size={12} className="browser-tab-icon" />
              <span className="browser-tab-title">{tab.title}</span>
              <button
                className="browser-tab-close"
                onClick={(e) => handleCloseTab(tab.id, e)}
                title="Close tab"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="browser-new-tab-btn"
          onClick={handleNewTab}
          title="New tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Toolbar */}
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
          onClick={onClose}
          title="Close browser"
        >
          <X size={16} />
        </button>
      </div>

      {/* Webview Container */}
      <div
        className="browser-webview-container"
        style={{ height: PANEL_HEIGHT - TOOLBAR_HEIGHT - TAB_BAR_HEIGHT }}
      >
        {isLoading && (
          <div className="browser-loading">
            <div className="browser-loading-spinner" />
          </div>
        )}
        {webviewHidden && (
          <div className="browser-placeholder">
            <Globe size={32} strokeWidth={1} />
            <span>Browser paused</span>
          </div>
        )}
      </div>
    </div>
  );
}
