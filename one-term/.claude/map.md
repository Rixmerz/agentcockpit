# one-term Project Map

**Type:** Tauri + React 19 + Rust Desktop Application
**Purpose:** Terminal emulator with xterm integration
**Status:** v0.1.0 - Initial CFA structure established

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ FRONTEND (React 19 + TypeScript)                        │
├─────────────────────────────────────────────────────────┤
│ src/                                                    │
│ ├── App.jsx (root component)                           │
│ ├── App.css (global styles)                            │
│ ├── main.jsx (entry point)                             │
│ ├── components/                                         │
│ │   └── Terminal.tsx + Terminal.module.css            │
│ ├── hooks/                                              │
│ │   └── useTerminal.ts (xterm initialization)         │
│ ├── services/                                           │
│ │   └── tauriService.ts (IPC communication)           │
│ ├── contexts/ (future)                                 │
│ ├── utils/ (future)                                    │
│ ├── types/ (future)                                    │
│ └── assets/                                             │
├─────────────────────────────────────────────────────────┤
│ TAURI / IPC BRIDGE                                      │
├─────────────────────────────────────────────────────────┤
│ BACKEND (Rust 2021)                                     │
├─────────────────────────────────────────────────────────┤
│ src-tauri/src/                                          │
│ ├── main.rs (app entry)                                │
│ ├── lib.rs (app setup + command registration)         │
│ ├── commands/                                           │
│ │   ├── mod.rs (exports)                               │
│ │   ├── greet.rs (demo command)                        │
│ │   └── shell.rs (execute_command)                     │
│ ├── services/ (future)                                 │
│ │   └── mod.rs (terminal session management)          │
│ ├── models/                                             │
│ │   └── mod.rs (TerminalSession, CommandResult)       │
│ └── utils/ (future)                                    │
└─────────────────────────────────────────────────────────┘
```

## Frontend Features

### Components
- **Terminal** - xterm wrapper with header controls
  - Uses `useTerminal` hook
  - Styled with Terminal.module.css
  - Not accepting props yet (root component)

### Hooks
- **useTerminal** - Terminal lifecycle management
  - Initializes xterm instance
  - Loads FitAddon (resizing) and WebLinksAddon
  - Handles window resize events
  - Cleanup on unmount

### Services
- **tauriService** - Centralized IPC communication
  - `invokeCommand<T, R>()` - Generic command invoker
  - `greet(name)` - Demo command
  - `executeCommand(cmd)` - Shell execution (ready)

## Backend Features

### Commands
- **greet(name)** - Demo command, returns greeting
- **execute_command(cmd)** - Execute shell command
  - Platform-aware (Windows/Unix)
  - Returns stdout on success
  - Returns stderr on error

### Models
- **TerminalSession** - Session metadata
  - id, title, active status
  - Serializable for IPC
- **CommandResult** - Command output
  - output, exit_code
  - Serializable for IPC

## Dependencies

### Frontend (package.json)
```json
{
  "react": "^19.1.0",
  "react-dom": "^19.1.0",
  "@tauri-apps/api": "^2",
  "@tauri-apps/plugin-opener": "^2",
  "@xterm/xterm": "^5.3.0",
  "@xterm/addon-fit": "^0.11.0",
  "@xterm/addon-web-links": "^0.12.0"
}
```

### Backend (Cargo.toml)
```toml
[dependencies]
tauri = "2"
tauri-plugin-opener = "2"
serde = "1"
serde_json = "1"
```

## CFA Structure

```
.claude/
├── .onboarding_status
├── settings.local.json
├── knowledge_graph.db
├── contracts/
│   ├── Terminal.contract.md
│   ├── useTerminal.contract.md
│   ├── tauriService.contract.md
│   ├── RustCommands.contract.md
│   └── RustModels.contract.md
├── decisions.md (architectural decisions)
└── map.md (this file)
```

## Data Flow

```
User Input (Terminal UI)
    ↓
Terminal Component (xterm)
    ↓
useTerminal Hook + tauriService
    ↓
Tauri IPC invoke("execute_command")
    ↓
Rust: execute_command(cmd)
    ↓
Shell execution (sh/cmd.exe)
    ↓
Output → IPC Response
    ↓
tauriService returns Promise
    ↓
Terminal Component renders output
```

## Next Steps

### Immediate (v0.2.0)
- [ ] Connect Terminal component to execute_command
- [ ] Add input event listener to terminal
- [ ] Send input to backend via IPC
- [ ] Display command output in terminal

### Short-term (v0.3.0)
- [ ] Terminal session management service
- [ ] PTY support for interactive shells (node-pty via Tauri)
- [ ] Multiple terminal tabs
- [ ] Theme switching

### Medium-term (v0.4.0)
- [ ] Command history
- [ ] Search/find in terminal
- [ ] Copy/paste integration
- [ ] Performance optimization for large outputs

## Key Decisions

See `.claude/decisions.md` for detailed rationales:
1. xterm.js for terminal UI
2. Tauri IPC with service layer
3. Modular Rust structure
4. useTerminal hook for lifecycle
5. CSS Modules for styling

## Testing Strategy (Future)

- Frontend: Jest + React Testing Library
- Backend: Rust unit tests
- E2E: Tauri test utilities

## Build & Run

```bash
# Install dependencies
npm install

# Development
npm run tauri dev

# Production build
npm run tauri build
```

## Notes

- Project uses Tauri for desktop framework
- React 19 with functional components
- TypeScript recommended for frontend
- Rust 2021 edition for backend
- Terminal will support Unix shells initially
- Windows support via CMD/PowerShell execution
