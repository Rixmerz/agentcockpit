# Rust Models Contract

**Location:** `src-tauri/src/models/mod.rs`

**Purpose:** Shared data types between frontend and backend. All types here must be serializable for IPC transport.

## Exported Types

### TerminalSession
```rust
pub struct TerminalSession {
    pub id: String,           // Unique session identifier
    pub title: String,        // Display name
    pub active: bool,         // Whether session is active
}
```
- Derives: `Serialize`, `Deserialize`, `Clone`
- Used for session management (future)

### CommandResult
```rust
pub struct CommandResult {
    pub output: String,       // Command stdout
    pub exit_code: i32,       // Process exit code
}
```
- Derives: `Serialize`, `Deserialize`
- Used for command execution responses (future)

## JSON Representation
Both types are automatically serialized to JSON for IPC:
```json
{
  "TerminalSession": {
    "id": "term_1",
    "title": "bash",
    "active": true
  },
  "CommandResult": {
    "output": "command output...",
    "exit_code": 0
  }
}
```

## Breaking Changes
- Adding required fields breaks deserialization
- Removing fields breaks frontend type safety
- Changing type breaks serialization format
- Renaming fields breaks JSON mapping
