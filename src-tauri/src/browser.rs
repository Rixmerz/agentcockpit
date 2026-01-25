use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, Manager, WebviewBuilder, WebviewUrl,
    LogicalPosition, LogicalSize,
};

/// Browser webview state
pub struct BrowserState {
    webview_label: Option<String>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            webview_label: None,
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
}

/// Create the browser webview
#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    url: String,
    position: BrowserPosition,
) -> Result<(), String> {
    let mut browser_state = state.lock();

    // Close existing webview if any
    if let Some(label) = &browser_state.webview_label {
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.close();
        }
        browser_state.webview_label = None;
    }

    let label = "browser-webview";
    let main_window = app.get_window("main").ok_or("Main window not found")?;

    // Parse URL
    let webview_url = WebviewUrl::External(url.parse().map_err(|e| format!("Invalid URL: {}", e))?);

    // Create webview builder with navigation handler
    let app_handle = app.clone();
    let webview_builder = WebviewBuilder::new(label, webview_url)
        .on_navigation(move |url| {
            // Emit event to frontend when URL changes
            let url_string = url.to_string();
            log::info!("[Browser] Navigation to: {}", url_string);
            let _ = app_handle.emit("browser-url-changed", UrlChangedPayload { url: url_string });
            true // Allow navigation
        });

    // Add webview to main window
    let _webview = main_window
        .add_child(
            webview_builder,
            LogicalPosition::new(position.x, position.y),
            LogicalSize::new(position.width, position.height),
        )
        .map_err(|e| format!("Failed to create webview: {}", e))?;

    log::info!("[Browser] Created webview at ({}, {}) size {}x{}",
        position.x, position.y, position.width, position.height);

    browser_state.webview_label = Some(label.to_string());

    Ok(())
}

/// Close the browser webview
#[tauri::command]
pub async fn browser_close(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> Result<(), String> {
    let mut browser_state = state.lock();

    if let Some(label) = &browser_state.webview_label {
        if let Some(webview) = app.get_webview(label) {
            webview.close().map_err(|e| format!("Failed to close webview: {}", e))?;
            log::info!("[Browser] Closed webview");
        }
        browser_state.webview_label = None;
    }

    Ok(())
}

/// Navigate to a URL
#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    url: String,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = &browser_state.webview_label {
        if let Some(webview) = app.get_webview(label) {
            let webview_url = WebviewUrl::External(url.parse().map_err(|e| format!("Invalid URL: {}", e))?);
            webview.navigate(webview_url.into()).map_err(|e| format!("Failed to navigate: {}", e))?;
            log::info!("[Browser] Navigating to: {}", url);
        }
    }

    Ok(())
}

/// Update webview position and size
#[tauri::command]
pub async fn browser_set_position(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
    position: BrowserPosition,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = &browser_state.webview_label {
        if let Some(webview) = app.get_webview(label) {
            webview.set_position(LogicalPosition::new(position.x, position.y))
                .map_err(|e| format!("Failed to set position: {}", e))?;
            webview.set_size(LogicalSize::new(position.width, position.height))
                .map_err(|e| format!("Failed to set size: {}", e))?;
        }
    }

    Ok(())
}

/// Show the browser webview
#[tauri::command]
pub async fn browser_show(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = &browser_state.webview_label {
        if let Some(webview) = app.get_webview(label) {
            webview.show().map_err(|e| format!("Failed to show webview: {}", e))?;
            log::info!("[Browser] Shown webview");
        }
    }

    Ok(())
}

/// Hide the browser webview
#[tauri::command]
pub async fn browser_hide(
    app: AppHandle,
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> Result<(), String> {
    let browser_state = state.lock();

    if let Some(label) = &browser_state.webview_label {
        if let Some(webview) = app.get_webview(label) {
            webview.hide().map_err(|e| format!("Failed to hide webview: {}", e))?;
            log::info!("[Browser] Hidden webview");
        }
    }

    Ok(())
}

/// Check if browser webview exists
#[tauri::command]
pub fn browser_exists(
    state: tauri::State<'_, Arc<Mutex<BrowserState>>>,
) -> bool {
    state.lock().webview_label.is_some()
}
