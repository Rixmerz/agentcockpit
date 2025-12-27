# Rust Commands Module Contract

**Location:** `src-tauri/src/commands/mod.rs`

**Purpose:** Tauri command handlers - the IPC boundary between React frontend and Rust backend. All frontend invocations map to functions here.

## Exported Commands

### greet(name: &str) -> String
```rust
#[tauri::command]
pub fn greet(name: &str) -> String
```
- Receives name from frontend
- Returns greeting message
- No side effects

### execute_command(command: &str) -> Result<String, String>
```rust
#[tauri::command]
pub async fn execute_command(command: &str) -> Result<String, String>
```
- Receives shell command string
- Returns stdout on success
- Returns stderr on failure
- Platform-aware (Windows/Unix)

## Module Structure
```
commands/
├── mod.rs (exports)
├── greet.rs (greet command)
└── shell.rs (execute_command)
```

## Frontend Correspondence
- Frontend `greet()` → Backend `greet()`
- Frontend `executeCommand()` → Backend `execute_command()`

## Registration
Must be registered in `lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    commands::greet,
    commands::execute_command
])
```

## Security Considerations
- Commands run with application privileges
- Shell execution has access to user environment
- No input validation yet (future)

## Breaking Changes
- Removing command breaks all frontend callers
- Changing return type breaks frontend type safety
- Changing parameter names breaks IPC mapping
