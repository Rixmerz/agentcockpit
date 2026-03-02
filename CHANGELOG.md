# Changelog

All notable changes to AgentCockpit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-03-01

### Fixed
- **Terminal performance regression**: Reverted PTY commands (`pty_spawn`, `pty_write`, `pty_resize`, `pty_close`) and `execute_command` from async/spawn_blocking back to synchronous. The async wrapping added per-keystroke overhead through tokio's blocking thread pool, causing severe terminal lag.
- **DeltaCodeCube auto-execution causing UI freezes**: Removed all automatic DCC triggers that ran on app startup and project open:
  - Removed `autoIndexOnProjectOpen()` from AppShell (was launching DCC server + full indexation on every project open)
  - Removed automatic `reindexProject()` on git commit detection from AppShell
  - Removed auto-loading of DCC stats in ControlBar on project change (now lazy-loads on dropdown open with 3s install-check delay)
  - Removed auto-loading of 10 simultaneous DCC analysis calls in IndexDashboardPanel on project change (now manual via Load button)

### Changed
- DeltaCodeCube is now fully on-demand: server only starts when the user explicitly requests indexing or opens the Index dropdown
- ControlBar Index dropdown uses `onOpen` callback for lazy data loading instead of eager `useEffect`

## [1.2.0] - 2026-02-16

### Added
- **Linux Precompiled Releases**: AppImage, RPM, and DEB packages available for download
- **Linux (Bazzite/Fedora) Cross-Platform Support**: Full Linux build pipeline
- **Graph Enforcer Hook v1.2.0**: Major hook/TS/Rust/Vite fixes
- **Debug Mode**: Console + HTTP bridge + MCP server for development
- **Graph Builder Tools**: New pipeline-manager MCP tools for building graphs

### Changed
- Simplified Linux installation (download precompiled instead of building from source)
- Major UI/architecture overhaul with targeted fixes
- Updated documentation with quick-install section

### Fixed
- Multiple TS/Rust/Vite build issues
- Hook enforcement stability improvements

## [1.0.0] - 2026-01-10

### Added
- **Terminal Notification System**
  - Customizable sound notifications when terminal commands finish
  - 6 predefined notification sounds (chime, pop, ding, tada, coin, default beep)
  - Visual indicator (✓) in sidebar for finished terminals
  - Configurable detection delay (1-10 seconds)
  - Sound preview feature in settings

- **Multi-Terminal Management**
  - Support for multiple terminals per project
  - Terminal renaming with double-click
  - Visual active/inactive state indicators
  - Automatic cleanup of finished terminal indicators on selection

- **MCP (Model Context Protocol) Integration**
  - MCP server management
  - Desktop and code MCP support
  - Server configuration panel
  - Auto-detection of MCP servers

- **Plugin System**
  - Extensible plugin architecture
  - Claude Code integration
  - Cursor Agent support
  - Gemini CLI integration
  - Plugin registry with activation/deactivation

- **Project Management**
  - Multi-project workspace support
  - Project-level configuration
  - Session persistence
  - GitHub integration

- **UI/UX Features**
  - Customizable background images
  - Adjustable opacity settings (background and terminal)
  - Idle mode with configurable timeout
  - Dark mode support
  - Responsive glass-morphism design

- **Snapshots System**
  - Git-based snapshot management
  - Version tracking
  - Automatic snapshot creation
  - Snapshot restore functionality

### Fixed
- Terminal activity tracking infinite loop (useCallback memoization)
- Notification sound path resolution (web vs filesystem paths)
- Terminal finished indicator not disappearing when terminal selected
- Audio notification not playing different sounds

### Changed
- Improved terminal activity detection with two-phase confirmation
- Enhanced sound service with Web Audio API
- Better error handling across services
- Console logging cleanup for production

### Technical
- Built with React 19 + TypeScript
- Tauri v2 for desktop integration
- Vite with Rolldown for blazing-fast builds
- xterm.js for terminal emulation
- Web Audio API for sound notifications

## [0.1.0] - Initial Development

### Added
- Basic terminal functionality
- Project management
- Initial UI/UX implementation

---

[1.2.0]: https://github.com/Rixmerz/agentcockpit/releases/tag/v1.2.0
[1.0.0]: https://github.com/Rixmerz/agentcockpit/releases/tag/v1.0.0
[0.1.0]: https://github.com/Rixmerz/agentcockpit/releases/tag/v0.1.0
