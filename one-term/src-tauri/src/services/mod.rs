/// Services module
/// Business logic for terminal operations, command execution, etc.
/// Separated from commands module for better maintainability

pub mod claude_parser;
pub mod pty;

pub use claude_parser::{ClaudeEvent, ClaudeParser};
pub use pty::PtyManager;
