import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface BrowserState {
  isOpen: boolean;
  isVisible: boolean;
  url: string;
  history: string[];
  historyIndex: number;
}

const state: BrowserState = {
  isOpen: false,
  isVisible: false,
  url: '',
  history: [],
  historyIndex: -1,
};

export interface BrowserPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Listener for URL changes from Rust
let urlChangeListener: UnlistenFn | null = null;
let onUrlChangeCallback: ((url: string) => void) | null = null;

/**
 * Set callback for URL changes (called when user navigates inside webview)
 */
export function onUrlChange(callback: (url: string) => void): void {
  onUrlChangeCallback = callback;
}

/**
 * Setup the URL change listener
 */
async function setupUrlListener(): Promise<void> {
  if (urlChangeListener) return;

  urlChangeListener = await listen<{ url: string }>('browser-url-changed', (event) => {
    const newUrl = event.payload.url;
    console.log('[browserService] URL changed event:', newUrl);

    // Update internal state
    if (newUrl !== state.url) {
      state.url = newUrl;
      // Add to history
      if (state.history[state.historyIndex] !== newUrl) {
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(newUrl);
        state.historyIndex = state.history.length - 1;
      }
      // Notify callback
      if (onUrlChangeCallback) {
        onUrlChangeCallback(newUrl);
      }
    }
  });
}

/**
 * Converts viewport-relative coordinates to screen coordinates
 */
async function toScreenCoordinates(position: BrowserPosition): Promise<BrowserPosition> {
  try {
    const mainWindow = getCurrentWindow();
    const outerPos = await mainWindow.outerPosition();
    const innerPos = await mainWindow.innerPosition();
    const scaleFactor = await mainWindow.scaleFactor();

    const windowX = outerPos.x / scaleFactor;
    const windowY = outerPos.y / scaleFactor;
    const titleBarHeight = (innerPos.y - outerPos.y) / scaleFactor;
    const extraPadding = 24;

    return {
      x: windowX + position.x,
      y: windowY + position.y + titleBarHeight + extraPadding,
      width: position.width,
      height: position.height - extraPadding,
    };
  } catch (e) {
    console.warn('[browserService] Could not get window position:', e);
    return position;
  }
}

/**
 * Normalizes a URL
 */
function normalizeUrl(url: string): string {
  if (!url) return 'https://google.com';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }
  return url;
}

/**
 * Creates the browser webview
 */
export async function createBrowserWebview(
  url: string,
  position: BrowserPosition
): Promise<void> {
  const normalizedUrl = normalizeUrl(url);
  const screenPos = await toScreenCoordinates(position);

  console.log('[browserService] Creating webview:', { url: normalizedUrl, screenPos });

  // Setup listener before creating webview
  await setupUrlListener();

  await invoke('browser_create', {
    url: normalizedUrl,
    position: screenPos,
  });

  state.isOpen = true;
  state.isVisible = true;
  state.url = normalizedUrl;
  state.history = [normalizedUrl];
  state.historyIndex = 0;
}

/**
 * Shows the browser webview
 */
export async function showBrowserWebview(): Promise<void> {
  if (!state.isOpen) return;

  await invoke('browser_show');
  state.isVisible = true;
}

/**
 * Hides the browser webview
 */
export async function hideBrowserWebview(): Promise<void> {
  if (!state.isOpen) return;

  try {
    await invoke('browser_hide');
    state.isVisible = false;
  } catch (e) {
    console.warn('[browserService] Error hiding webview:', e);
  }
}

/**
 * Closes the browser webview completely
 */
export async function closeBrowserWebview(): Promise<void> {
  try {
    await invoke('browser_close');
  } catch (e) {
    console.warn('[browserService] Error closing webview:', e);
  }

  state.isOpen = false;
  state.isVisible = false;
  state.url = '';
  state.history = [];
  state.historyIndex = -1;
}

/**
 * Navigates to a URL
 */
export async function navigateTo(url: string): Promise<void> {
  const normalizedUrl = normalizeUrl(url);

  console.log('[browserService] Navigating to:', normalizedUrl);

  // Update history
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(normalizedUrl);
  state.historyIndex = state.history.length - 1;
  state.url = normalizedUrl;

  await invoke('browser_navigate', { url: normalizedUrl });
}

/**
 * Goes back in history
 */
export async function goBack(): Promise<boolean> {
  if (state.historyIndex <= 0) {
    return false;
  }

  state.historyIndex--;
  state.url = state.history[state.historyIndex];

  await invoke('browser_navigate', { url: state.url });
  return true;
}

/**
 * Goes forward in history
 */
export async function goForward(): Promise<boolean> {
  if (state.historyIndex >= state.history.length - 1) {
    return false;
  }

  state.historyIndex++;
  state.url = state.history[state.historyIndex];

  await invoke('browser_navigate', { url: state.url });
  return true;
}

/**
 * Refreshes current page
 */
export async function refresh(): Promise<void> {
  if (state.url) {
    await invoke('browser_navigate', { url: state.url });
  }
}

/**
 * Updates webview position/size
 */
export async function updatePosition(position: BrowserPosition): Promise<void> {
  if (!state.isOpen) return;

  try {
    const screenPos = await toScreenCoordinates(position);
    await invoke('browser_set_position', { position: screenPos });
  } catch (e) {
    console.warn('[browserService] Error updating position:', e);
  }
}

/**
 * Gets current state
 */
export function getBrowserState() {
  return {
    isOpen: state.isOpen,
    isVisible: state.isVisible,
    url: state.url,
    canGoBack: state.historyIndex > 0,
    canGoForward: state.historyIndex < state.history.length - 1,
  };
}
