mod pty;

use pty::PtyManager;
use std::sync::Arc;
use std::process::Command;
use parking_lot::Mutex;
use tauri::RunEvent;

/// Get the NVM node bin path, respecting user's default alias or falling back to latest version
/// This ensures bundled apps use the same node version as the user's terminal
fn get_nvm_node_bin(home: &str) -> Option<String> {
    let nvm_dir = format!("{}/.nvm", home);
    let versions_dir = format!("{}/versions/node", nvm_dir);

    if !std::path::Path::new(&nvm_dir).exists() {
        return None;
    }

    // Get all installed node versions
    let mut versions: Vec<String> = match std::fs::read_dir(&versions_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|name| name.starts_with('v'))
            .collect(),
        Err(_) => return None,
    };

    if versions.is_empty() {
        return None;
    }

    // Try to read the default alias
    let default_alias = std::fs::read_to_string(format!("{}/alias/default", nvm_dir))
        .ok()
        .map(|s| s.trim().to_string());

    let selected_version = if let Some(alias) = default_alias {
        // Find a version that matches the alias prefix (e.g., "22" matches "v22.16.0")
        let matching = versions.iter().find(|v| {
            let version_num = v.trim_start_matches('v');
            version_num.starts_with(&alias) || version_num == alias
        });

        if let Some(v) = matching {
            v.clone()
        } else {
            // No match for alias, fall back to sorting and picking latest
            sort_versions_semver(&mut versions);
            versions.last()?.clone()
        }
    } else {
        // No default alias, sort and pick latest
        sort_versions_semver(&mut versions);
        versions.last()?.clone()
    };

    let node_bin = format!("{}/{}/bin", versions_dir, selected_version);
    if std::path::Path::new(&node_bin).exists() {
        Some(node_bin)
    } else {
        None
    }
}

/// Sort node versions by semver (e.g., v18.20.8 < v20.19.5 < v22.16.0)
fn sort_versions_semver(versions: &mut Vec<String>) {
    versions.sort_by(|a, b| {
        let parse_version = |v: &str| -> (u32, u32, u32) {
            let nums: Vec<u32> = v.trim_start_matches('v')
                .split('.')
                .filter_map(|s| s.parse().ok())
                .collect();
            (
                nums.first().copied().unwrap_or(0),
                nums.get(1).copied().unwrap_or(0),
                nums.get(2).copied().unwrap_or(0),
            )
        };
        parse_version(a).cmp(&parse_version(b))
    });
}

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

    // Add NVM node bin if available (respects user's default alias)
    if let Some(nvm_bin) = get_nvm_node_bin(&home) {
        paths.insert(0, nvm_bin);
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
