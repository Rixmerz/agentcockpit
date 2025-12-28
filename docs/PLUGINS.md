# AgentCockpit Plugin Development Guide

Esta guia explica como crear plugins de agentes para AgentCockpit.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Plugin Structure](#plugin-structure)
4. [Manifest Reference](#manifest-reference)
5. [Component Props](#component-props)
6. [Terminal Utilities](#terminal-utilities)
7. [Type Definitions](#type-definitions)
8. [Examples](#examples)

---

## Overview

AgentCockpit usa una arquitectura de plugins para integrar agentes AI. Cada plugin:

- Define metadata en un `manifest.json`
- Exporta un objeto `AgentPlugin` con componentes React
- Usa utilities compartidas para interactuar con la terminal
- Se registra automaticamente al iniciar la app

### Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                   ActionsPanel                       │
│  ┌───────────────────────────────────────────────┐  │
│  │              AgentTabs                         │  │
│  │  [Plugin A] [Plugin B] [Plugin C]             │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │         Active Plugin Content                  │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │ plugin.QuickActions                     │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │ plugin.Launcher                         │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │ plugin.McpPanel                         │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Crear estructura del plugin

```bash
mkdir -p src/agents/myplugin/{components,services}
```

### 2. Crear manifest.json

```json
{
  "id": "myplugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "Description of my plugin",
  "author": "Your Name",
  "icon": "/myplugin-logo.svg",
  "color": "#FF6B6B",
  "cli": {
    "command": "myplugin",
    "installCheck": "which myplugin"
  },
  "components": {
    "launcher": true,
    "mcpPanel": false
  }
}
```

### 3. Crear index.ts

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { AgentPlugin } from '../../plugins/types/plugin';
import manifest from './manifest.json';
import { MyLauncher } from './components/MyLauncher';
import { MyQuickActions } from './components/MyQuickActions';

export const myPlugin: AgentPlugin = {
  manifest: manifest as AgentPlugin['manifest'],

  Launcher: MyLauncher,
  QuickActions: MyQuickActions,

  buildCommand: (options) => {
    const args = ['myplugin'];
    if (options.sessionId) args.push('--session', options.sessionId);
    return args.join(' ');
  },

  validateInstallation: async () => {
    try {
      await invoke<string>('execute_command', {
        cmd: 'which myplugin',
        cwd: '/',
      });
      return true;
    } catch {
      return false;
    }
  },

  onActivate: () => console.log('[MyPlugin] Activated'),
  onDeactivate: () => console.log('[MyPlugin] Deactivated'),
};
```

### 4. Registrar en App.tsx

```typescript
import { myPlugin } from './agents/myplugin';

function App() {
  return (
    <AppProvider>
      <PluginProvider initialPlugins={[claudePlugin, myPlugin]}>
        <MainContent />
      </PluginProvider>
    </AppProvider>
  );
}
```

---

## Plugin Structure

```
src/agents/<plugin-id>/
├── manifest.json           # Plugin metadata (required)
├── index.ts                # Plugin export (required)
├── components/
│   ├── Launcher.tsx        # Model selection, launch button
│   ├── QuickActions.tsx    # Quick action buttons
│   └── McpPanel.tsx        # MCP server management (optional)
└── services/
    └── service.ts          # Business logic, command building
```

---

## Manifest Reference

```typescript
interface AgentPluginManifest {
  // Required
  id: string;              // Unique ID: 'claude', 'gemini'
  name: string;            // Display name: 'Claude Code'
  version: string;         // Semantic version: '1.0.0'
  description: string;     // Short description
  author: string;          // Author name
  icon: string;            // Path to icon or URL
  color: string;           // Brand color (hex)

  cli: {
    command: string;       // CLI command: 'claude'
    installCheck: string;  // Check command: 'which claude'
    installUrl?: string;   // Installation URL
  };

  components: {
    launcher?: boolean;    // Has launcher component
    mcpPanel?: boolean;    // Has MCP panel
    customPanels?: string[];
  };

  // Optional
  configPaths?: {
    desktop?: string;      // '~/Library/Application Support/Claude/'
    user?: string;         // '~/.claude.json'
    project?: string;      // '.claude/'
  };

  quickActions?: QuickActionConfig[];
  models?: ModelConfig[];
}
```

### Quick Actions Config

```typescript
interface QuickActionConfig {
  id: string;
  label: string;
  icon: string;           // Lucide icon name
  command: string;
  type: 'command' | 'action' | 'multiline' | 'control';
  shortcut?: string;
  tooltip?: string;
}
```

### Models Config

```typescript
interface ModelConfig {
  id: string;
  name: string;
  description?: string;
  default?: boolean;
}
```

---

## Component Props

### LauncherProps

```typescript
interface LauncherProps {
  projectPath: string | null;
  session: SessionInfo | null;
  hasActiveTerminal: boolean;
  mcpsToInject: McpServerInfo[];
  mcpsToRemove: string[];
  ensureSession: () => Promise<SessionInfo | null>;
  onLaunch: (command: string) => void;
  onWriteToTerminal: (data: string) => Promise<void>;
}
```

**Usage Example:**

```typescript
function MyLauncher({
  projectPath,
  hasActiveTerminal,
  ensureSession,
  onLaunch,
}: LauncherProps) {
  const handleLaunch = async () => {
    const session = await ensureSession();
    if (!session) return;

    const command = `myplugin --session ${session.id}`;
    onLaunch(command);
  };

  return (
    <button onClick={handleLaunch} disabled={!hasActiveTerminal}>
      Launch My Plugin
    </button>
  );
}
```

### QuickActionsProps

```typescript
interface QuickActionsProps {
  onWriteToTerminal: (data: string) => Promise<void>;
  disabled: boolean;
}
```

**Usage Example:**

```typescript
import { executeAction, sendControlChar } from '../../../core/utils/terminalCommands';

function MyQuickActions({ onWriteToTerminal, disabled }: QuickActionsProps) {
  return (
    <div>
      <button
        onClick={() => executeAction(onWriteToTerminal, '/help')}
        disabled={disabled}
      >
        Help
      </button>
      <button
        onClick={() => sendControlChar(onWriteToTerminal, '\x03')}
        disabled={disabled}
      >
        Cancel (Ctrl+C)
      </button>
    </div>
  );
}
```

### McpPanelProps

```typescript
interface McpPanelProps {
  projectPath: string | null;
  onMcpsChange?: (toInject: McpServerInfo[], toRemove: string[]) => void;

  // Legacy props (optional)
  selectedServers?: string[];
  onSelectionChange?: (servers: string[]) => void;
  onMcpsForInjection?: (mcps: McpServerInfo[]) => void;
  onMcpsForRemoval?: (names: string[]) => void;
}
```

---

## Terminal Utilities

### Import

```typescript
import {
  delay,
  executeCommand,
  executeAction,
  executeMultiline,
  sendControlChar,
  escapeJsonForShell,
  joinCommandsSequential,
  wrapCommandSafe,
} from '../../core/utils/terminalCommands';
```

### Functions Reference

#### `delay(ms: number): Promise<void>`

Espera un tiempo determinado. Usado entre comandos de terminal.

```typescript
await delay(100); // Wait 100ms
```

#### `executeCommand(writer, command): Promise<void>`

Ejecuta un comando simple con delay y newline.

```typescript
await executeCommand(onWriteToTerminal, 'ls -la');
// Writes: ls -la\n
```

#### `executeAction(writer, action): Promise<void>`

Ejecuta una accion con delay y carriage return. Ideal para comandos interactivos.

```typescript
await executeAction(onWriteToTerminal, '/compact');
// Writes: /compact + delay + \r
```

#### `executeMultiline(writer, lines): Promise<void>`

Ejecuta multiples lineas con delays entre cada una.

```typescript
await executeMultiline(onWriteToTerminal, [
  'ultrathink',
  'analyze this code',
]);
```

#### `sendControlChar(writer, char): Promise<void>`

Envia caracteres de control (Ctrl+C, etc).

```typescript
await sendControlChar(onWriteToTerminal, '\x03'); // Ctrl+C
await sendControlChar(onWriteToTerminal, '\x04'); // Ctrl+D
await sendControlChar(onWriteToTerminal, '\x1a'); // Ctrl+Z
```

#### `escapeJsonForShell(obj): string`

Escapa JSON para uso seguro en shell.

```typescript
const config = { command: 'node', args: ['server.js'] };
const escaped = escapeJsonForShell(config);
// Returns: {\"command\":\"node\",\"args\":[\"server.js\"]}
```

#### `joinCommandsSequential(commands): string`

Une comandos con `;` para ejecucion secuencial.

```typescript
const cmd = joinCommandsSequential([
  'mcp remove old-server',
  'mcp add new-server',
  'claude',
]);
// Returns: mcp remove old-server ; mcp add new-server ; claude
```

#### `wrapCommandSafe(cmd): string`

Envuelve comando para suprimir errores (continua si falla).

```typescript
const safe = wrapCommandSafe('mcp remove maybe-exists');
// Returns: (mcp remove maybe-exists 2>/dev/null || true)
```

### Constants

```typescript
export const PTY_DELAY = 50;      // Delay entre escrituras
export const CLEANUP_DELAY = 200; // Delay para cleanup
```

---

## Type Definitions

### SessionInfo

```typescript
interface SessionInfo {
  id: string;
  name: string;
  createdAt: number;
  lastUsed: number;
  model?: string;
  terminalId?: string;
  wasPreExisting?: boolean;
}
```

### McpServerInfo

```typescript
interface McpServerInfo {
  name: string;
  config: McpServerConfig;
  source: string;  // 'desktop', 'code', 'project'
}
```

### McpServerConfig

```typescript
interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  [key: string]: unknown;
}
```

### BuildCommandOptions

```typescript
interface BuildCommandOptions {
  sessionId?: string;
  resume?: boolean;
  model?: string;
  additionalArgs?: string[];
  mcpDesktop?: boolean;
  mcpDefault?: boolean;
}
```

---

## Examples

### Claude Plugin (Reference Implementation)

Located at `src/agents/claude/`

**Key Features:**
- Model switching via `/model` command
- MCP server injection
- Session management with `--resume` / `--session-id`
- Quick actions: Ultrathink, Compact, Clear, Cancel

### Minimal Plugin Example

```typescript
// src/agents/minimal/index.ts
import type { AgentPlugin } from '../../plugins/types/plugin';

const manifest = {
  id: 'minimal',
  name: 'Minimal Agent',
  version: '1.0.0',
  description: 'A minimal plugin example',
  author: 'Developer',
  icon: '🤖',  // Can use emoji
  color: '#10B981',
  cli: {
    command: 'minimal-cli',
    installCheck: 'which minimal-cli',
  },
  components: {
    launcher: true,
  },
};

export const minimalPlugin: AgentPlugin = {
  manifest,

  buildCommand: ({ sessionId }) => {
    return sessionId ? `minimal-cli --session ${sessionId}` : 'minimal-cli';
  },

  validateInstallation: async () => {
    // Always return true for testing
    return true;
  },
};
```

---

## Best Practices

1. **Type Safety**: Always implement `AgentPlugin` interface
2. **Error Handling**: Use `wrapCommandSafe()` for optional commands
3. **Delays**: Use terminal utilities with proper delays
4. **Manifest**: Keep `manifest.json` declarative and JSON-only
5. **Components**: Keep components focused and single-responsibility
6. **Services**: Extract business logic to `services/` directory

---

## Troubleshooting

### Plugin not showing in tabs

1. Verify `validateInstallation()` returns `true`
2. Check plugin is registered in `App.tsx`
3. Check browser console for errors

### Commands not executing

1. Use `executeAction()` instead of direct write for interactive commands
2. Add proper delays between commands
3. Check terminal is active (`hasActiveTerminal`)

### Type errors

1. Ensure manifest matches `AgentPluginManifest` interface
2. Check component props match expected interfaces
3. Import types from `../../plugins/types/plugin`

---

## Future Plans

- [ ] Dynamic plugin loading from `~/.agentcockpit/plugins/`
- [ ] Plugin marketplace
- [ ] Hot reload support
- [ ] Plugin configuration UI
