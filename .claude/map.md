# AgentCockpit - Project Map

## What This Project Does

**AgentCockpit** es una aplicación de escritorio Tauri que funciona como "cockpit" para desarrolladores que usan agentes AI. Actualmente soporta Claude Code, con visión de expandir a otros agentes (Cursor, Copilot, etc). Proporciona:

- **Terminal Manager**: Múltiples terminales xterm.js por proyecto con persistencia
- **Claude Session Manager**: Gestión de sesiones Claude con soporte para `--resume` y `--session-id`
- **MCP Server Integration**: Inyección dinámica de servidores MCP desde Desktop y Code configs
- **Glassmorphism UI**: Interfaz moderna con efectos de vidrio y soporte para wallpapers personalizados
- **Port Monitor**: Seguimiento de puertos activos por proyecto

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Frontend                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Sidebar Left │  │ Main Content │  │   Sidebar Right      │  │
│  │ - Projects   │  │ - Terminal   │  │ - Sessions           │  │
│  │ - Navigator  │  │   View       │  │ - MCP Panel          │  │
│  │ - Mini Term  │  │              │  │ - Actions/Launcher   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                      AppContext (Global State)                   │
│  - Projects, Terminals, Settings, MCP configs                   │
├─────────────────────────────────────────────────────────────────┤
│                      Tauri Bridge (IPC)                         │
├─────────────────────────────────────────────────────────────────┤
│                        Rust Backend                             │
│  - PTY Manager (spawn, write, resize, close)                    │
│  - File System operations                                        │
└─────────────────────────────────────────────────────────────────┘
```

## Entry Points

| Entry Point | Purpose |
|-------------|---------|
| `src/main.tsx` | React app initialization, renders App component |
| `src-tauri/src/main.rs` | Tauri app bootstrap |
| `src-tauri/src/lib.rs` | Tauri command handlers registration |

## Data Flow

### Terminal Data Flow
```
[User Input] → [xterm.js onData] → [usePty.write] → [Tauri IPC] → [Rust pty.write] → [Shell]
                                                                                        ↓
[xterm.write] ← [usePty.onData callback] ← [Tauri event] ← [Rust pty_output event] ←───┘
```

### Session Management Flow
```
[Load Project] → [getProjectConfig()] → [Mark wasPreExisting=true] → [Display in SessionManager]
                                                                              ↓
[Select Session] → [updateSessionLastUsed()] → [ClaudeLauncher builds command]
                                                         ↓
[New Session] → [createSession()] → [wasPreExisting=false] → [--session-id <uuid>]
[Existing Session] → [wasPreExisting=true] → [--resume <uuid>]
```

### MCP Injection Flow
```
[Load MCP Configs] → [Desktop ~/.claude.json] + [Code .mcp.json]
                              ↓
[McpPanel selects servers] → [mcpsToInject, mcpsToRemove]
                              ↓
[ClaudeLauncher] → [claude mcp remove ...] → [claude mcp add-json ...] → [claude --session-id]
```

## File Purpose Index

### Core Application

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/App.tsx` | Root component, layout structure | Renders sidebars + main content |
| `src/App.css` | Global styles, glassmorphism theme | Variables, component styles |
| `src/main.tsx` | React entry point | Mounts App to DOM |

### Context & State

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/contexts/AppContext.tsx` | Global state management | `AppProvider`, `useApp`, `useProjects`, `useTerminals`, `useSettings` |

### Components - Terminal

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/components/terminal/TerminalView.tsx` | xterm.js wrapper with PTY integration | `TerminalView` |
| `src/components/terminal/TerminalHeader.tsx` | Terminal tab header with controls | `TerminalHeader` |

### Components - Sidebar Left

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/components/sidebar-left/PathNavigator.tsx` | Project folder browser | `PathNavigator` |
| `src/components/sidebar-left/MiniTerminal.tsx` | Compact terminal for quick commands | `MiniTerminal` |

### Components - Sidebar Right

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/components/sidebar-right/ActionsPanel.tsx` | Container for Claude launcher and actions | `ActionsPanel` |
| `src/components/sidebar-right/ClaudeLauncher.tsx` | Builds and executes Claude CLI commands | `ClaudeLauncher` |
| `src/components/sidebar-right/SessionManager.tsx` | Claude session CRUD | `SessionManager` |
| `src/components/sidebar-right/McpPanel.tsx` | MCP server selection UI | `McpPanel` |
| `src/components/sidebar-right/PortMonitor.tsx` | Active port tracking | `PortMonitor` |

### Components - Common

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/components/common/Modal.tsx` | Reusable modal component | `Modal` |
| `src/components/settings/SettingsModal.tsx` | App settings UI | `SettingsModal` |

### Hooks

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/hooks/usePty.ts` | PTY lifecycle management | `usePty` |
| `src/hooks/usePersistence.ts` | Config file read/write | `loadConfig`, `saveConfig`, `usePersistence` |

### Services

| File | Purpose | Key Functions |
|------|---------|---------------|
| `src/services/tauriService.ts` | Tauri IPC wrappers | `ptySpawn`, `ptyWrite`, `ptyResize`, `ptyClose`, `onPtyOutput` |
| `src/services/claudeService.ts` | Claude CLI utilities | `buildClaudeCommand`, `listClaudeSessions`, `readSessionEnv` |
| `src/services/projectSessionService.ts` | Per-project session persistence | `getProjectConfig`, `createSession`, `updateSessionLastUsed` |
| `src/services/mcpService.ts` | MCP config loading | `loadDesktopMcps`, `loadCodeMcps`, `loadMcpConfigs` |
| `src/services/fileSystemService.ts` | FS operations | `openFolderDialog`, `listDirectory`, `pathExists` |

### Rust Backend

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src-tauri/src/main.rs` | Tauri bootstrap | `main()` |
| `src-tauri/src/lib.rs` | Command registration | `run()` |
| `src-tauri/src/pty.rs` | PTY management | `PtyManager`, `spawn`, `write`, `resize`, `close` |

## Current State

- ✅ Core terminal functionality working
- ✅ Multi-project support with persistence
- ✅ Claude session management
- ✅ MCP server injection
- ✅ Glassmorphism UI with wallpaper support
- ✅ Port monitoring
- ✅ Commercial name decided: **AgentCockpit**
- ⏳ Branding assets pending (logo, icons)
- ⏳ Distribution packaging pending (.dmg)

## Non-Obvious Things

1. **Terminal persistence**: Terminals survive tab switches because cleanup in `useEffect` is intentionally empty. Destruction only happens when explicitly removed from project.

2. **wasPreExisting flag**: Sessions loaded from JSON get `wasPreExisting=true` to use `--resume`. Runtime-created sessions get `wasPreExisting=false` to use `--session-id`.

3. **xterm transparency**: Requires both `allowTransparency: true` in Terminal options AND CSS overrides on `.xterm-viewport` because xterm renders in canvas.

4. **MCP injection order**: Must remove MCPs first, then add, then launch Claude - all in sequence with `;` separator.

5. **PTY ID tracking**: `registerPtyId()` maps terminalId → ptyId so PTY can be properly closed when terminal is removed.

## Key Decisions

See `.claude/decisions/` for ADRs:
- `001-commercial-name-agentcockpit.md` - Why AgentCockpit was chosen as commercial name
