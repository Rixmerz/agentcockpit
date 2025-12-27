/// Models module
/// Shared data types and structures between frontend and backend
/// All types here should be serializable/deserializable for IPC

use serde::{Deserialize, Serialize};

/// Terminal session info
#[derive(Serialize, Deserialize, Clone)]
pub struct TerminalSession {
    pub id: String,
    pub title: String,
    pub active: bool,
}

/// Command execution result
#[derive(Serialize, Deserialize)]
pub struct CommandResult {
    pub output: String,
    pub exit_code: i32,
}
