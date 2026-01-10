# Changelog

All notable changes to AgentCockpit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/yourusername/agentcockpit/releases/tag/v1.0.0
[0.1.0]: https://github.com/yourusername/agentcockpit/releases/tag/v0.1.0
