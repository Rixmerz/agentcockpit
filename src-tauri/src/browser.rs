use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, Manager, WebviewBuilder, WebviewUrl,
    LogicalPosition, LogicalSize,
};

/// Browser webview state - supports multiple tabs
pub struct BrowserState {
    /// Map of tab_id -> webview label
    webviews: HashMap<String, String>,
    /// Currently active tab
    active_tab: Option<String>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            webviews: HashMap::new(),
            active_tab: None,
        }
    }
}

/// Position and size for the browser webview
#[derive(Debug, Clone, serde::Deserialize)]
pub struct BrowserPosition {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Event payload for URL changes
#[derive(Clone, serde::Serialize)]
pub struct UrlChangedPayload {
    pub url: String,
    pub tab_id: String,
}

/// Media state reported from webview
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MediaStateReport {
    pub tab_id: String,
    pub platform: String,  // "youtube" | "youtube-music" | "unknown"
    pub title: String,
    pub is_playing: bool,
    pub duration: f64,
    pub current_time: f64,
}

/// Event payload for media state changes
#[derive(Clone, serde::Serialize)]
pub struct MediaStatePayload {
    pub tab_id: String,
    pub platform: String,
    pub title: String,
    pub is_playing: bool,
    pub duration: f64,
    pub current_time: f64,
}

/// Create a browser webview for a specific tab
#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    url: String,
    position: BrowserPosition,
    tab_id: String,
) -> Result<(), String> {
    let mut browser_state = state.lock();

    // Check if webview already exists for this tab
    if let Some(label) = browser_state.webviews.get(&tab_id) {
        if app.get_webview(label).is_some() {
            log::info!("[Browser] Webview already exists for tab {}", tab_id);
            return Ok(());
        }
    }

    let label = format!("browser-{}", tab_id);
    let main_window = app.get_window("main").ok_or("Main window not found")?;

    // Parse URL
    let webview_url = WebviewUrl::External(url.parse().map_err(|e| format!("Invalid URL: {}", e))?);

    // JavaScript to inject for SPA URL tracking (with polling fallback for complex SPAs)
    // Include tab_id in the report
    let tab_id_for_script = tab_id.clone();
    let url_tracker_script = format!(r#"
        (function() {{
            if (window.__urlTrackerInstalled) return;
            window.__urlTrackerInstalled = true;

            const tabId = "{}";
            let lastUrl = '';

            function reportUrl() {{
                const url = window.location.href;
                if (url && url !== lastUrl && !url.startsWith('about:') && !url.startsWith('blob:')) {{
                    lastUrl = url;
                    try {{
                        window.__TAURI_INTERNALS__.invoke('browser_url_report', {{ url: url, tabId: tabId }});
                    }} catch(e) {{}}
                }}
            }}

            // Override pushState
            const originalPushState = history.pushState;
            history.pushState = function() {{
                originalPushState.apply(this, arguments);
                setTimeout(reportUrl, 50);
            }};

            // Override replaceState
            const originalReplaceState = history.replaceState;
            history.replaceState = function() {{
                originalReplaceState.apply(this, arguments);
                setTimeout(reportUrl, 50);
            }};

            // Listen for popstate (back/forward)
            window.addEventListener('popstate', function() {{
                setTimeout(reportUrl, 50);
            }});

            // Polling fallback for complex SPAs (YouTube, etc.)
            setInterval(reportUrl, 500);

            // Report initial URL
            setTimeout(reportUrl, 100);
        }})();
    "#, tab_id_for_script);

    // JavaScript to inject for media detection (YouTube / YouTube Music)
    let tab_id_for_media = tab_id.clone();
    let media_tracker_script = format!(r#"
        (function() {{
            if (window.__mediaTrackerInstalled) return;
            window.__mediaTrackerInstalled = true;

            const tabId = "{}";
            let lastState = null;

            function detectPlatform() {{
                const host = window.location.hostname;
                if (host.includes('music.youtube.com')) return 'youtube-music';
                if (host.includes('youtube.com')) return 'youtube';
                return 'unknown';
            }}

            function getMediaTitle() {{
                const platform = detectPlatform();
                if (platform === 'youtube-music') {{
                    // YouTube Music: title is in specific elements
                    const titleEl = document.querySelector('.title.ytmusic-player-bar');
                    if (titleEl) return titleEl.textContent.trim();
                }}
                if (platform === 'youtube') {{
                    // YouTube: try ytInitialPlayerResponse first, then DOM
                    try {{
                        if (window.ytInitialPlayerResponse?.videoDetails?.title) {{
                            return window.ytInitialPlayerResponse.videoDetails.title;
                        }}
                    }} catch(e) {{}}
                    // Fallback to DOM
                    const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata');
                    if (titleEl) return titleEl.textContent.trim();
                    // Try meta tag
                    const metaTitle = document.querySelector('meta[name="title"]');
                    if (metaTitle) return metaTitle.getAttribute('content');
                }}
                return document.title || '';
            }}

            function reportMediaState() {{
                const platform = detectPlatform();
                const video = document.querySelector('video');
                if (!video) return;

                const effectivePlatform = platform === 'unknown' ? 'html5' : platform;
                const title = getMediaTitle();
                const isPlaying = !video.paused && !video.ended && video.readyState > 2;

                // Only report when isPlaying state actually changes
                const stateKey = `${{isPlaying}}`;
                if (stateKey === lastState) return;
                lastState = stateKey;

                if (!window.__TAURI_INTERNALS__) return;

                try {{
                    window.__TAURI_INTERNALS__.invoke('media_state_report', {{
                        report: {{
                            tab_id: tabId,
                            platform: effectivePlatform,
                            title: title,
                            is_playing: isPlaying,
                            duration: video.duration || 0,
                            current_time: video.currentTime || 0
                        }}
                    }});
                }} catch(e) {{}}
            }}

            // Command executor for play/pause/next/prev
            window.__executeMediaCommand = function(cmd) {{
                const video = document.querySelector('video');
                if (!video) return;

                const platform = detectPlatform();

                switch(cmd) {{
                    case 'play':
                        video.play();
                        break;
                    case 'pause':
                        video.pause();
                        break;
                    case 'toggle':
                        if (video.paused) video.play();
                        else video.pause();
                        break;
                    case 'next':
                        if (platform === 'youtube' || platform === 'youtube-music') {{
                            // Try clicking the next button directly
                            const nextBtn = document.querySelector('.ytp-next-button') ||
                                           document.querySelector('[aria-label*="Next"]') ||
                                           document.querySelector('button[data-tooltip-target-id="next"]');
                            if (nextBtn) {{
                                nextBtn.click();
                            }} else {{
                                // Fallback: dispatch keydown to the player element
                                const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
                                if (player) {{
                                    player.dispatchEvent(new KeyboardEvent('keydown', {{
                                        key: 'N', code: 'KeyN', shiftKey: true, bubbles: true, keyCode: 78
                                    }}));
                                }}
                            }}
                        }}
                        break;
                    case 'prev':
                        if (platform === 'youtube' || platform === 'youtube-music') {{
                            // Try clicking the prev button directly
                            const prevBtn = document.querySelector('.ytp-prev-button') ||
                                           document.querySelector('[aria-label*="Previous"]') ||
                                           document.querySelector('button[data-tooltip-target-id="previous"]');
                            if (prevBtn) {{
                                prevBtn.click();
                            }} else {{
                                // Fallback: dispatch keydown to the player element
                                const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
                                if (player) {{
                                    player.dispatchEvent(new KeyboardEvent('keydown', {{
                                        key: 'P', code: 'KeyP', shiftKey: true, bubbles: true, keyCode: 80
                                    }}));
                                }}
                            }}
                        }}
                        break;
                }}
            }};

            // Report media state every second
            setInterval(reportMediaState, 1000);

            // Also report when video events happen
            document.addEventListener('play', reportMediaState, true);
            document.addEventListener('pause', reportMediaState, true);
            document.addEventListener('ended', reportMediaState, true);

            // Initial report after page load
            setTimeout(reportMediaState, 1500);
        }})();
    "#, tab_id_for_media);

    // Combine both scripts
    let combined_script = format!("{}\n{}", url_tracker_script, media_tracker_script);

    // Create webview builder with navigation and page load handlers
    let app_handle = app.clone();
    let tab_id_for_nav = tab_id.clone();

    // Use Safari User-Agent so sites like WhatsApp Web work correctly
    let safari_user_agent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

    let webview_builder = WebviewBuilder::new(&label, webview_url)
        .user_agent(safari_user_agent)
        .devtools(true)  // Enable devtools for debugging
        .on_navigation(move |url| {
            let url_string = url.to_string();

            // Filter out internal/temporary URLs
            if url_string.starts_with("about:") ||
               url_string.starts_with("blob:") ||
               url_string.starts_with("data:") ||
               url_string.is_empty() {
                return true; // Allow but don't emit
            }

            // Emit event to frontend for real URL changes
            log::info!("[Browser] Tab {} navigation to: {}", tab_id_for_nav, url_string);
            let _ = app_handle.emit("browser-url-changed", UrlChangedPayload {
                url: url_string,
                tab_id: tab_id_for_nav.clone()
            });
            true // Allow navigation
        })
        .initialization_script(&combined_script);

    // Add webview to main window
    let _webview = main_window
        .add_child(
            webview_builder,
            LogicalPosition::new(position.x, position.y),
            LogicalSize::new(position.width, position.height),
        )
        .map_err(|e| format!("Failed to create webview: {}", e))?;

    log::info!("[Browser] Created webview for tab {} at ({}, {}) size {}x{}",
        tab_id, position.x, position.y, position.width, position.height);

    browser_state.webviews.insert(tab_id.clone(), label);
    browser_state.active_tab = Some(tab_id);

    Ok(())
}

/// Close a specific tab's webview
#[tauri::command]
pub async fn browser_close(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    tab_id: String,
) -> Result<(), String> {
    let mut browser_state = state.lock();

    if let Some(label) = browser_state.webviews.remove(&tab_id) {
        if let Some(webview) = app.get_webview(&label) {
            webview.close().map_err(|e| format!("Failed to close webview: {}", e))?;
            log::info!("[Browser] Closed webview for tab {}", tab_id);
        }
        if browser_state.active_tab.as_ref() == Some(&tab_id) {
            browser_state.active_tab = None;
        }
    }

    Ok(())
}

/// Close all browser webviews
#[tauri::command]
pub async fn browser_close_all(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> Result<(), String> {
    let mut browser_state = state.lock();

    for (tab_id, label) in browser_state.webviews.drain() {
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.close();
            log::info!("[Browser] Closed webview for tab {}", tab_id);
        }
    }
    browser_state.active_tab = None;

    Ok(())
}

/// Navigate to a URL in a specific tab
#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    url: String,
    tab_id: String,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = browser_state.webviews.get(&tab_id) {
        if let Some(webview) = app.get_webview(label) {
            let parsed_url: tauri::Url = url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
            webview.navigate(parsed_url).map_err(|e| format!("Failed to navigate: {}", e))?;
            log::info!("[Browser] Tab {} navigating to: {}", tab_id, url);
        }
    }

    Ok(())
}

/// Update webview position and size for a specific tab
#[tauri::command]
pub async fn browser_set_position(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    position: BrowserPosition,
    tab_id: String,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = browser_state.webviews.get(&tab_id) {
        if let Some(webview) = app.get_webview(label) {
            webview.set_position(LogicalPosition::new(position.x, position.y))
                .map_err(|e| format!("Failed to set position: {}", e))?;
            webview.set_size(LogicalSize::new(position.width, position.height))
                .map_err(|e| format!("Failed to set size: {}", e))?;
        }
    }

    Ok(())
}

/// Show a specific tab's webview
#[tauri::command]
pub async fn browser_show(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    tab_id: String,
) -> Result<(), String> {
    let mut browser_state = state.lock();

    if let Some(label) = browser_state.webviews.get(&tab_id) {
        if let Some(webview) = app.get_webview(label) {
            webview.show().map_err(|e| format!("Failed to show webview: {}", e))?;
            log::info!("[Browser] Shown webview for tab {}", tab_id);
        }
    }
    browser_state.active_tab = Some(tab_id);

    Ok(())
}

/// Hide a specific tab's webview
#[tauri::command]
pub async fn browser_hide(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    tab_id: String,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = browser_state.webviews.get(&tab_id) {
        if let Some(webview) = app.get_webview(label) {
            webview.hide().map_err(|e| format!("Failed to hide webview: {}", e))?;
            log::info!("[Browser] Hidden webview for tab {}", tab_id);
        }
    }

    Ok(())
}

/// Hide all webviews (used when browser panel closes or goes idle)
#[tauri::command]
pub async fn browser_hide_all(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> Result<(), String> {
    let browser_state = state.lock();

    for (tab_id, label) in &browser_state.webviews {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.hide();
            log::info!("[Browser] Hidden webview for tab {}", tab_id);
        }
    }

    Ok(())
}

/// Check if a specific tab's webview exists
#[tauri::command]
pub fn browser_exists(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    tab_id: String,
) -> bool {
    state.lock().webviews.contains_key(&tab_id)
}

/// Get list of all tab IDs with webviews
#[tauri::command]
pub fn browser_get_tabs(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> Vec<String> {
    state.lock().webviews.keys().cloned().collect()
}

/// Receive URL report from injected JavaScript (for SPA navigation)
#[tauri::command]
pub fn browser_url_report(
    app: AppHandle,
    url: String,
    tab_id: String,
) -> Result<(), String> {
    // Filter out internal URLs
    if url.is_empty() ||
       url.starts_with("about:") ||
       url.starts_with("blob:") ||
       url.starts_with("data:") {
        return Ok(());
    }

    log::info!("[Browser] Tab {} SPA URL change: {}", tab_id, url);
    app.emit("browser-url-changed", UrlChangedPayload { url, tab_id })
        .map_err(|e| format!("Failed to emit URL change: {}", e))
}

/// Receive media state report from injected JavaScript
#[tauri::command]
pub fn media_state_report(
    app: AppHandle,
    report: MediaStateReport,
) -> Result<(), String> {
    log::info!("[Browser] Media state for tab {}: {} - playing: {}",
        report.tab_id, report.title, report.is_playing);

    app.emit("media-state-changed", MediaStatePayload {
        tab_id: report.tab_id,
        platform: report.platform,
        title: report.title,
        is_playing: report.is_playing,
        duration: report.duration,
        current_time: report.current_time,
    }).map_err(|e| format!("Failed to emit media state: {}", e))
}

/// Send media command to webview (play, pause, next, prev)
#[tauri::command]
pub async fn media_send_command(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    tab_id: String,
    command: String,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = browser_state.webviews.get(&tab_id) {
        if let Some(webview) = app.get_webview(label) {
            let js_command = format!(
                r#"if (window.__executeMediaCommand) {{ window.__executeMediaCommand('{}'); }}"#,
                command
            );
            webview.eval(&js_command)
                .map_err(|e| format!("Failed to execute media command: {}", e))?;
            log::info!("[Browser] Sent media command '{}' to tab {}", command, tab_id);
        }
    }

    Ok(())
}
