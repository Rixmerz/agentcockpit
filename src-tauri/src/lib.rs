mod pty;

use pty::PtyManager;
use std::sync::Arc;
use std::process::Command;
use parking_lot::Mutex;
use tauri::RunEvent;

#[tauri::command]
fn execute_command(cmd: String, cwd: String) -> Result<String, String> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&cwd)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = Arc::new(Mutex::new(PtyManager::new()));
    let pty_manager_for_shutdown = pty_manager.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(pty_manager)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            execute_command,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let RunEvent::Exit = event {
                // Clean up all PTY processes on app exit
                log::info!("App shutting down - cleaning up PTY processes");
                let mut manager = pty_manager_for_shutdown.lock();
                manager.close_all();
            }
        });
}
