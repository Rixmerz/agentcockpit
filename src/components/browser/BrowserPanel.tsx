import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Globe, Plus } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  createBrowserWebview,
  showBrowserWebview,
  hideBrowserWebview,
  hideAllBrowserWebviews,
  closeBrowserWebview,
  navigateTo,
  refresh,
  updatePosition,
  getTabState,
  onUrlChange,
  switchTab,
} from '../../services/browserService';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  history: string[];
  historyIndex: number;
  webviewCreated: boolean;
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
  webviewCreated: false,
});

const getTabTitle = (url: string): string => {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return hostname || 'New Tab';
  } catch {
    return 'New Tab';
  }
};

const isValidUrl = (input: string): boolean => {
  // Si tiene protocolo explícito
  if (/^https?:\/\//i.test(input)) {
    try {
      new URL(input);
      return true;
    } catch {
      return false;
    }
  }
  // Si parece dominio (ejemplo.com, sub.ejemplo.com)
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}(\/.*)?$/.test(input)) {
    return true;
  }
  // Si es localhost o IP
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/.test(input)) {
    return true;
  }
  return false;
};

const toNavigableUrl = (input: string): string => {
  const trimmed = input.trim();
  if (isValidUrl(trimmed)) {
    // Agregar https:// si no tiene protocolo
    if (!/^https?:\/\//i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return trimmed;
  }
  // Es búsqueda → Google
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
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
  const [webviewsHidden, setWebviewsHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveTabRef = useRef<string | null>(null);

  // Get active tab
  const activeTab = tabs.find(t => t.id === activeTabId);
  const canGoBack = activeTab ? activeTab.historyIndex > 0 : false;
  const canGoForward = activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false;

  // Update a specific tab's URL
  const updateTabUrl = useCallback((tabId: string, newUrl: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== tabId) return tab;

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

    // Update input if this is the active tab
    if (tabId === activeTabId) {
      setInputUrl(newUrl);
    }
  }, [activeTabId]);

  // Hide all webviews when panel closes
  useEffect(() => {
    if (!isOpen) {
      hideAllBrowserWebviews();
      setWebviewsHidden(true);
    }
  }, [isOpen]);

  // Hide all webviews when idle or modal is open
  useEffect(() => {
    const shouldHide = isIdle || hideForModal;

    if (shouldHide && isOpen) {
      // Always hide when entering idle/modal state
      console.log('[BrowserPanel] Hiding webviews - idle:', isIdle, 'modal:', hideForModal);
      hideAllBrowserWebviews();
      setWebviewsHidden(true);
    } else if (!shouldHide && isOpen && webviewsHidden) {
      // Only show when exiting idle/modal AND webviews were hidden
      const timer = setTimeout(() => {
        console.log('[BrowserPanel] Showing webview for active tab:', activeTabId);
        if (activeTabId) {
          showBrowserWebview(activeTabId);
        }
        setWebviewsHidden(false);
      }, IDLE_FADE_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isIdle, hideForModal, isOpen, webviewsHidden, activeTabId]);

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

  // Initialize webview for active tab
  useEffect(() => {
    if (!isOpen || !activeTab) return;

    let mounted = true;

    const initWebview = async () => {
      await new Promise(r => setTimeout(r, 100));
      if (!mounted) return;

      const position = getPosition();
      if (!position) return;

      const tabState = getTabState(activeTab.id);

      if (activeTab.webviewCreated && tabState?.isOpen) {
        // Webview exists, just show it and update position
        if (!tabState.isVisible) {
          await showBrowserWebview(activeTab.id);
        }
        await updatePosition(position, activeTab.id);
      } else if (!activeTab.webviewCreated) {
        // Create new webview for this tab
        setIsLoading(true);
        try {
          await createBrowserWebview(activeTab.url, position, activeTab.id);
          if (mounted) {
            setTabs(prev => prev.map(tab =>
              tab.id === activeTab.id ? { ...tab, webviewCreated: true } : tab
            ));
          }
        } catch (err) {
          console.error('[BrowserPanel] Error creating webview:', err);
        } finally {
          if (mounted) setIsLoading(false);
        }
      }
    };

    const timeoutId = setTimeout(initWebview, 50);
    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [isOpen, activeTab?.id, activeTab?.url, activeTab?.webviewCreated, getPosition]);

  // Subscribe to URL changes
  useEffect(() => {
    if (!isOpen) return;

    onUrlChange((newUrl: string, tabId: string) => {
      console.log('[BrowserPanel] URL changed for tab', tabId, ':', newUrl);
      updateTabUrl(tabId, newUrl);
    });
  }, [isOpen, updateTabUrl]);

  // Sync input URL with active tab
  useEffect(() => {
    if (activeTab) {
      setInputUrl(activeTab.url);
    }
  }, [activeTabId, activeTab?.url]);

  // Handle window resize/move - update position for active tab
  useEffect(() => {
    if (!isOpen || !activeTab?.webviewCreated) return;

    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    let rafId: number;

    const handlePositionUpdate = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const position = getPosition();
        if (position && activeTabId) {
          updatePosition(position, activeTabId);
        }
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
  }, [isOpen, activeTab?.webviewCreated, activeTabId, getPosition]);

  // Tab actions
  const handleNewTab = useCallback(async () => {
    const newTab = createNewTab();
    setTabs(prev => [...prev, newTab]);

    // Hide current tab's webview
    if (activeTabId) {
      await hideBrowserWebview(activeTabId);
    }

    previousActiveTabRef.current = activeTabId;
    setActiveTabId(newTab.id);
    // The useEffect will handle creating the webview
  }, [activeTabId]);

  const handleCloseTab = useCallback(async (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Close the webview for this tab
    await closeBrowserWebview(tabId);

    setTabs(prev => {
      if (prev.length === 1) {
        // Don't close last tab, just reset it
        const resetTab = createNewTab();
        return [resetTab];
      }

      const newTabs = prev.filter(t => t.id !== tabId);

      // If closing active tab, switch to adjacent tab
      if (tabId === activeTabId) {
        const closedIndex = prev.findIndex(t => t.id === tabId);
        const newActiveTab = newTabs[Math.min(closedIndex, newTabs.length - 1)];
        setActiveTabId(newActiveTab.id);
      }

      return newTabs;
    });
  }, [activeTabId]);

  const handleSwitchTab = useCallback(async (tabId: string) => {
    if (tabId === activeTabId) return;

    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    setIsLoading(true);

    // Switch webviews (hide old, show new)
    await switchTab(activeTabId, tabId);

    previousActiveTabRef.current = activeTabId;
    setActiveTabId(tabId);
    setInputUrl(tab.url);

    // If the new tab's webview doesn't exist yet, it will be created by useEffect
    if (tab.webviewCreated) {
      // Update position for the newly visible webview
      const position = getPosition();
      if (position) {
        await updatePosition(position, tabId);
      }
    }

    setIsLoading(false);
  }, [activeTabId, tabs, getPosition]);

  // Navigation actions
  const handleNavigate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim() || !activeTabId) return;
    const url = toNavigableUrl(inputUrl);
    setIsLoading(true);
    await navigateTo(url, activeTabId);
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
    await navigateTo(newUrl, activeTabId);
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
    await navigateTo(newUrl, activeTabId);
    setInputUrl(newUrl);
    setIsLoading(false);
  };

  const handleRefresh = async () => {
    if (!activeTabId) return;
    setIsLoading(true);
    await refresh(activeTabId);
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
              placeholder="Search or enter URL..."
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
        {webviewsHidden && (
          <div className="browser-placeholder">
            <Globe size={32} strokeWidth={1} />
            <span>Browser paused</span>
          </div>
        )}
      </div>
    </div>
  );
}
