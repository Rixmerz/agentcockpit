import { useRef, useEffect, useState, useCallback } from 'react';
import { TauriBrowserView } from '../services/tauriBrowserView';
import {
  hideAllBrowserWebviews,
  getTabState,
} from '../services/browserService';

export interface UseTauriBrowserViewOptions {
  /** Active tab ID, or null for no webview. */
  tabId: string | null;
  /** URL to load when creating a new webview for this tab. */
  url: string;
  /** false when idle, modal open, panel closed, etc. */
  enabled: boolean;
  /** Called when webview creation completes for a tab. */
  onWebviewCreated?: (tabId: string) => void;
}

export interface UseTauriBrowserViewReturn {
  /** Attach this ref to the .browser-webview-container div. */
  containerRef: React.RefCallback<HTMLDivElement>;
  /** True once the active tab's webview is created and positioned. */
  isReady: boolean;
  /** Last error from webview creation, if any. */
  error: Error | null;
}

/**
 * React hook that manages TauriBrowserView instances per active tab.
 *
 * - Creates webviews on demand when tabId changes to a new (uncreated) tab.
 * - Shows/hides existing webviews when switching tabs.
 * - Hides webviews when `enabled` becomes false (idle, modal, panel close).
 * - Automatically cleans up on unmount.
 */
export function useTauriBrowserView(
  options: UseTauriBrowserViewOptions
): UseTauriBrowserViewReturn {
  const { tabId, url, enabled, onWebviewCreated } = options;

  // Track the actual DOM element via callback ref
  const containerElRef = useRef<HTMLDivElement | null>(null);

  // Map of tabId -> TauriBrowserView instance (persists across renders)
  const viewsRef = useRef<Map<string, TauriBrowserView>>(new Map());

  // Track previous tabId for switching
  const prevTabIdRef = useRef<string | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Callback ref for the container
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerElRef.current = node;
  }, []);

  // Create or show webview when tabId changes
  useEffect(() => {
    if (!tabId || !enabled) return;

    let cancelled = false;

    const initTab = async () => {
      const containerEl = containerElRef.current;
      if (!containerEl) {
        // Container not mounted yet; wait a frame and retry once
        await new Promise(r => requestAnimationFrame(r));
        if (cancelled || !containerElRef.current) return;
      }
      const el = containerElRef.current;
      if (!el || cancelled) return;

      const prevTabId = prevTabIdRef.current;

      // If switching from a previous tab, hide it
      if (prevTabId && prevTabId !== tabId) {
        const prevView = viewsRef.current.get(prevTabId);
        if (prevView) {
          await prevView.hide();
        }
      }

      setIsReady(false);
      setError(null);

      // Check if we already have a view for this tab
      let view = viewsRef.current.get(tabId);
      const tabState = getTabState(tabId);

      if (view && view.getIsCreated()) {
        // Webview already exists — show it and re-attach observer
        view.reattach(el);
        await view.show();
        setIsReady(true);
      } else if (tabState?.isOpen) {
        // Webview was created outside this hook (e.g., from a previous session)
        // Create a TauriBrowserView wrapper that knows it's already created
        view = new TauriBrowserView(tabId);
        viewsRef.current.set(tabId, view);
        // We can't call attach() since webview already exists; just reattach observer
        // and sync position via the service
        view.reattach(el);
        await view.show();
        setIsReady(true);
      } else {
        // Need to create a new webview
        view = new TauriBrowserView(tabId);
        viewsRef.current.set(tabId, view);

        try {
          await view.attach(el, url);
          if (!cancelled) {
            setIsReady(true);
            onWebviewCreated?.(tabId);
          }
        } catch (err) {
          if (!cancelled) {
            const e = err instanceof Error ? err : new Error(String(err));
            console.error('[useTauriBrowserView] Error creating webview:', e);
            setError(e);
          }
        }
      }

      prevTabIdRef.current = tabId;
    };

    initTab();

    return () => {
      cancelled = true;
    };
  }, [tabId, enabled, url, onWebviewCreated]);

  // Handle enabled toggling (hide/show without destroying)
  useEffect(() => {
    if (!tabId) return;

    const view = viewsRef.current.get(tabId);
    if (!view || !view.getIsCreated()) return;

    if (!enabled) {
      view.hide();
    } else {
      view.show();
    }
  }, [enabled, tabId]);

  // Hide all on unmount
  useEffect(() => {
    return () => {
      hideAllBrowserWebviews();
      // Detach all views (don't destroy — browser might reuse)
      for (const view of viewsRef.current.values()) {
        view.detach();
      }
      viewsRef.current.clear();
    };
  }, []);

  return { containerRef, isReady, error };
}
