use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty, Child};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};

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

/// Find the last valid UTF-8 character boundary in a byte slice.
/// Returns the number of bytes that form complete UTF-8 characters.
fn find_utf8_boundary(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }

    // Start from the end and look for incomplete UTF-8 sequences
    let len = bytes.len();

    // Check if the last 1-3 bytes might be an incomplete UTF-8 character
    for i in 1..=3.min(len) {
        let pos = len - i;
        let byte = bytes[pos];

        // Check if this byte is a UTF-8 start byte (not a continuation byte 10xxxxxx)
        if byte & 0b1100_0000 != 0b1000_0000 {
            // This is a start byte, check if the sequence is complete
            let expected_len = if byte & 0b1000_0000 == 0 {
                1  // ASCII: 0xxxxxxx
            } else if byte & 0b1110_0000 == 0b1100_0000 {
                2  // 2-byte: 110xxxxx
            } else if byte & 0b1111_0000 == 0b1110_0000 {
                3  // 3-byte: 1110xxxx
            } else if byte & 0b1111_1000 == 0b1111_0000 {
                4  // 4-byte: 11110xxx
            } else {
                1  // Invalid, treat as single byte
            };

            let actual_len = len - pos;
            if actual_len < expected_len {
                // Incomplete sequence, return up to before this byte
                return pos;
            } else {
                // Complete sequence, return all bytes
                return len;
            }
        }
    }

    // If we get here, either all bytes are complete or something is very wrong
    // Try to validate the whole thing
    match std::str::from_utf8(bytes) {
        Ok(_) => len,
        Err(e) => e.valid_up_to(),
    }
}

pub struct PtyInstance {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,  // Track child process for cleanup
}

pub struct PtyManager {
    instances: HashMap<u32, PtyInstance>,
    next_id: u32,
}

impl PtyManager {
    pub fn new() -> Self {
        PtyManager {
            instances: HashMap::new(),
            next_id: 1,
        }
    }

    pub fn spawn(
        &mut self,
        cmd: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        app: AppHandle,
    ) -> Result<u32, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd_builder = CommandBuilder::new(cmd);
        cmd_builder.cwd(cwd);

        // Set environment variables for proper terminal
        cmd_builder.env("TERM", "xterm-256color");
        cmd_builder.env("COLORTERM", "truecolor");

        // CRITICAL: macOS bundled apps have limited environment
        // Copy essential variables explicitly (learned from opcode project)
        // This prevents TCC permission issues and ensures tools work correctly

        // Copy HOME, USER, SHELL from parent process
        if let Ok(home) = std::env::var("HOME") {
            cmd_builder.env("HOME", &home);
        }
        if let Ok(user) = std::env::var("USER") {
            cmd_builder.env("USER", &user);
        }
        if let Ok(shell) = std::env::var("SHELL") {
            cmd_builder.env("SHELL", &shell);
        }

        // Build comprehensive PATH including NVM, Homebrew, and common locations
        let home = std::env::var("HOME").unwrap_or_default();
        let current_path = std::env::var("PATH").unwrap_or_default();

        // Build extended PATH with priority order:
        // 1. NVM node bin (respects user's default alias)
        // 2. Homebrew (Apple Silicon + Intel)
        // 3. User local bin
        // 4. System paths
        // 5. Current PATH
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

        // Append current PATH
        if !current_path.is_empty() {
            paths.push(current_path);
        }

        let extended_path = paths.join(":");
        cmd_builder.env("PATH", &extended_path);

        // Copy additional useful environment variables
        for var in &["LANG", "LC_ALL", "EDITOR", "VISUAL", "XDG_CONFIG_HOME"] {
            if let Ok(value) = std::env::var(var) {
                cmd_builder.env(var, &value);
            }
        }

        // Note: Process group setup (setsid) is handled automatically by portable_pty
        // when spawning the command. The slave PTY makes the child process a session
        // leader as part of standard PTY operation. This ensures kill(-pid) works
        // for the entire process tree.

        let child = pair.slave.spawn_command(cmd_builder).map_err(|e| e.to_string())?;

        let id = self.next_id;
        self.next_id += 1;

        // Get reader and writer
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        // Spawn thread to read PTY output and emit events
        let pty_id = id;
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pending: Vec<u8> = Vec::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // PTY closed - emit any remaining data
                        if !pending.is_empty() {
                            let data = String::from_utf8_lossy(&pending).to_string();
                            let _ = app.emit(&format!("pty-output-{}", pty_id), data);
                        }
                        let _ = app.emit(&format!("pty-close-{}", pty_id), ());
                        break;
                    }
                    Ok(n) => {
                        // Append new data to pending buffer
                        pending.extend_from_slice(&buf[..n]);

                        // Find the last valid UTF-8 boundary
                        let valid_up_to = find_utf8_boundary(&pending);

                        if valid_up_to > 0 {
                            // Convert and emit only complete UTF-8 characters
                            let complete = String::from_utf8_lossy(&pending[..valid_up_to]).to_string();
                            let _ = app.emit(&format!("pty-output-{}", pty_id), complete);

                            // Keep incomplete bytes for next iteration
                            pending.drain(..valid_up_to);
                        }
                    }
                    Err(_) => {
                        let _ = app.emit(&format!("pty-close-{}", pty_id), ());
                        break;
                    }
                }
            }
        });

        self.instances.insert(id, PtyInstance {
            master: pair.master,
            writer,
            child,
        });

        Ok(id)
    }

    pub fn write(&mut self, id: u32, data: &str) -> Result<(), String> {
        let instance = self.instances.get_mut(&id).ok_or("PTY not found")?;
        instance.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        instance.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn resize(&mut self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let instance = self.instances.get_mut(&id).ok_or("PTY not found")?;
        instance.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())
    }

    pub fn close(&mut self, id: u32) -> Result<(), String> {
        if let Some(mut instance) = self.instances.remove(&id) {
            // Kill process group (shell + all descendants like Claude)
            #[cfg(unix)]
            {
                if let Some(pid) = instance.child.process_id() {
                    unsafe {
                        // Send SIGTERM first for graceful shutdown
                        libc::kill(-(pid as i32), libc::SIGTERM);

                        // Wait longer for graceful shutdown (500ms instead of 100ms)
                        // Gives Claude time to cleanup properly
                        std::thread::sleep(std::time::Duration::from_millis(500));

                        // Check if process still exists before SIGKILL
                        let still_alive = libc::kill(-(pid as i32), 0) == 0;

                        if still_alive {
                            // SIGKILL if still running
                            libc::kill(-(pid as i32), libc::SIGKILL);
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                    }
                }
            }

            #[cfg(windows)]
            {
                let _ = instance.child.kill();
            }

            // Wait for child to prevent zombies
            let _ = instance.child.wait();
            drop(instance);
            Ok(())
        } else {
            Err("PTY not found".to_string())
        }
    }

    /// Close all PTY instances - used during shutdown
    pub fn close_all(&mut self) {
        let ids: Vec<u32> = self.instances.keys().copied().collect();
        for id in ids {
            let _ = self.close(id);
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        // Clean up all PTYs when manager is dropped
        self.close_all();
    }
}

// Tauri commands

#[tauri::command]
pub fn pty_spawn(
    cmd: String,
    cwd: String,
    cols: u16,
    rows: u16,
    manager: State<Arc<Mutex<PtyManager>>>,
    app: AppHandle,
) -> Result<u32, String> {
    let mut manager = manager.lock();
    manager.spawn(&cmd, &cwd, cols, rows, app)
}

#[tauri::command]
pub fn pty_write(
    id: u32,
    data: String,
    manager: State<Arc<Mutex<PtyManager>>>,
) -> Result<(), String> {
    let mut manager = manager.lock();
    manager.write(id, &data)
}

#[tauri::command]
pub fn pty_resize(
    id: u32,
    cols: u16,
    rows: u16,
    manager: State<Arc<Mutex<PtyManager>>>,
) -> Result<(), String> {
    let mut manager = manager.lock();
    manager.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_close(
    id: u32,
    manager: State<Arc<Mutex<PtyManager>>>,
) -> Result<(), String> {
    let mut manager = manager.lock();
    manager.close(id)
}
