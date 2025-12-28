use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty, Child};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, State};

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
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // PTY closed
                        let _ = app.emit(&format!("pty-close-{}", pty_id), ());
                        break;
                    }
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&format!("pty-output-{}", pty_id), data);
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
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        // SIGKILL if still running
                        libc::kill(-(pid as i32), libc::SIGKILL);
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
