# Investigación: Shell Execution sin problemas TCC

**Proyecto analizado:** [winfunc/opcode](https://github.com/winfunc/opcode)
**Fecha:** 2026-01-04
**Objetivo:** Entender cómo opcode maneja ejecución de shell sin problemas de TCC en macOS

---

## Resumen Ejecutivo

opcode evita problemas de TCC usando `tokio::process::Command` en lugar de PTY, habilitando `macOSPrivateApi`, y copiando explícitamente variables de entorno críticas al proceso hijo.

---

## Stack Tecnológico de opcode

| Componente | Tecnología |
|------------|------------|
| Frontend | React 18 + TypeScript + Vite 6 |
| Backend | Rust + Tauri 2 |
| Base de datos | SQLite |
| Package manager | Bun |

---

## Hallazgos Clave

### 1. No usan portable-pty

**Dependencias relevantes:**
```toml
tauri-plugin-shell = "2"
tauri-plugin-process = "2"
tokio = { version = "1", features = ["full"] }
# NO tiene portable-pty
```

Usan `tokio::process::Command` directamente, lo cual:
- Evita complejidad de pseudo-terminales
- Hereda permisos del proceso padre más limpiamente
- No dispara las mismas verificaciones TCC que PTY

### 2. Función create_command_with_env()

Copian explícitamente variables de entorno críticas:

```rust
fn create_command_with_env(path: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(path);

    // Variables críticas heredadas
    // PATH, HOME, USER, SHELL

    // Soporte NVM: agrega /nvm/versions/node/ al PATH
    // Soporte Homebrew: incluye /opt/homebrew/ en PATH

    cmd
}
```

**Razón:** "macOS apps have a limited PATH environment"

### 3. macOSPrivateApi habilitado

En `tauri.conf.json`:
```json
{
  "app": {
    "macOSPrivateApi": true
  }
}
```

### 4. Flag --dangerously-skip-permissions

Al invocar Claude CLI:
```rust
cmd.arg("--dangerously-skip-permissions");
cmd.arg("--output-format").arg("stream-json");
```

### 5. ProcessRegistry con fallbacks robustos

Estrategia escalonada para terminar procesos:

1. `tokio::Child.start_kill()` - Intento directo
2. Comando del sistema:
   - Unix: `kill -TERM {pid}` → verificar → `kill -KILL {pid}`
   - Windows: `taskkill /F /PID {pid}`
3. Timeout de 5 segundos
4. Limpieza del registry

### 6. Info.plist minimalista

```xml
<key>NSAppleEventsUsageDescription</key>
<string>opcode needs to send Apple Events to other applications.</string>

<key>NSCameraUsageDescription</key>
<string>opcode needs camera access for capturing images for AI processing.</string>

<key>NSMicrophoneUsageDescription</key>
<string>opcode needs microphone access for voice input features.</string>
```

**No incluyen:**
- NSHomeDirectoryUsageDescription
- NSDocumentsFolderUsageDescription
- NSDesktopFolderUsageDescription

### 7. Capabilities de Tauri

Permisos clave:
```json
{
  "permissions": [
    "shell:allow-execute",
    "shell:allow-spawn",
    "shell:allow-open",
    "fs:scope-home-recursive",
    "fs:read-all",
    "fs:write-all",
    "process:default"
  ]
}
```

---

## Comparación: opcode vs one-term

| Aspecto | opcode | one-term |
|---------|--------|----------|
| Ejecución shell | `tokio::process::Command` | `portable-pty` |
| macOSPrivateApi | `true` | No configurado |
| Sandbox | No especificado | Deshabilitado |
| NSHomeDirectoryUsageDescription | No | Sí |
| Entitlements explícitos | No vistos | 3 entitlements |
| Variables de entorno | Copia explícita | ? |

---

## Por qué opcode no tiene problemas de TCC

1. **tokio::process::Command** hereda permisos del proceso padre de forma más directa que PTY

2. **No acceden al home de forma que dispare TCC** - el shell spawned ya tiene permisos heredados

3. **Variables de entorno explícitas** aseguran PATH correcto incluyendo NVM/Homebrew

4. **macOSPrivateApi** permite acceso a APIs privadas de macOS

5. **--dangerously-skip-permissions** evita prompts interactivos de Claude CLI

---

## Recomendaciones para one-term

### Opción A: Migrar de portable-pty a tokio::process::Command

**Pros:**
- Evita complejidad de TCC con PTY
- Modelo probado por opcode

**Contras:**
- Pierde features de terminal real (ANSI, resize, etc.)
- Refactor significativo

### Opción B: Mantener portable-pty + ajustes

1. Agregar `macOSPrivateApi: true` en tauri.conf.json
2. Copiar explícitamente PATH, HOME, USER, SHELL al PTY
3. Incluir rutas NVM/Homebrew en PATH
4. Usar `--dangerously-skip-permissions` con Claude CLI

### Opción C: Híbrido

- Usar `tokio::process::Command` para Claude CLI
- Mantener PTY solo para terminal interactiva general

---

## Archivos relevantes de opcode

| Archivo | Propósito |
|---------|-----------|
| `src-tauri/src/commands/claude.rs` | Ejecución de Claude CLI |
| `src-tauri/src/process/registry.rs` | Gestión de procesos |
| `src-tauri/tauri.conf.json` | Config Tauri con macOSPrivateApi |
| `src-tauri/capabilities/default.json` | Permisos de la app |

---

## Referencias

- [opcode GitHub](https://github.com/winfunc/opcode)
- [Tauri Shell Plugin](https://tauri.app/plugin/shell/)
- [macOS TCC](https://developer.apple.com/documentation/security/transparency_consent_and_control)
