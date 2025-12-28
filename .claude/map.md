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
| eslint.config.js | (unknown purpose) | (none) |
| vite.config.ts | (unknown purpose) | (none) |
| src-tauri/build.rs | (unknown purpose) | (none) |
| src-tauri/src/lib.rs | Exports: run | run |
| src-tauri/src/main.rs | (unknown purpose) | (none) |
| src-tauri/src/pty.rs | Defines: PtyInstance, PtyManager | new, spawn, write, resize, close |
| src/App.tsx | (unknown purpose) | (none) |
| src/main.tsx | (unknown purpose) | (none) |
| src/types/index.ts | (unknown purpose) | (none) |
| src/contexts/AppContext.tsx | Exports: AppProvider, useApp, useProjects | AppProvider, useApp, useProjects, useTerminals, useSettings |
| src/components/terminal/TerminalView.tsx | Exports: TerminalView | TerminalView |
| src/components/terminal/TerminalHeader.tsx | Exports: TerminalHeader | TerminalHeader |
| src/components/sidebar-left/MiniTerminal.tsx | Exports: MiniTerminal | MiniTerminal |
| src/components/sidebar-left/PathNavigator.tsx | Exports: PathNavigator | PathNavigator |
| src/components/sidebar-right/SessionManager.tsx | Exports: SessionManager | SessionManager |
| src/components/sidebar-right/ActionsPanel.tsx | Exports: ActionsPanel | ActionsPanel |
| src/components/sidebar-right/McpPanel.tsx | Exports: McpPanel | McpPanel |
| src/components/sidebar-right/ClaudeLauncher.tsx | Exports: ClaudeLauncher | ClaudeLauncher |
| src/hooks/usePersistence.ts | Exports: loadConfig, saveConfig, usePersistence | loadConfig, saveConfig, usePersistence |
| src/hooks/usePty.ts | Exports: usePty | usePty |
| src/services/projectSessionService.ts | Exports: getProjectConfig, saveProjectConfig, createSession | getProjectConfig, saveProjectConfig, createSession, updateSessionLastUsed, deleteSession |
| src/services/tauriService.ts | Exports: ptySpawn, ptyWrite, ptyResize | ptySpawn, ptyWrite, ptyResize, ptyClose, onPtyOutput |
| src/services/claudeService.ts | Exports: readSessionEnv, getCurrentSessionId, listClaudeSessions | readSessionEnv, getCurrentSessionId, listClaudeSessions, buildClaudeCommand |
| src/services/fileSystemService.ts | Exports: openFolderDialog, executeCommand, listDirectory | openFolderDialog, executeCommand, listDirectory, pathExists, getCurrentDirectory |
| src/services/mcpService.ts | Exports: getDesktopConfigPath, loadDesktopMcps, getCodeConfigPath | getDesktopConfigPath, loadDesktopMcps, getCodeConfigPath, loadCodeMcps, loadMcpConfigs |

## Current State
- ⏳ Map generated from code analysis

## Non-Obvious Things
(none documented yet)
