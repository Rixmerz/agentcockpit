import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';

interface BrowserWebviewState {
  webview: WebviewWindow | null;
  url: string;
  history: string[];
  historyIndex: number;
  lastPosition: BrowserPosition | null;
  isVisible: boolean;
}

const state: BrowserWebviewState = {
  webview: null,
  url: '',
  history: [],
  historyIndex: -1,
  lastPosition: null,
  isVisible: false,
};

export interface BrowserPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts viewport-relative coordinates to screen coordinates
 */
async function toScreenCoordinates(position: BrowserPosition): Promise<BrowserPosition> {
  try {
    const mainWindow = getCurrentWindow();
    const windowPos = await mainWindow.outerPosition();
    const scaleFactor = await mainWindow.scaleFactor();

    // Window position is in physical pixels, convert to logical
    const windowX = windowPos.x / scaleFactor;
    const windowY = windowPos.y / scaleFactor;

    // Add window position to get screen coordinates
    // Also account for title bar height (approximately 28px on macOS)
    const titleBarHeight = 28;

    return {
      x: windowX + position.x,
      y: windowY + position.y + titleBarHeight,
      width: position.width,
      height: position.height,
    };
  } catch (e) {
    console.warn('[browserService] Could not get window position, using relative:', e);
    return position;
  }
}

/**
 * Internal: Creates or recreates the webview window
 */
async function createWebviewWindow(url: string, position: BrowserPosition): Promise<WebviewWindow> {
  // Close existing webview if any
  if (state.webview) {
    try {
      await state.webview.close();
    } catch (e) {
      console.warn('[browserService] Error closing old webview:', e);
    }
    state.webview = null;
  }

  // Convert to screen coordinates
  const screenPos = await toScreenCoordinates(position);

  console.log('[browserService] Creating webview:', {
    url,
    viewportPos: position,
    screenPos,
  });

  // Create new webview window as child of main window
  const webview = new WebviewWindow('browser-webview', {
    url,
    parent: 'main',
    x: Math.round(screenPos.x),
    y: Math.round(screenPos.y),
    width: Math.round(screenPos.width),
    height: Math.round(screenPos.height),
    decorations: false,
    transparent: false,
    resizable: false,
    focus: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    visible: true,
  });

  // Wait for webview to be created
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Webview creation timed out'));
    }, 10000);

    webview.once('tauri://created', () => {
      clearTimeout(timeout);
      console.log('[browserService] Webview created successfully');
      resolve();
    });
    webview.once('tauri://error', (e) => {
      clearTimeout(timeout);
      console.error('[browserService] Webview creation error:', e);
      reject(new Error(`Failed to create webview: ${JSON.stringify(e)}`));
    });
  });

  state.webview = webview;
  state.lastPosition = position;
  state.isVisible = true;

  return webview;
}

/**
 * Normalizes a URL (adds https:// if missing)
 */
function normalizeUrl(url: string): string {
  if (!url) return 'https://google.com';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'https://' + url;
  }
  return url;
}

/**
 * Creates the browser webview with initial URL
 */
export async function createBrowserWebview(
  url: string,
  position: BrowserPosition
): Promise<WebviewWindow> {
  const normalizedUrl = normalizeUrl(url);

  // Initialize history with this URL
  state.url = normalizedUrl;
  state.history = [normalizedUrl];
  state.historyIndex = 0;

  return createWebviewWindow(normalizedUrl, position);
}

/**
 * Shows/hides the browser webview (toggle visibility)
 */
export async function toggleBrowserVisibility(): Promise<boolean> {
  if (!state.webview) return false;

  try {
    if (state.isVisible) {
      await state.webview.hide();
      state.isVisible = false;
    } else {
      await state.webview.show();
      state.isVisible = true;
    }
    return state.isVisible;
  } catch (e) {
    console.warn('[browserService] Error toggling visibility:', e);
    return state.isVisible;
  }
}

/**
 * Hides the browser webview (keeps state)
 */
export async function hideBrowserWebview(): Promise<void> {
  if (state.webview && state.isVisible) {
    try {
      await state.webview.hide();
      state.isVisible = false;
    } catch (e) {
      console.warn('[browserService] Error hiding webview:', e);
    }
  }
}

/**
 * Shows the browser webview
 */
export async function showBrowserWebview(): Promise<void> {
  if (state.webview && !state.isVisible) {
    try {
      await state.webview.show();
      state.isVisible = true;
    } catch (e) {
      console.warn('[browserService] Error showing webview:', e);
    }
  }
}

/**
 * Closes the browser webview completely
 */
export async function closeBrowserWebview(): Promise<void> {
  if (state.webview) {
    try {
      await state.webview.close();
    } catch (e) {
      console.warn('[browserService] Error closing webview:', e);
    }
    state.webview = null;
  }
  // Reset state
  state.url = '';
  state.history = [];
  state.historyIndex = -1;
  state.lastPosition = null;
  state.isVisible = false;
}

/**
 * Navigates to a URL
 */
export async function navigateTo(url: string): Promise<void> {
  const normalizedUrl = normalizeUrl(url);

  console.log('[browserService] Navigating to:', normalizedUrl);

  // Update history - trim forward history and add new URL
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(normalizedUrl);
  state.historyIndex = state.history.length - 1;
  state.url = normalizedUrl;

  // Recreate webview with new URL (Tauri doesn't have navigate API)
  if (state.lastPosition) {
    await createWebviewWindow(normalizedUrl, state.lastPosition);
  } else {
    console.warn('[browserService] No position available for navigation');
  }
}

/**
 * Goes back in history
 */
export async function goBack(): Promise<boolean> {
  if (state.historyIndex <= 0) {
    console.log('[browserService] Cannot go back, at start of history');
    return false;
  }

  state.historyIndex--;
  state.url = state.history[state.historyIndex];

  console.log('[browserService] Going back to:', state.url);

  if (state.lastPosition) {
    await createWebviewWindow(state.url, state.lastPosition);
  }

  return true;
}

/**
 * Goes forward in history
 */
export async function goForward(): Promise<boolean> {
  if (state.historyIndex >= state.history.length - 1) {
    console.log('[browserService] Cannot go forward, at end of history');
    return false;
  }

  state.historyIndex++;
  state.url = state.history[state.historyIndex];

  console.log('[browserService] Going forward to:', state.url);

  if (state.lastPosition) {
    await createWebviewWindow(state.url, state.lastPosition);
  }

  return true;
}

/**
 * Refreshes current page
 */
export async function refresh(): Promise<void> {
  console.log('[browserService] Refreshing:', state.url);

  if (state.lastPosition && state.url) {
    await createWebviewWindow(state.url, state.lastPosition);
  }
}

/**
 * Updates webview position/size
 */
export async function updatePosition(position: BrowserPosition): Promise<void> {
  state.lastPosition = position;

  if (!state.webview) return;

  try {
    const screenPos = await toScreenCoordinates(position);
    await state.webview.setPosition(
      new PhysicalPosition(Math.round(screenPos.x), Math.round(screenPos.y))
    );
    await state.webview.setSize(
      new PhysicalSize(Math.round(screenPos.width), Math.round(screenPos.height))
    );
  } catch (e) {
    console.warn('[browserService] Error updating position:', e);
  }
}

/**
 * Gets current state
 */
export function getBrowserState() {
  return {
    isOpen: state.webview !== null,
    isVisible: state.isVisible,
    url: state.url,
    canGoBack: state.historyIndex > 0,
    canGoForward: state.historyIndex < state.history.length - 1,
  };
}

/**
 * Gets the webview instance
 */
export function getWebview(): WebviewWindow | null {
  return state.webview;
}

/**
 * Check if webview exists and is visible
 */
export function isBrowserVisible(): boolean {
  return state.webview !== null && state.isVisible;
}
