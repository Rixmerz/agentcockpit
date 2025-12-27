/// Shell command
/// Executes shell commands and returns output
/// Called from frontend terminal when user types a command

use std::process::Command;

/// Execute a shell command and return output
///
/// # Arguments
/// * `command` - The shell command to execute
/// * `cwd` - Optional working directory
///
/// # Returns
/// Output of the command or error message
#[tauri::command]
pub fn execute_command(command: &str, cwd: Option<String>) -> Result<String, String> {
    // Platform-specific command execution
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("cmd");
    #[cfg(target_os = "windows")]
    cmd.args(&["/C", command]);

    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new("sh");
    #[cfg(not(target_os = "windows"))]
    cmd.arg("-c").arg(command);

    // Set working directory if provided
    if let Some(dir) = cwd {
        cmd.current_dir(&dir);
    }

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            if output.status.success() {
                Ok(stdout)
            } else {
                // Return stderr if command failed
                Err(if stderr.is_empty() {
                    "Command execution failed".to_string()
                } else {
                    stderr
                })
            }
        }
        Err(e) => Err(format!("Failed to execute command: {}", e)),
    }
}
