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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::execute_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
