import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface TabState {
  isOpen: boolean;
  isVisible: boolean;
  url: string;
}

export interface MediaState {
  tabId: string;
  platform: 'youtube' | 'youtube-music' | 'unknown';
  title: string;
  isPlaying: boolean;
  duration: number;
  currentTime: number;
}

export type MediaCommand = 'play' | 'pause' | 'toggle' | 'next' | 'prev';

// Track state per tab
const tabStates: Map<string, TabState> = new Map();

export interface BrowserPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Listener for URL changes from Rust
let urlChangeListener: UnlistenFn | null = null;
let onUrlChangeCallback: ((url: string, tabId: string) => void) | null = null;

/**
 * Set callback for URL changes (called when user navigates inside webview)
 */
export function onUrlChange(callback: (url: string, tabId: string) => void): void {
  onUrlChangeCallback = callback;
}

/**
 * Setup the URL change listener
 */
async function setupUrlListener(): Promise<void> {
  if (urlChangeListener) return;

  urlChangeListener = await listen<{ url: string; tab_id: string }>('browser-url-changed', (event) => {
    const { url: newUrl, tab_id: tabId } = event.payload;

    // Skip invalid URLs
    if (!newUrl ||
        newUrl.startsWith('about:') ||
        newUrl.startsWith('blob:') ||
        newUrl.startsWith('data:')) {
      console.log('[browserService] Ignoring internal URL:', newUrl);
      return;
    }

    console.log('[browserService] URL changed event for tab', tabId, ':', newUrl);

    // Update tab state
    const tabState = tabStates.get(tabId);
    if (tabState && newUrl !== tabState.url) {
      tabState.url = newUrl;
      // Notify callback
      if (onUrlChangeCallback) {
        onUrlChangeCallback(newUrl, tabId);
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
 * Creates a browser webview for a specific tab
 */
export async function createBrowserWebview(
  url: string,
  position: BrowserPosition,
  tabId: string
): Promise<void> {
  const normalizedUrl = normalizeUrl(url);
  const screenPos = await toScreenCoordinates(position);

  console.log('[browserService] Creating webview for tab', tabId, ':', { url: normalizedUrl, screenPos });

  // Setup listeners before creating webview
  await setupUrlListener();
  await setupMediaListener();

  await invoke('browser_create', {
    url: normalizedUrl,
    position: screenPos,
    tabId,
  });

  tabStates.set(tabId, {
    isOpen: true,
    isVisible: true,
    url: normalizedUrl,
  });
}

/**
 * Shows a specific tab's webview
 */
export async function showBrowserWebview(tabId: string): Promise<void> {
  const tabState = tabStates.get(tabId);
  if (!tabState?.isOpen) return;

  await invoke('browser_show', { tabId });
  tabState.isVisible = true;
}

/**
 * Hides a specific tab's webview
 */
export async function hideBrowserWebview(tabId: string): Promise<void> {
  const tabState = tabStates.get(tabId);
  if (!tabState?.isOpen) return;

  try {
    await invoke('browser_hide', { tabId });
    tabState.isVisible = false;
  } catch (e) {
    console.warn('[browserService] Error hiding webview for tab', tabId, ':', e);
  }
}

/**
 * Hides all webviews (used when browser panel closes or goes idle)
 */
export async function hideAllBrowserWebviews(): Promise<void> {
  try {
    await invoke('browser_hide_all');
    for (const tabState of tabStates.values()) {
      tabState.isVisible = false;
    }
  } catch (e) {
    console.warn('[browserService] Error hiding all webviews:', e);
  }
}

/**
 * Closes a specific tab's webview
 */
export async function closeBrowserWebview(tabId: string): Promise<void> {
  try {
    await invoke('browser_close', { tabId });
  } catch (e) {
    console.warn('[browserService] Error closing webview for tab', tabId, ':', e);
  }

  tabStates.delete(tabId);
}

/**
 * Closes all browser webviews
 */
export async function closeAllBrowserWebviews(): Promise<void> {
  try {
    await invoke('browser_close_all');
  } catch (e) {
    console.warn('[browserService] Error closing all webviews:', e);
  }

  tabStates.clear();
}

/**
 * Navigates to a URL in a specific tab
 */
export async function navigateTo(url: string, tabId: string): Promise<void> {
  const normalizedUrl = normalizeUrl(url);

  console.log('[browserService] Tab', tabId, 'navigating to:', normalizedUrl);

  const tabState = tabStates.get(tabId);
  if (tabState) {
    tabState.url = normalizedUrl;
  }

  await invoke('browser_navigate', { url: normalizedUrl, tabId });
}

/**
 * Refreshes current page in a specific tab
 */
export async function refresh(tabId: string): Promise<void> {
  const tabState = tabStates.get(tabId);
  if (tabState?.url) {
    await invoke('browser_navigate', { url: tabState.url, tabId });
  }
}

/**
 * Updates webview position/size for a specific tab
 */
export async function updatePosition(position: BrowserPosition, tabId: string): Promise<void> {
  const tabState = tabStates.get(tabId);
  if (!tabState?.isOpen) return;

  try {
    const screenPos = await toScreenCoordinates(position);
    await invoke('browser_set_position', { position: screenPos, tabId });
  } catch (e) {
    console.warn('[browserService] Error updating position for tab', tabId, ':', e);
  }
}

/**
 * Checks if a tab's webview exists
 */
export async function browserExists(tabId: string): Promise<boolean> {
  return await invoke('browser_exists', { tabId });
}

/**
 * Gets current state for a specific tab
 */
export function getTabState(tabId: string): TabState | undefined {
  return tabStates.get(tabId);
}

/**
 * Gets all tab states
 */
export function getAllTabStates(): Map<string, TabState> {
  return new Map(tabStates);
}

/**
 * Switches active tab by hiding previous and showing new
 */
export async function switchTab(fromTabId: string | null, toTabId: string): Promise<void> {
  // Hide previous tab if exists
  if (fromTabId && tabStates.has(fromTabId)) {
    await hideBrowserWebview(fromTabId);
  }

  // Show new tab
  if (tabStates.has(toTabId)) {
    await showBrowserWebview(toTabId);
  }
}

// ========== MEDIA CONTROL ==========

// Listener for media state changes
let mediaStateListener: UnlistenFn | null = null;
let onMediaStateCallback: ((state: MediaState) => void) | null = null;

/**
 * Set callback for media state changes
 */
export function onMediaStateChange(callback: (state: MediaState) => void): void {
  onMediaStateCallback = callback;
}

/**
 * Setup the media state listener
 */
export async function setupMediaListener(): Promise<void> {
  if (mediaStateListener) return;

  mediaStateListener = await listen<{
    tab_id: string;
    platform: string;
    title: string;
    is_playing: boolean;
    duration: number;
    current_time: number;
  }>('media-state-changed', (event) => {
    const { tab_id, platform, title, is_playing, duration, current_time } = event.payload;

    if (onMediaStateCallback) {
      onMediaStateCallback({
        tabId: tab_id,
        platform: platform as MediaState['platform'],
        title,
        isPlaying: is_playing,
        duration,
        currentTime: current_time,
      });
    }
  });
}

/**
 * Send a media command to a specific tab
 */
export async function sendMediaCommand(tabId: string, command: MediaCommand): Promise<void> {
  console.log('[browserService] Sending media command:', command, 'to tab:', tabId);
  await invoke('media_send_command', { tabId, command });
}

/**
 * Cleanup media listener
 */
export function cleanupMediaListener(): void {
  if (mediaStateListener) {
    mediaStateListener();
    mediaStateListener = null;
  }
  onMediaStateCallback = null;
}
