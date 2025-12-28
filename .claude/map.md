# AgentCockpit - Project Map

## What This Project Does

**AgentCockpit** es una aplicacion de escritorio Tauri que funciona como "cockpit" para desarrolladores que usan agentes AI. Implementa una **arquitectura de plugins** que permite integrar multiples agentes (Claude, Gemini, etc.) de forma modular.

### Core Features:
- **Plugin System**: Arquitectura extensible para agentes AI
- **Terminal Manager**: Multiples terminales xterm.js por proyecto con persistencia
- **Session Management**: Gestion de sesiones por agente
- **MCP Integration**: Inyeccion dinamica de servidores MCP
- **Glassmorphism UI**: Interfaz moderna con efectos de vidrio

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        React Frontend                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Sidebar Left │  │ Main Content │  │     Sidebar Right        │  │
│  │ - Projects   │  │ - Terminal   │  │ ┌──────────────────────┐ │  │
│  │ - Navigator  │  │   View       │  │ │    AgentTabs         │ │  │
│  └──────────────┘  └──────────────┘  │ │ [Claude] [Gemini]... │ │  │
│                                       │ └──────────────────────┘ │  │
│                                       │ ┌──────────────────────┐ │  │
│                                       │ │  Active Plugin UI    │ │  │
│                                       │ │ - QuickActions       │ │  │
│                                       │ │ - Launcher           │ │  │
│                                       │ │ - McpPanel           │ │  │
│                                       │ └──────────────────────┘ │  │
│                                       │ ┌──────────────────────┐ │  │
│                                       │ │  Core Components     │ │  │
│                                       │ │ - SessionManager     │ │  │
│                                       │ │ - PortMonitor        │ │  │
│                                       │ └──────────────────────┘ │  │
│                                       └──────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│  AppContext (Global State)  │  PluginContext (Plugin State)        │
├─────────────────────────────────────────────────────────────────────┤
│                        Tauri Bridge (IPC)                           │
├─────────────────────────────────────────────────────────────────────┤
│                        Rust Backend (PTY Manager)                   │
└─────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── core/                          # Core utilities (agent-agnostic)
│   ├── components/
│   │   └── AgentTabs.tsx          # Tab bar for switching agents
│   └── utils/
│       └── terminalCommands.ts    # Reusable terminal utilities
│
├── plugins/                       # Plugin system infrastructure
│   ├── types/
│   │   └── plugin.ts              # TypeScript interfaces
│   ├── registry/
│   │   └── PluginRegistry.ts      # Central plugin registry
│   └── context/
│       └── PluginContext.tsx      # React context for plugins
│
├── agents/                        # Agent plugins
│   └── claude/                    # Claude Code plugin
│       ├── manifest.json          # Plugin metadata
│       ├── index.ts               # Plugin export
│       ├── components/
│       │   ├── ClaudeLauncher.tsx
│       │   ├── McpPanel.tsx
│       │   └── QuickActions.tsx
│       └── services/
│           └── claudeService.ts
│
├── components/                    # Core UI components
│   ├── terminal/
│   ├── sidebar-left/
│   ├── sidebar-right/
│   │   ├── ActionsPanel.tsx       # Plugin-aware container
│   │   ├── SessionManager.tsx     # Core (always visible)
│   │   └── PortMonitor.tsx        # Core (always visible)
│   ├── settings/
│   └── common/
│
├── contexts/
│   └── AppContext.tsx             # Global app state
│
├── hooks/
│   ├── usePty.ts
│   └── usePersistence.ts
│
├── services/                      # Core services
│   ├── tauriService.ts
│   ├── projectSessionService.ts
│   ├── fileSystemService.ts
│   └── mcpService.ts
│
└── App.tsx                        # Root with PluginProvider
```

## Plugin System

### Key Files

| File | Purpose |
|------|---------|
| `src/plugins/types/plugin.ts` | Complete type definitions for plugins |
| `src/plugins/registry/PluginRegistry.ts` | Singleton managing plugin lifecycle |
| `src/plugins/context/PluginContext.tsx` | React hooks: `usePlugins()`, `useActivePlugin()` |
| `src/core/utils/terminalCommands.ts` | Reusable terminal utilities |
| `src/core/components/AgentTabs.tsx` | UI for switching between agents |

### Plugin Structure

Each plugin in `src/agents/<name>/` contains:
- `manifest.json` - Declarative metadata
- `index.ts` - Plugin export implementing `AgentPlugin`
- `components/` - React components (Launcher, McpPanel, QuickActions)
- `services/` - Business logic

### Adding a New Plugin

See `docs/PLUGINS.md` for complete guide.

## Data Flow

### Plugin Activation Flow
```
[App.tsx] → [PluginProvider initialPlugins={[claudePlugin]}]
                            ↓
[PluginRegistry.register()] → [validateInstallation()]
                            ↓
[usePlugins()] → [installedPlugins, activePlugin, setActivePlugin]
                            ↓
[ActionsPanel] → [AgentTabs] → [activePlugin.Launcher/McpPanel/QuickActions]
```

### Terminal Command Flow
```
[Plugin QuickActions] → [executeAction(onWriteToTerminal, '/compact')]
                                    ↓
[terminalCommands.ts] → [delay(50)] → [writer('\r')]
                                    ↓
[PTY receives] → [Command executed in terminal]
```

## Entry Points

| Entry Point | Purpose |
|-------------|---------|
| `src/main.tsx` | React app initialization |
| `src/App.tsx` | Root component with PluginProvider |
| `src-tauri/src/main.rs` | Tauri bootstrap |

## Current State

- ✅ Plugin architecture implemented
- ✅ Claude extracted as first plugin
- ✅ Reusable terminal utilities
- ✅ Type-safe plugin contracts
- ✅ AgentTabs UI
- ⏳ Gemini plugin (planned)
- ⏳ External plugin loading (planned)

## Non-Obvious Things

1. **Plugin validation**: Each plugin's `validateInstallation()` is called on load to check CLI availability

2. **Legacy props**: `McpPanelProps` includes both new (`onMcpsChange`) and legacy props for backwards compatibility

3. **Session handling**: `ensureSession()` callback passed to Launcher guarantees session exists before command building

4. **MCP injection order**: Commands built as: remove MCPs → add MCPs → launch agent (sequential with `;`)

5. **CSS variables**: Plugins can use `--plugin-color` for brand-specific styling in tabs

## Key Decisions

See `.claude/decisions/` for ADRs:
- `001-commercial-name-agentcockpit.md` - Commercial name decision
- `002-plugin-architecture.md` - Plugin system design (pending)
