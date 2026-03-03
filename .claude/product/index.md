# AgentCockpit - Product Specification

## Overview

AgentCockpit is a desktop application for managing AI coding agents. It provides a unified interface with multiplexed terminals, embedded browser, plugin-based agent integration (Claude Code, Cursor Agent, Gemini CLI, Agentful), automatic git snapshots, MCP server management, codebase analysis, and workflow orchestration.

## Goals

- [x] Multi-agent support via plugin architecture
- [x] Multiplexed terminal sessions with xterm.js + native PTY
- [x] Automatic snapshot versioning for safe AI agent interactions
- [x] MCP server management across Desktop and Code configs
- [x] Embedded browser with media controls
- [ ] Cross-platform stability (macOS + Linux)
- [ ] Test coverage (currently 0%)
- [ ] Production packaging and distribution

## Tech Stack

### Frontend
- **Framework**: React 19.2 + Vite (rolldown-vite 7.2.5)
- **Language**: TypeScript 5.9
- **Styling**: Pure CSS Custom Properties (glassmorphism, dark themes)
- **State Management**: React Context + useReducer
- **Terminal**: xterm.js 6.0 (canvas/WebGL renderers)
- **Icons**: lucide-react
- **Diagrams**: mermaid 11.x

### Backend (Native)
- **Framework**: Tauri v2 (2.9.5)
- **Language**: Rust (edition 2021)
- **PTY**: portable-pty 0.8
- **Sync**: parking_lot 0.12
- **Plugins**: dialog, fs, shell, os, log

### Testing
- **Unit**: (none configured)
- **E2E**: (none configured)

### Deployment
- **Packaging**: Tauri bundler (AppImage, RPM for Linux; .app for macOS)

## Domains

### 1. Agent Plugin System [CRITICAL]
Pluggable architecture for AI CLI agents. Each plugin provides manifest, launcher, quick actions, and optional MCP panel.

**Features:**
- [x] Plugin manifest and registry
- [x] Claude Code integration (launcher, sessions, MCP panel, quick actions)
- [x] Agentful integration (dev loop, quality gates, quick actions)
- [x] Cursor Agent integration
- [x] Gemini CLI integration
- [x] Session management with Claude resume UUID capture
- [ ] Plugin hot-reload / dynamic loading

### 2. Terminal / PTY [CRITICAL]
Multiplexed terminal sessions with native PTY backend and xterm.js rendering.

**Features:**
- [x] Native PTY spawn via Rust (portable-pty)
- [x] xterm.js 6.0 rendering with addons (fit, clipboard, web-links)
- [x] Multiple terminal tabs per project
- [x] Terminal activity detection (idle/finished notifications)
- [x] Resume UUID detection from PTY output
- [x] Background PTY service for non-interactive commands
- [ ] Terminal search
- [ ] Split terminal panes

### 3. Git / Snapshots [HIGH]
Full git abstraction with automatic versioned snapshots before each agent interaction.

**Features:**
- [x] Git init, status, commit, tag, push, clone, stash
- [x] Auto-snapshot on Enter (Snapshot V1, V2, ...)
- [x] Snapshot restore (time-travel)
- [x] Squash-before-push (compact snapshots into real commit)
- [x] Max 50 snapshots per project with cleanup
- [x] Snapshot event bus for cross-component sync
- [ ] Snapshot diff viewer

### 4. MCP Management [HIGH]
Read/write MCP server configurations for AI agents.

**Features:**
- [x] Read Desktop + Code MCP configs
- [x] Add/remove individual MCP servers
- [x] Import Desktop MCPs to Code
- [x] MCP injection before agent launch
- [x] Status indicator + management modal
- [x] Cross-platform config paths (macOS + Linux)

### 5. Embedded Browser [MEDIUM]
Tauri child webview embedded in the app with media detection.

**Features:**
- [x] Native webview via Tauri add_child
- [x] Multi-tab management
- [x] Media detection (YouTube, HTML5 players)
- [x] Play/pause/next/prev controls
- [x] URL reporting back to React
- [ ] Fix Linux overflow issue (tauri#11452)

### 6. DeltaCodeCube Analysis [MEDIUM]
External codebase analysis tool integration with quality scoring and visualizations.

**Features:**
- [x] DCC process lifecycle (spawn/call/stop via JSON-RPC 2.0)
- [x] Dashboard with overall score + grade distribution
- [x] Architecture view
- [x] Dependency matrix
- [x] Heatmap (complexity/quality)
- [x] Timeline (evolution)
- [ ] Auto-trigger analysis on significant changes

### 7. Workflow / Graph [MEDIUM]
AI agent workflow orchestration with Mermaid visualization.

**Features:**
- [x] Workflow YAML definitions
- [x] Mermaid graph rendering
- [x] Workflow steps bar in control bar
- [x] Integration with workflow-manager MCP
- [x] Node execution and state tracking
- [ ] Visual graph editor

## Architecture Notes

### Design Patterns
- Plugin architecture for agent extensibility
- Event bus (CustomEvent) for cross-component communication
- Background PTY for non-blocking git operations
- Tauri IPC with timeout wrappers for resilience
- CSS Custom Properties for theming

### Constraints
- Tauri v2 child webview has Linux sizing issues (deferred)
- No test framework configured yet
- macOS TCC permissions require careful Tauri FS/shell handling

## Out of Scope (for MVP)

- Mobile support
- Cloud sync / collaboration
- Agent marketplace / plugin store
- Real-time collaboration between users
