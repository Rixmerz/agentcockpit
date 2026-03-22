mod pty;
#[cfg(debug_assertions)]
mod debug_server;

use pty::PtyManager;
use std::sync::Arc;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use std::thread;
use parking_lot::Mutex;
use tauri::RunEvent;
use tauri::Manager;

// =====================================================
// DeltaCodeCube MCP Client (persistent process)
// =====================================================

struct DccMcpClient {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    reader: BufReader<std::process::ChildStdout>,
    next_id: u64,
}

impl DccMcpClient {
    fn call_tool(&mut self, name: &str, args: &str) -> Result<String, String> {
        let id = self.next_id;
        self.next_id += 1;

        let msg = format!(
            r#"{{"jsonrpc":"2.0","id":{},"method":"tools/call","params":{{"name":"{}","arguments":{}}}}}"#,
            id, name, args
        );

        writeln!(self.stdin, "{}", msg).map_err(|e| format!("dcc write: {}", e))?;
        self.stdin.flush().map_err(|e| format!("dcc flush: {}", e))?;

        let id_str = format!("\"id\":{}", id);
        loop {
            let mut line = String::new();
            let bytes = self.reader.read_line(&mut line).map_err(|e| format!("dcc read: {}", e))?;
            if bytes == 0 {
                return Err("DCC process exited unexpectedly".to_string());
            }
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            if trimmed.contains(&id_str) {
                return Ok(trimmed.to_string());
            }
        }
    }
}

impl Drop for DccMcpClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct DccState {
    client: Option<DccMcpClient>,
    current_data_dir: Option<String>,
}

impl DccState {
    fn new() -> Self { Self { client: None, current_data_dir: None } }
}

#[tauri::command]
async fn dcc_start(state: tauri::State<'_, Arc<Mutex<DccState>>>, dcc_path: String, data_dir: String) -> Result<String, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut st = state.lock();

        // If already running for this same data_dir, reuse
        if st.client.is_some() && st.current_data_dir.as_deref() == Some(&data_dir) {
            return Ok(r#"{"status":"already_running"}"#.to_string());
        }

        // If running for different project, kill first (Drop kills child)
        if st.client.is_some() {
            st.client = None;
        }

        // Write stderr to a debug file for diagnostics
        let home_dir = std::env::var("HOME").unwrap_or_default();
        let stderr_file = std::fs::File::create(format!("{}/dcc-stderr.log", home_dir))
            .map(Stdio::from)
            .unwrap_or(Stdio::null());

        let mut cmd = Command::new("uv");
        cmd.args(["run", "--directory", &dcc_path, "deltacodecube"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr_file)
            .env_clear();

        cmd.env("HOME", &home_dir);
        if let Ok(user) = std::env::var("USER") { cmd.env("USER", &user); }
        if let Ok(tmp) = std::env::var("TMPDIR") { cmd.env("TMPDIR", &tmp); }
        cmd.env("PATH", build_extended_path());
        cmd.env("DCC_DATA_DIR", &data_dir);

        let mut child = cmd.spawn().map_err(|e| format!("dcc spawn: {}", e))?;

        let mut stdin = child.stdin.take().ok_or("dcc: no stdin")?;
        let stdout = child.stdout.take().ok_or("dcc: no stdout")?;
        let reader = BufReader::new(stdout);

        // stderr goes to ~/dcc-stderr.log for diagnostics

        // MCP initialize handshake
        let init_id = 1u64;
        let init_msg = format!(
            r#"{{"jsonrpc":"2.0","id":{},"method":"initialize","params":{{"protocolVersion":"2024-11-05","capabilities":{{}},"clientInfo":{{"name":"agentcockpit","version":"1.0"}}}}}}"#,
            init_id
        );

        writeln!(stdin, "{}", init_msg).map_err(|e| format!("dcc init write: {}", e))?;
        stdin.flush().map_err(|e| format!("dcc init flush: {}", e))?;

        // Read init response with REAL timeout (thread + channel)
        // read_line is blocking, so we run it in a thread and recv_timeout on channel
        let id_str = format!("\"id\":{}", init_id);
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut reader = reader;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => {
                        let _ = tx.send(Err("DCC process exited during init (EOF on stdout)".to_string()));
                        return;
                    }
                    Ok(_) => {
                        if line.trim().contains(&id_str) {
                            let _ = tx.send(Ok(reader));
                            return;
                        }
                        // Skip notification lines
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("dcc init read: {}", e)));
                        return;
                    }
                }
            }
        });

        let reader = match rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                let _ = child.kill();
                return Err(format!("{} (see ~/dcc-stderr.log)", e));
            }
            Err(_) => {
                let _ = child.kill();
                return Err("DCC handshake timed out after 10s".to_string());
            }
        };

        // Send initialized notification
        writeln!(stdin, r#"{{"jsonrpc":"2.0","method":"notifications/initialized"}}"#)
            .map_err(|e| format!("dcc notify write: {}", e))?;
        stdin.flush().map_err(|e| format!("dcc notify flush: {}", e))?;

        let client = DccMcpClient { child, stdin, reader, next_id: 2 };
        st.client = Some(client);
        st.current_data_dir = Some(data_dir);
        Ok(r#"{"status":"started"}"#.to_string())
    })
    .await
    .map_err(|e| format!("dcc_start task: {}", e))?
}

#[tauri::command]
async fn dcc_call(
    state: tauri::State<'_, Arc<Mutex<DccState>>>,
    tool_name: String,
    arguments: String,
) -> Result<String, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut st = state.lock();
        let client = st.client.as_mut().ok_or("DCC not started".to_string())?;
        client.call_tool(&tool_name, &arguments)
    })
    .await
    .map_err(|e| format!("dcc_call task: {}", e))?
}

#[tauri::command]
fn dcc_stop(state: tauri::State<'_, Arc<Mutex<DccState>>>) -> Result<String, String> {
    let mut st = state.lock();
    st.client = None; // Drop kills child process
    st.current_data_dir = None;
    Ok(r#"{"status":"stopped"}"#.to_string())
}

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

/// Build extended PATH with NVM, Homebrew (macOS only), and common locations
/// Same logic as pty.rs for consistency across all command execution
fn build_extended_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();

    let mut paths = vec![];

    // macOS: Homebrew paths
    #[cfg(target_os = "macos")]
    {
        paths.push("/opt/homebrew/bin".to_string());
        paths.push("/opt/homebrew/sbin".to_string());
    }

    // Common Unix paths
    paths.push("/usr/local/bin".to_string());
    paths.push("/usr/local/sbin".to_string());
    paths.push(format!("{}/.local/bin", home));
    paths.push(format!("{}/.cargo/bin", home));
    paths.push("/usr/bin".to_string());
    paths.push("/bin".to_string());
    paths.push("/usr/sbin".to_string());
    paths.push("/sbin".to_string());

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

    // Clear parent session markers so nested CLI tools work correctly
    command.env_remove("CLAUDECODE");
    command.env_remove("CLAUDE_CODE_ENTRYPOINT");

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
    let dcc_state = Arc::new(Mutex::new(DccState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .manage(pty_manager)
        .manage(dcc_state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Set window icon (Linux: not auto-set from bundle config)
            #[cfg(target_os = "linux")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let png_bytes = include_bytes!("../icons/icon.png");
                    let decoder = png::Decoder::new(std::io::Cursor::new(png_bytes.as_ref()));
                    if let Ok(reader) = decoder.read_info() {
                        let mut reader = reader;
                        let mut buf = vec![0u8; reader.output_buffer_size()];
                        if let Ok(info) = reader.next_frame(&mut buf) {
                            buf.truncate(info.buffer_size());
                            let icon = tauri::image::Image::new_owned(
                                buf,
                                info.width,
                                info.height,
                            );
                            let _ = window.set_icon(icon);
                        }
                    }
                }
            }

            // Start debug HTTP server (DEV only)
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    debug_server::start(window, app.handle().clone());
                }
            }

            Ok(())
        })
        .invoke_handler({
            #[cfg(debug_assertions)]
            {
                tauri::generate_handler![
                    execute_command,
                    dcc_start,
                    dcc_call,
                    dcc_stop,
                    pty::pty_spawn,
                    pty::pty_write,
                    pty::pty_resize,
                    pty::pty_close,
                    debug_server::debug_callback,
                ]
            }
            #[cfg(not(debug_assertions))]
            {
                tauri::generate_handler![
                    execute_command,
                    dcc_start,
                    dcc_call,
                    dcc_stop,
                    pty::pty_spawn,
                    pty::pty_write,
                    pty::pty_resize,
                    pty::pty_close,
                ]
            }
        })
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
