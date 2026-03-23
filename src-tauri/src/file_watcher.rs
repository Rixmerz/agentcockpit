use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashSet;
use std::ffi::OsStr;
use std::path::{Component, Path};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

// =====================================================
// Constants
// =====================================================

const BATCH_WINDOW_MS: u64 = 300;
const MAX_BATCH_SIZE: usize = 500;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".venv",
    "__pycache__",
    ".agentcockpit",
    ".deltacodecube",
    ".workflow-manager",
    ".claude",
];

const SOURCE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs", "rb",
    "php", "swift", "kt", "scala", "vue", "svelte", "lua",
];

// =====================================================
// Event payload
// =====================================================

#[derive(Clone, Serialize)]
pub struct FileChangePayload {
    #[serde(rename = "projectPath")]
    project_path: String,
    files: Vec<String>,
    timestamp: u64,
}

// =====================================================
// State
// =====================================================

pub struct FileWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_path: Option<String>,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: None,
            watched_path: None,
            shutdown_tx: None,
        }
    }

    /// Stop the active watcher, if any. Safe to call multiple times.
    pub fn stop(&mut self) {
        stop_watcher_inner(self);
    }
}

impl Drop for FileWatcherState {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.watcher = None;
    }
}

// =====================================================
// Helpers
// =====================================================

fn should_ignore_path(path: &Path) -> bool {
    path.components().any(|c| {
        if let Component::Normal(s) = c {
            IGNORED_DIRS.iter().any(|d| s == OsStr::new(d))
        } else {
            false
        }
    })
}

fn is_source_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| SOURCE_EXTENSIONS.contains(&ext))
        .unwrap_or(false)
}

// =====================================================
// Internal: stop any active watcher (caller holds lock)
// =====================================================

fn stop_watcher_inner(state: &mut FileWatcherState) {
    if let Some(tx) = state.shutdown_tx.take() {
        let _ = tx.send(());
    }
    state.watcher = None;
    state.watched_path = None;
}

// =====================================================
// Commands
// =====================================================

#[tauri::command]
pub fn file_watcher_start(
    state: tauri::State<'_, Arc<Mutex<FileWatcherState>>>,
    project_path: String,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let mut st = state.lock();

    // Already watching the same path — nothing to do.
    if st.watched_path.as_deref() == Some(&project_path) {
        return Ok(serde_json::json!({ "already_watching": true }));
    }

    // Watching a different path — stop first.
    if st.watcher.is_some() {
        stop_watcher_inner(&mut st);
    }

    // Channel: notify → batcher thread
    let (event_tx, event_rx) = mpsc::channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            let _ = event_tx.send(res);
        },
        Config::default(),
    )
    .map_err(|e| format!("file_watcher: create watcher: {}", e))?;

    // NOTE: notify follows symlinks by default with RecursiveMode::Recursive.
    // If the project contains symlinks to external directories (e.g., node_modules),
    // those directories will also be watched. The IGNORED_DIRS filter mitigates this
    // for common cases, but custom symlinks may still be followed.
    watcher
        .watch(Path::new(&project_path), RecursiveMode::Recursive)
        .map_err(|e| format!("file_watcher: watch path: {}", e))?;

    // Shutdown channel
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

    // Batcher thread
    let path_for_thread = project_path.clone();
    thread::spawn(move || {
        let mut batch: HashSet<String> = HashSet::new();

        loop {
            // Check for shutdown signal (non-blocking).
            if shutdown_rx.try_recv().is_ok() {
                break;
            }

            match event_rx.recv_timeout(Duration::from_millis(BATCH_WINDOW_MS)) {
                Ok(Ok(event)) => {
                    // Only care about Create, Modify, Remove.
                    let relevant = matches!(
                        event.kind,
                        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                    );
                    if !relevant {
                        continue;
                    }
                    for path in event.paths {
                        if should_ignore_path(&path) {
                            continue;
                        }
                        if !is_source_file(&path) {
                            continue;
                        }
                        if let Some(s) = path.to_str() {
                            batch.insert(s.to_owned());
                        }
                        // Cap batch size to avoid unbounded memory growth in very active repos.
                        if batch.len() >= MAX_BATCH_SIZE {
                            let files: Vec<String> = batch.drain().collect();
                            let timestamp = SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            let payload = FileChangePayload {
                                project_path: path_for_thread.clone(),
                                files,
                                timestamp,
                            };
                            let _ = app.emit("dcc:files-changed", payload);
                        }
                    }
                }
                Ok(Err(e)) => {
                    log::warn!("file_watcher: notify error: {}", e);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Batch window expired — emit if non-empty.
                    if !batch.is_empty() {
                        let files: Vec<String> = batch.drain().collect();
                        let timestamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        let payload = FileChangePayload {
                            project_path: path_for_thread.clone(),
                            files,
                            timestamp,
                        };
                        let _ = app.emit("dcc:files-changed", payload);
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // Sender dropped (watcher stopped) — flush and exit.
                    if !batch.is_empty() {
                        let files: Vec<String> = batch.drain().collect();
                        let timestamp = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        let payload = FileChangePayload {
                            project_path: path_for_thread.clone(),
                            files,
                            timestamp,
                        };
                        let _ = app.emit("dcc:files-changed", payload);
                    }
                    break;
                }
            }
        }
    });

    st.watcher = Some(watcher);
    st.watched_path = Some(project_path.clone());
    st.shutdown_tx = Some(shutdown_tx);

    Ok(serde_json::json!({ "ok": true, "path": project_path }))
}

#[tauri::command]
pub fn file_watcher_stop(
    state: tauri::State<'_, Arc<Mutex<FileWatcherState>>>,
) -> Result<serde_json::Value, String> {
    let mut st = state.lock();
    stop_watcher_inner(&mut st);
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn file_watcher_status(
    state: tauri::State<'_, Arc<Mutex<FileWatcherState>>>,
) -> Result<serde_json::Value, String> {
    let st = state.lock();
    Ok(serde_json::json!({
        "active": st.watcher.is_some(),
        "path": st.watched_path,
    }))
}
