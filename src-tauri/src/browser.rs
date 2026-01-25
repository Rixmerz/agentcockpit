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

    // Create webview builder with navigation and page load handlers
    let app_handle = app.clone();
    let tab_id_for_nav = tab_id.clone();
    let webview_builder = WebviewBuilder::new(&label, webview_url)
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
        .initialization_script(&url_tracker_script);

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
