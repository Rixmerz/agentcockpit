/// Shell command
/// Executes shell commands and returns output
/// Called from frontend terminal when user types a command

use std::process::Command;

/// Execute a shell command and return output
///
/// # Arguments
/// * `command` - The shell command to execute
///
/// # Returns
/// Output of the command or error message
#[tauri::command]
pub fn execute_command(command: &str) -> Result<String, String> {
    // Platform-specific command execution
    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(&["/C", command])
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("sh")
        .arg("-c")
        .arg(command)
        .output();

    match output {
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
