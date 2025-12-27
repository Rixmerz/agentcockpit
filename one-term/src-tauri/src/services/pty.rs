/// PTY Service
/// Manages pseudo-terminal sessions for interactive programs (tmux, vim, etc.)

use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use std::thread;

/// Global PTY session state
pub struct PtySession {
    pair: PtyPair,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    reader_thread: Option<thread::JoinHandle<()>>,
}

/// PTY Manager - handles PTY lifecycle
pub struct PtyManager {
    session: Mutex<Option<PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }

    /// Spawn a new PTY session with the default shell
    pub fn spawn(
        &self,
        cols: u16,
        rows: u16,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
    ) -> Result<(), String> {
        let mut session = self.session.lock();

        // Close existing session if any
        if session.is_some() {
            drop(session.take());
        }

        // Create PTY
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Get default shell
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

        // Build command
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");

        // Spawn child process
        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Get writer for input
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;
        let writer = Arc::new(Mutex::new(writer));

        // Get reader for output
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        // Spawn reader thread
        let reader_thread = thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        on_output(buf[..n].to_vec());
                    }
                    Err(_) => break,
                }
            }
        });

        *session = Some(PtySession {
            pair,
            writer,
            reader_thread: Some(reader_thread),
        });

        Ok(())
    }

    /// Write data to PTY (user input)
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let session = self.session.lock();
        if let Some(ref s) = *session {
            let mut writer = s.writer.lock();
            writer
                .write_all(data)
                .map_err(|e| format!("Failed to write to PTY: {}", e))?;
            writer
                .flush()
                .map_err(|e| format!("Failed to flush PTY: {}", e))?;
            Ok(())
        } else {
            Err("No PTY session active".to_string())
        }
    }

    /// Resize PTY
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.session.lock();
        if let Some(ref s) = *session {
            s.pair
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| format!("Failed to resize PTY: {}", e))?;
            Ok(())
        } else {
            Err("No PTY session active".to_string())
        }
    }

    /// Check if PTY is active
    pub fn is_active(&self) -> bool {
        self.session.lock().is_some()
    }

    /// Close PTY session
    pub fn close(&self) {
        let mut session = self.session.lock();
        if let Some(s) = session.take() {
            // Writer will be dropped, closing the PTY
            drop(s.writer);
            if let Some(thread) = s.reader_thread {
                let _ = thread.join();
            }
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}
