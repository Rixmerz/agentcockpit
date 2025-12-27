/// One-term application
/// Desktop terminal emulator with Tauri backend + React frontend
///
/// Module structure:
/// - commands: Tauri IPC handlers (frontend → backend)
/// - services: Business logic for terminal/shell operations
/// - models: Shared data types

mod commands;
mod services;
mod models;

use std::sync::Arc;
use services::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create PTY manager instance
    let pty_manager = Arc::new(PtyManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty_manager)
        .invoke_handler(tauri::generate_handler![
            commands::greet::greet,
            commands::shell::execute_command,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_is_active,
            commands::pty::pty_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
