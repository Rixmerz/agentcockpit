/// Commands module
/// All Tauri commands (IPC handlers) are defined here
/// Commands act as the boundary between frontend (React/TS) and backend (Rust)

pub mod greet;
pub mod shell;

pub use greet::greet;
pub use shell::execute_command;
