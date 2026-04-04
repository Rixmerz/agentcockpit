mod env_utils;
mod file_watcher;
mod pty;
#[cfg(debug_assertions)]
mod debug_server;

use env_utils::build_extended_path;
use pty::PtyManager;
use std::sync::Arc;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use std::thread;
use std::time::Duration;
use parking_lot::Mutex;
use tauri::RunEvent;
use tauri::Manager;

// =====================================================
// DeltaCodeCube MCP Client (persistent process)
// =====================================================

struct DccMcpClient {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    reader: Option<BufReader<std::process::ChildStdout>>,
    next_id: u64,
    /// Set to true when a call_tool() times out. The spawned reader thread may
    /// still be running in the background holding the BufReader. The client must
    /// be dropped and recreated — use dcc_start() to trigger that.
    stale: bool,
}

impl DccMcpClient {
    fn call_tool(&mut self, name: &str, args: &str) -> Result<String, String> {
        if self.stale {
            return Err("DCC client is stale (previous call timed out). Call dcc_start() to restart.".to_string());
        }
        let id = self.next_id;
        self.next_id += 1;

        let args_value: serde_json::Value = serde_json::from_str(args)
            .map_err(|e| format!("Invalid JSON arguments: {}", e))?;
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": args_value
            }
        }).to_string();

        writeln!(self.stdin, "{}", msg).map_err(|e| format!("dcc write: {}", e))?;
        self.stdin.flush().map_err(|e| format!("dcc flush: {}", e))?;

        let reader = self.reader.take().ok_or("DCC reader not available")?;
        let id_str = format!("\"id\":{}", id);
        let (tx, rx) = std::sync::mpsc::channel::<Result<(String, BufReader<std::process::ChildStdout>), String>>();

        thread::spawn(move || {
            let mut reader = reader;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => {
                        let _ = tx.send(Err("DCC process exited unexpectedly".to_string()));
                        return;
                    }
                    Ok(_) => {
                        let trimmed = line.trim().to_string();
                        if trimmed.is_empty() { continue; }
                        if trimmed.contains(&id_str) {
                            let _ = tx.send(Ok((trimmed, reader)));
                            return;
                        }
                        // Skip unrelated notifications/responses
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("dcc read: {}", e)));
                        return;
                    }
                }
            }
        });

        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok((result, reader))) => {
                self.reader = Some(reader);
                Ok(result)
            }
            Ok(Err(e)) => Err(e),
            Err(_) => {
                // NOTE: The spawned reader thread will self-terminate when the child process
                // is killed (via DccMcpClient::Drop), as the BufReader::read_line will return
                // EOF/error when the pipe closes. No explicit thread join is needed.
                // The `stale` flag ensures dcc_start() is called to recycle the process.
                //
                // The spawned reader thread is still running in the background
                // and holds the BufReader — we cannot safely reclaim it.
                // Mark this client as stale so the next call fails fast and the
                // caller knows to drop and recreate the DCC process.
                self.stale = true;
                log::warn!("DCC tool call timed out after 30s — client marked stale, restart required");
                Err("DCC tool call timed out after 30s. Client is stale — call dcc_start() to restart.".to_string())
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

        // If the existing client is stale (previous call timed out), drop it
        // so we fall through and create a fresh one regardless of data_dir.
        if let Some(ref client) = st.client {
            if client.stale {
                log::warn!("DCC client is stale, dropping and restarting...");
                st.client = None;
                st.current_data_dir = None;
            }
        }

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
        let init_msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": init_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "agentcockpit",
                    "version": "1.0"
                }
            }
        }).to_string();

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
        let notify_msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }).to_string();
        writeln!(stdin, "{}", notify_msg)
            .map_err(|e| format!("dcc notify write: {}", e))?;
        stdin.flush().map_err(|e| format!("dcc notify flush: {}", e))?;

        let client = DccMcpClient { child, stdin, reader: Some(reader), next_id: 2, stale: false };
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

/// Execute an arbitrary shell command in a given working directory.
///
/// # Security
///
/// This function passes `cmd` directly to `sh -c` with no sanitization.
/// The trust boundary is the Tauri WebView — only trusted frontend code
/// can invoke this command. There are no external HTTP callers.
/// The frontend must never construct `cmd` from untrusted external data
/// (e.g., user-pasted URLs, repo names from APIs).
///
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
    let file_watcher_state = Arc::new(Mutex::new(file_watcher::FileWatcherState::new()));
    let file_watcher_for_shutdown = file_watcher_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .manage(pty_manager)
        .manage(dcc_state)
        .manage(file_watcher_state)
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
                    file_watcher::file_watcher_start,
                    file_watcher::file_watcher_stop,
                    file_watcher::file_watcher_status,
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
                    file_watcher::file_watcher_start,
                    file_watcher::file_watcher_stop,
                    file_watcher::file_watcher_status,
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

                // Stop file watcher
                {
                    let mut fw = file_watcher_for_shutdown.lock();
                    fw.stop();
                }
            }
        });
}
