import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';

interface BrowserWebviewState {
  webview: WebviewWindow | null;
  url: string;
  history: string[];
  historyIndex: number;
  lastPosition: BrowserPosition | null;
}

const state: BrowserWebviewState = {
  webview: null,
  url: '',
  history: [],
  historyIndex: -1,
  lastPosition: null,
};

export interface BrowserPosition {
  x: number;
  y: number;
  width: number;
  height: number;
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

  console.log('[browserService] Creating webview with URL:', url, 'position:', position);

  // Create new webview window - test without parent first
  // Position needs to be in SCREEN coordinates, not window-relative
  const webview = new WebviewWindow('browser-webview', {
    url,
    // parent: 'main', // Temporarily disabled to test
    x: Math.round(position.x),
    y: Math.round(position.y),
    width: Math.round(position.width),
    height: Math.round(position.height),
    decorations: true, // Temporarily enable to see the window
    transparent: false,
    resizable: true,
    focus: true,
    alwaysOnTop: true, // Ensure it's visible
    skipTaskbar: false, // Show in taskbar for debugging
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
 * Closes the browser webview
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
    await state.webview.setPosition(
      new PhysicalPosition(Math.round(position.x), Math.round(position.y))
    );
    await state.webview.setSize(
      new PhysicalSize(Math.round(position.width), Math.round(position.height))
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
