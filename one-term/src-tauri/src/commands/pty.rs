/// PTY Commands
/// Tauri commands for PTY operations

use crate::services::{ClaudeParser, PtyManager};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Spawn a new PTY session
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    pty_manager: State<'_, Arc<PtyManager>>,
    claude_parser: State<'_, Arc<ClaudeParser>>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let app_clone = app.clone();
    let parser = Arc::clone(&claude_parser);

    // Clear parser state for new session
    parser.clear();

    pty_manager.spawn(cols, rows, move |data| {
        // Emit raw output to terminal
        let _ = app_clone.emit("pty-output", data.clone());

        // Parse for Claude events
        let events = parser.process(&data);

        // Emit parsed events if any
        if !events.is_empty() {
            let _ = app_clone.emit("claude-events", events);
        }
    })?;

    Ok(())
}

/// Get parsed Claude events buffer
#[tauri::command]
pub fn get_claude_buffer(claude_parser: State<'_, Arc<ClaudeParser>>) -> String {
    claude_parser.get_buffer()
}

/// Get all Claude events
#[tauri::command]
pub fn get_claude_events(claude_parser: State<'_, Arc<ClaudeParser>>) -> Vec<crate::services::ClaudeEvent> {
    claude_parser.get_events()
}

/// Clear Claude parser state
#[tauri::command]
pub fn clear_claude_parser(claude_parser: State<'_, Arc<ClaudeParser>>) {
    claude_parser.clear();
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
