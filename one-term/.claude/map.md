# Project Map

## What This Project Does
(analyze contracts/ for description)

## Entry Points
- (no entry points detected)

## Data Flow
[Input] → [Process] → [Output]

## File Purpose Index
| File | Purpose | Key Functions |
|------|---------|---------------|
| vite.config.js | (unknown purpose) | (none) |
| src-tauri/build.rs | (unknown purpose) | (none) |
| src-tauri/src/lib.rs | Exports: run | run |
| src-tauri/src/main.rs | (unknown purpose) | (none) |
| src-tauri/src/models/mod.rs | Defines: TerminalSession, CommandResult | (none) |
| src-tauri/src/commands/shell.rs | Exports: execute_command | execute_command |
| src-tauri/src/commands/mod.rs | (unknown purpose) | (none) |
| src-tauri/src/commands/greet.rs | Exports: greet | greet |
| src-tauri/src/commands/pty.rs | Exports: pty_spawn, pty_close, get_claude_events | pty_spawn, get_claude_buffer, get_claude_events, clear_claude_parser, pty_write |
| src-tauri/src/services/claude_parser.rs | Defines: ClaudeParser, ClaudeEvent, ParserState | new, process, get_buffer, get_events, clear |
| src-tauri/src/services/mod.rs | (unknown purpose) | (none) |
| src-tauri/src/services/pty.rs | Defines: PtySession, PtyManager | new, spawn, write, resize, is_active |
| src/main.jsx | (unknown purpose) | (none) |
| src/App.jsx | (unknown purpose) | (none) |
| src/components/ControlPanel.tsx | Exports: ControlPanel | ControlPanel |
| src/components/Terminal.tsx | Exports: Terminal | Terminal |
| src/hooks/useTerminal.ts | Exports: useTerminal | useTerminal |
| src/services/tauriService.ts | Exports: executeCommand, ptySpawn, ptyWrite | executeCommand, ptySpawn, ptyWrite, ptyResize, ptyIsActive |

## Current State
- ⏳ Map generated from code analysis

## Non-Obvious Things
(none documented yet)
