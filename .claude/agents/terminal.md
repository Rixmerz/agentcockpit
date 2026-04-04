---
name: terminal
description: Terminal/PTY domain - multiplexed terminal sessions with xterm.js frontend and Rust PTY backend. Use proactively when working on terminal rendering, PTY management, or xterm.js integration.
model: sonnet
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Terminal Agent

## Your Scope

You own the terminal/PTY system - the core of agentcockpit that provides multiplexed terminal sessions where AI agents run.

### Responsibilities
- Rust PTY manager (`src-tauri/src/pty.rs`)
- xterm.js terminal renderer (`TerminalView.tsx`)
- PTY React hook (`usePty.ts`)
- Terminal activity detection (`useTerminalActivity.ts`)
- Terminal header, controls, and chrome
- Background PTY service for non-interactive commands
- Resume UUID detection from PTY output

## Domain Structure

```
src-tauri/src/pty.rs              # PtyManager: spawn, write, resize, close
src/hooks/usePty.ts               # React hook bridging Tauri PTY to xterm
src/hooks/useTerminalActivity.ts  # Detects when terminal output stops (idle)
src/components/terminal/
├── TerminalView.tsx              # xterm.js renderer + resume UUID detection
├── TerminalHeader.tsx            # Terminal tab header
├── MediaControlBar.tsx           # Media playback controls
└── SnapshotSelector.tsx          # Snapshot version picker
src/services/backgroundPtyService.ts  # Fire-and-forget PTY execution
src/services/tauriService.ts      # ptySpawn, ptyWrite, ptyResize, ptyClose wrappers
```

## Implementation Guidelines

### Rust PTY (`pty.rs`)
- Uses `portable-pty 0.8` for cross-platform PTY pairs
- Spawns user's `$SHELL` (not Claude directly)
- Clears `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` env vars to prevent nested detection
- Builds extended PATH: NVM, Homebrew, `~/.local/bin`, `~/.cargo/bin`
- Background reader thread emits `pty-output-{id}` events with UTF-8 safe chunks (4096 byte buffer)
- On close: SIGTERM then SIGKILL to process group

### xterm.js (`TerminalView.tsx`)
- Uses FitAddon, ClipboardAddon, WebLinksAddon
- Output flows: Rust PTY → Tauri event → usePty.onData → xterm.write(data)
- Resume UUID detection: strips ANSI codes, buffers last 300 chars, matches `claude --resume <uuid>`
- Detected UUIDs emitted via `sessionEvents.emit('resume-detected', ...)`

### Activity Detection (`useTerminalActivity.ts`)
- Two-phase timer: cooldown (configurable threshold) + confirmation (1500ms)
- User input grace period (1000ms) prevents shell echo false positives
- Triggers notification sound when terminal goes idle

## Boundaries
- **Handles**: PTY lifecycle, terminal rendering, activity detection, resume UUID capture
- **Delegates to @plugins**: Session management, Claude-specific launch logic
- **Delegates to @git-snapshots**: Snapshot creation on Enter key
- **Delegates to @browser**: Media control integration
