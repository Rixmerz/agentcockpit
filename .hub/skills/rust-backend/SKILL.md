---
name: rust-backend
description: Rust/Tauri v2 backend patterns for agentcockpit native functionality
---

# Rust Backend (Tauri v2)

## Overview

agentcockpit's Rust backend provides native capabilities: PTY management, embedded browser, codebase analysis process management, and shell command execution.

## Project Structure

```
src-tauri/
├── Cargo.toml         # Dependencies and Tauri plugins
├── src/
│   ├── lib.rs         # Main Tauri setup, command registration, DCC process mgmt
│   ├── pty.rs         # PtyManager: spawn, write, resize, close
│   └── browser.rs     # BrowserState: webview create, navigate, show/hide
├── tauri.conf.json    # Tauri config (window, plugins, permissions)
└── capabilities/      # Permission definitions
```

## Common Patterns

### Tauri Command Definition
```rust
#[tauri::command]
async fn my_command(app: AppHandle, arg: String) -> Result<String, String> {
    // Use parking_lot Mutex for state
    let state = app.state::<Mutex<MyState>>();
    let mut guard = state.lock();
    // ... do work
    Ok(result)
}
```

### State Management
```rust
use parking_lot::Mutex;

// Register state in lib.rs
app.manage(Mutex::new(PtyManager::new()));
app.manage(Mutex::new(BrowserState::new()));

// Access in commands
let pty = app.state::<Mutex<PtyManager>>();
let mut pty = pty.lock(); // parking_lot: no .unwrap() needed
```

### Background Threads
```rust
// PTY reader thread pattern
std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app.emit(&format!("pty-output-{}", id), data);
            }
            Err(_) => break,
        }
    }
});
```

### Process Cleanup (Unix)
```rust
use libc::{kill, SIGTERM, SIGKILL};

// Graceful shutdown: SIGTERM, wait, SIGKILL
unsafe { kill(-(pid as i32), SIGTERM); }
std::thread::sleep(Duration::from_millis(100));
unsafe { kill(-(pid as i32), SIGKILL); }
```

## Key Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.9.5 | Desktop framework |
| `portable-pty` | 0.8 | Cross-platform PTY |
| `parking_lot` | 0.12 | Fast Mutex (no poisoning) |
| `serde` + `serde_json` | 1.0 | Serialization |
| `uuid` | 1.x | UUID v4 generation |
| `tiny_http` | 0.12 | Debug HTTP server |

## Best Practices

1. **Use `parking_lot::Mutex`** over `std::sync::Mutex` — no poisoning, faster
2. **Kill process groups** (`-pid`) not individual processes
3. **Emit events from background threads** — don't block Tauri commands
4. **Handle UTF-8 boundaries** when reading from PTY
5. **Clean up on Drop** — implement proper resource cleanup
6. **Use `Result<T, String>`** for Tauri command return types (serializable errors)
