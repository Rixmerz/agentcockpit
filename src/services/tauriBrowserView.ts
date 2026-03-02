import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  createBrowserWebview,
  showBrowserWebview,
  hideBrowserWebview,
  updatePosition,
  type BrowserPosition,
} from './browserService';

const LOG_PREFIX = '[TauriBrowserView]';

/** Polls getBoundingClientRect until size is non-zero and stable. Max 1s. */
function waitForStability(el: HTMLElement): Promise<DOMRect> {
  return new Promise((resolve, reject) => {
    let lastRect: DOMRect | null = null;
    let stableCount = 0;
    let elapsed = 0;
    const INTERVAL = 50;
    const MAX_WAIT = 1000;

    const timer = setInterval(() => {
      elapsed += INTERVAL;
      const rect = el.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        if (
          lastRect &&
          Math.abs(rect.width - lastRect.width) < 1 &&
          Math.abs(rect.height - lastRect.height) < 1 &&
          Math.abs(rect.x - lastRect.x) < 1 &&
          Math.abs(rect.y - lastRect.y) < 1
        ) {
          stableCount++;
        } else {
          stableCount = 0;
        }
        lastRect = rect;

        // Two consecutive stable reads
        if (stableCount >= 1) {
          clearInterval(timer);
          resolve(rect);
          return;
        }
      }

      if (elapsed >= MAX_WAIT) {
        clearInterval(timer);
        if (lastRect && lastRect.width > 0 && lastRect.height > 0) {
          console.warn(LOG_PREFIX, 'Stability timeout, using last good rect');
          resolve(lastRect);
        } else {
          reject(new Error('Container never reached non-zero size'));
        }
      }
    }, INTERVAL);
  });
}

export interface TauriBrowserViewOptions {
  tabId: string;
  url: string;
  onCreated?: () => void;
  onError?: (error: Error) => void;
}

/**
 * TauriBrowserView — keeps a native Tauri child webview perfectly aligned
 * with a DOM container element. Like Electron's BrowserView, but for Tauri.
 *
 * Handles: ResizeObserver, layout stability, platform normalization,
 * bounds clamping, and RAF-throttled position updates.
 */
export class TauriBrowserView {
  private containerEl: HTMLElement | null = null;
  private tabId: string;
  private isCreated = false;
  private isVisible = false;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private windowUnlistenMove: (() => void) | null = null;
  private windowUnlistenResize: (() => void) | null = null;
  private destroyed = false;

  constructor(tabId: string) {
    this.tabId = tabId;
  }

  /** Calculate floored bounds from the container element. */
  private calculateBounds(): BrowserPosition | null {
    if (!this.containerEl) return null;
    const rect = this.containerEl.getBoundingClientRect();

    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    if (width <= 0 || height <= 0) return null;

    return {
      x: Math.floor(rect.left),
      y: Math.floor(rect.top),
      width,
      height,
    };
  }

  /** Sync the native webview position with the DOM container (RAF-throttled). */
  syncPosition = (): void => {
    if (this.destroyed || !this.isCreated) return;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }

    this.rafId = requestAnimationFrame(async () => {
      this.rafId = null;
      const bounds = this.calculateBounds();
      if (!bounds) return;

      console.log(LOG_PREFIX, `syncPosition tab=${this.tabId}`, bounds);

      // Use browserService.updatePosition which handles platform coordinate conversion
      await updatePosition(bounds, this.tabId);
    });
  };

  /** Start observing the container for size/position changes. */
  private startObserving(): void {
    if (!this.containerEl) return;

    // ResizeObserver on the container
    this.resizeObserver = new ResizeObserver(() => {
      this.syncPosition();
    });
    this.resizeObserver.observe(this.containerEl);

    // Window resize
    window.addEventListener('resize', this.syncPosition);

    // Tauri window move/resize
    const setupTauriListeners = async () => {
      try {
        const mainWindow = getCurrentWindow();
        this.windowUnlistenMove = await mainWindow.onMoved(() => this.syncPosition());
        this.windowUnlistenResize = await mainWindow.onResized(() => this.syncPosition());
      } catch (e) {
        console.warn(LOG_PREFIX, 'Could not setup Tauri window listeners:', e);
      }
    };
    setupTauriListeners();
  }

  /** Stop all observers and listeners. */
  private stopObserving(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    window.removeEventListener('resize', this.syncPosition);

    this.windowUnlistenMove?.();
    this.windowUnlistenMove = null;
    this.windowUnlistenResize?.();
    this.windowUnlistenResize = null;
  }

  /**
   * Attach to a DOM element, wait for stable layout, create the webview,
   * and start observing for future layout changes.
   */
  async attach(containerEl: HTMLElement, url: string): Promise<void> {
    if (this.destroyed) return;

    this.containerEl = containerEl;

    // Wait for the container to have stable, non-zero dimensions
    console.log(LOG_PREFIX, `Waiting for stability tab=${this.tabId}`);
    const stableRect = await waitForStability(containerEl);

    if (this.destroyed) return;

    // Pass raw viewport coords — createBrowserWebview handles platform conversion
    const bounds: BrowserPosition = {
      x: Math.floor(stableRect.left),
      y: Math.floor(stableRect.top),
      width: Math.floor(stableRect.width),
      height: Math.floor(stableRect.height),
    };

    console.log(LOG_PREFIX, `Creating webview tab=${this.tabId}`, bounds);

    await createBrowserWebview(url, bounds, this.tabId);
    this.isCreated = true;
    this.isVisible = true;

    // Start observing for future layout changes
    this.startObserving();

    // Re-sync position after short delays to catch GTK layout passes
    // that may override initial sizing
    if (!this.destroyed) {
      setTimeout(() => this.syncPosition(), 100);
      setTimeout(() => this.syncPosition(), 500);
    }
  }

  /** Detach: stop observing. Does NOT close the webview (tab might be reused). */
  detach(): void {
    this.stopObserving();
    this.containerEl = null;
  }

  /** Fully destroy: stop observing and close the webview. */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.stopObserving();
    this.containerEl = null;
    this.isCreated = false;
    this.isVisible = false;
  }

  /** Show the webview and sync its position. */
  async show(): Promise<void> {
    if (this.destroyed || !this.isCreated) return;
    await showBrowserWebview(this.tabId);
    this.isVisible = true;
    this.syncPosition();
  }

  /** Hide the webview. */
  async hide(): Promise<void> {
    if (this.destroyed || !this.isCreated) return;
    await hideBrowserWebview(this.tabId);
    this.isVisible = false;
  }

  /** Re-attach to a (possibly new) container element and resume observing. */
  reattach(containerEl: HTMLElement): void {
    if (this.destroyed) return;
    this.stopObserving();
    this.containerEl = containerEl;
    this.startObserving();
    this.syncPosition();
  }

  getTabId(): string {
    return this.tabId;
  }

  getIsCreated(): boolean {
    return this.isCreated;
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
