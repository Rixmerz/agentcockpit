/// PTY Commands
/// Tauri commands for PTY operations

use crate::services::PtyManager;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

/// Spawn a new PTY session
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    pty_manager: State<'_, Arc<PtyManager>>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let app_clone = app.clone();

    pty_manager.spawn(cols, rows, move |data| {
        // Emit output to frontend
        let _ = app_clone.emit("pty-output", data);
    })?;

    Ok(())
}

/// Write data to PTY
#[tauri::command]
pub fn pty_write(pty_manager: State<'_, Arc<PtyManager>>, data: Vec<u8>) -> Result<(), String> {
    pty_manager.write(&data)
}

/// Resize PTY
#[tauri::command]
pub fn pty_resize(
    pty_manager: State<'_, Arc<PtyManager>>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty_manager.resize(cols, rows)
}

/// Check if PTY is active
#[tauri::command]
pub fn pty_is_active(pty_manager: State<'_, Arc<PtyManager>>) -> bool {
    pty_manager.is_active()
}

/// Close PTY session
#[tauri::command]
pub fn pty_close(pty_manager: State<'_, Arc<PtyManager>>) {
    pty_manager.close()
}
