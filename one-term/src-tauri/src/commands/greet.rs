/// Greet command
/// Example command that demonstrates Tauri IPC communication
/// Called from frontend via: invoke("greet", { name: "value" })

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
