mod pty;

use pty::PtyManager;
use std::sync::Arc;
use std::process::Command;
use parking_lot::Mutex;
use tauri::RunEvent;

/// Build extended PATH with NVM, Homebrew, and common locations
/// Same logic as pty.rs for consistency across all command execution
fn build_extended_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();

    let mut paths = vec![
        "/opt/homebrew/bin".to_string(),      // Homebrew Apple Silicon
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),         // Homebrew Intel / system
        "/usr/local/sbin".to_string(),
        format!("{}/.local/bin", home),       // User local
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];

    // Add NVM default node if it exists
    if std::path::Path::new(&format!("{}/.nvm", home)).exists() {
        let nvm_default = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_default) {
            if let Some(entry) = entries.filter_map(|e| e.ok()).last() {
                let node_bin = entry.path().join("bin");
                if node_bin.exists() {
                    paths.insert(0, node_bin.to_string_lossy().to_string());
                }
            }
        }
    }

    if !current_path.is_empty() {
        paths.push(current_path);
    }

    paths.join(":")
}

/// Execute a shell command with proper environment variables
/// CRITICAL: macOS bundled apps have limited environment, so we explicitly
/// set HOME, USER, SHELL, PATH (with NVM/Homebrew) for all commands.
/// This fixes git, mcp, and other CLI tools not working in bundled app.
#[tauri::command]
fn execute_command(cmd: String, cwd: String) -> Result<String, String> {
    let mut command = Command::new("sh");
    command.arg("-c").arg(&cmd).current_dir(&cwd);

    // Copy essential environment variables (learned from opcode project)
    if let Ok(home) = std::env::var("HOME") {
        command.env("HOME", &home);
    }
    if let Ok(user) = std::env::var("USER") {
        command.env("USER", &user);
    }
    if let Ok(shell) = std::env::var("SHELL") {
        command.env("SHELL", &shell);
    }

    // Set extended PATH with NVM, Homebrew, etc.
    command.env("PATH", build_extended_path());

    // Copy additional useful environment variables
    for var in &["LANG", "LC_ALL", "EDITOR", "VISUAL", "XDG_CONFIG_HOME", "TERM"] {
        if let Ok(value) = std::env::var(var) {
            command.env(var, &value);
        }
    }

    let output = command.output().map_err(|e| e.to_string())?;

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
