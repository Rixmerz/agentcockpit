---
name: react-tauri
description: React 19 + Tauri v2 patterns and best practices for agentcockpit
---

# React 19 + Tauri v2

## Overview

agentcockpit is a desktop app built with React 19 (frontend) and Tauri v2 (Rust backend). The React app runs inside a Tauri webview, communicating with Rust via IPC (`invoke`).

## Project Configuration

- React 19.2.0, react-dom 19.2.0
- Vite (rolldown-vite 7.2.5) with `@vitejs/plugin-react`
- TypeScript 5.9 strict mode
- pnpm package manager
- Tauri v2 (2.9.5) with plugins: dialog, fs, shell, os, log

## Common Patterns

### Tauri IPC (React → Rust)
```typescript
import { invoke } from '@tauri-apps/api/core';

// Call Rust command
const result = await invoke<string>('execute_command', { cmd: 'ls', cwd: '/path' });

// With timeout wrapper (prevents hangs in bundled app)
import { withTimeout } from '../core/utils/promiseTimeout';
const result = await withTimeout(invoke<string>('command', args), 5000, 'description');
```

### Tauri Events (Rust → React)
```typescript
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen<string>('event-name', (event) => {
  console.log(event.payload);
});
// Cleanup in useEffect return
return () => { unlisten(); };
```

### Tauri FS Plugin
```typescript
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
const content = await readTextFile('/path/to/file');
await writeTextFile('/path/to/file', content);
```

### Component Pattern
- Functional components with `memo()` for expensive renders
- `useCallback` and `useRef` to avoid re-render cascades
- Context-based state (`AppContext`) with `useReducer`
- Custom hooks for Tauri bridges (`usePty`, `useTauriBrowserView`)

### State Management
- `AppContext` with `useReducer` for global state (projects, terminals, settings)
- Selector hooks: `useApp()`, `useAppSettings()`, `useTerminalActivityState()`
- Event bus (CustomEvent on `window`) for cross-component communication
- Per-project config in `agentcockpit-project.json`

## Best Practices

1. **Always wrap `invoke()` with `withTimeout()`** — bundled Tauri apps can hang on IPC
2. **Use Tauri FS plugin as fallback** when shell `cat`/`echo` fails
3. **Clear Tauri env vars** when spawning child processes to prevent nested detection
4. **Use `memo()`** on terminal and browser components (expensive renders)
5. **Store `UnlistenFn` in refs** and clean up in `useEffect` return

## File Organization
```
src/
├── agents/         # Plugin-specific code (per agent)
├── components/     # UI components (by domain)
├── contexts/       # React contexts
├── core/           # Shared utilities, event bus
├── hooks/          # Custom React hooks
├── layouts/        # App shell layout components
├── plugins/        # Plugin system infrastructure
├── services/       # Business logic (no UI)
├── styles/         # CSS themes and global styles
└── types/          # TypeScript type definitions
```
