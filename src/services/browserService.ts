import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';

interface BrowserWebviewState {
  webview: WebviewWindow | null;
  url: string;
  history: string[];
  historyIndex: number;
}

const state: BrowserWebviewState = {
  webview: null,
  url: 'https://google.com',
  history: ['https://google.com'],
  historyIndex: 0,
};

export interface BrowserPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Creates a browser webview attached to the main window
 */
export async function createBrowserWebview(
  url: string,
  position: BrowserPosition
): Promise<WebviewWindow> {
  // Close existing webview if any
  await closeBrowserWebview();

  const mainWindow = getCurrentWindow();

  // Create new webview
  const webview = new WebviewWindow('browser-webview', {
    url,
    parent: mainWindow,
    x: position.x,
    y: position.y,
    width: position.width,
    height: position.height,
    decorations: false,
    transparent: false,
    resizable: false,
    focus: false,
  });

  // Wait for webview to be created
  await new Promise<void>((resolve, reject) => {
    webview.once('tauri://created', () => resolve());
    webview.once('tauri://error', (e) => reject(e));
  });

  state.webview = webview;
  state.url = url;
  state.history = [url];
  state.historyIndex = 0;

  return webview;
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
}

/**
 * Navigates to a URL
 */
export async function navigateTo(url: string): Promise<void> {
  if (!state.webview) {
    console.warn('[browserService] No webview to navigate');
    return;
  }

  // Normalize URL
  let normalizedUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    normalizedUrl = 'https://' + url;
  }

  // Update history
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(normalizedUrl);
  state.historyIndex = state.history.length - 1;
  state.url = normalizedUrl;

  // Navigate by recreating the webview with new URL
  // Note: Tauri 2 doesn't have a direct navigate method for webviews
  const currentPosition = await getWebviewPosition();
  if (currentPosition) {
    await createBrowserWebview(normalizedUrl, currentPosition);
  }
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

  const currentPosition = await getWebviewPosition();
  if (currentPosition && state.webview) {
    await createBrowserWebview(state.url, currentPosition);
  }

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

  const currentPosition = await getWebviewPosition();
  if (currentPosition && state.webview) {
    await createBrowserWebview(state.url, currentPosition);
  }

  return true;
}

/**
 * Refreshes current page
 */
export async function refresh(): Promise<void> {
  const currentPosition = await getWebviewPosition();
  if (currentPosition && state.url) {
    await createBrowserWebview(state.url, currentPosition);
  }
}

/**
 * Updates webview position/size
 */
export async function updatePosition(position: BrowserPosition): Promise<void> {
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
 * Gets current webview position
 */
async function getWebviewPosition(): Promise<BrowserPosition | null> {
  if (!state.webview) return null;

  try {
    const pos = await state.webview.innerPosition();
    const size = await state.webview.innerSize();
    return {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
    };
  } catch {
    return null;
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
