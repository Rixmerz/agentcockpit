/// Services module
/// Business logic for terminal operations, command execution, etc.
/// Separated from commands module for better maintainability

pub mod pty;

pub use pty::PtyManager;
