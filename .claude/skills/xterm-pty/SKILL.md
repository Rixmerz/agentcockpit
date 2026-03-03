---
name: xterm-pty
description: xterm.js 6.0 + portable-pty terminal patterns for agentcockpit
---

# xterm.js + PTY

## Overview

agentcockpit uses xterm.js 6.0 for terminal rendering and portable-pty (Rust) for cross-platform PTY management. The PTY runs user's shell, and AI agents are launched as commands within it.

## Configuration

- xterm.js 6.0 with addons: fit, clipboard, web-links, canvas/WebGL renderers
- portable-pty 0.8 (Rust crate)
- Terminal: `TERM=xterm-256color`, 10000 line scrollback
- Font: JetBrainsMono Nerd Font, 14px

## Data Flow

```
User types → xterm.onData → usePty.write → ptyWrite IPC → Rust PtyManager.write → PTY master
PTY output → Rust reader thread (4096 byte chunks) → pty-output-{id} event → usePty.onData → xterm.write
```

## Common Patterns

### Spawning PTY (Rust)
```rust
// PtyManager::spawn creates PTY pair, spawns $SHELL
let pair = pty_system.openpty(PtySize { rows, cols, .. })?;
let mut cmd = CommandBuilder::new(shell);
cmd.cwd(cwd);
cmd.env("TERM", "xterm-256color");
// Clear nested detection vars
cmd.env_remove("CLAUDECODE");
cmd.env_remove("CLAUDE_CODE_ENTRYPOINT");
let child = pair.slave.spawn_command(cmd)?;
```

### Writing to PTY (TypeScript)
```typescript
import { ptyWrite } from '../services/tauriService';
await ptyWrite(ptyId, data);
```

### UTF-8 Boundary Handling (Rust)
The reader thread buffers incomplete UTF-8 sequences across reads using `find_utf8_boundary()` to avoid splitting multi-byte characters.

### Activity Detection
```typescript
const { signalOutput, signalUserInput } = useTerminalActivity({
  terminalId,
  threshold: 3000, // ms of silence before "finished"
  onFinished: handleTerminalFinished,
});
```

### Resume UUID Detection
```typescript
// In TerminalView onData callback
const stripped = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // Strip ANSI
resumeBufferRef.current += stripped;
const match = resumeBufferRef.current.match(
  /claude\s+--resume\s+([0-9a-f]{8}-[0-9a-f]{4}-...-[0-9a-f]{12})/
);
if (match) sessionEvents.emit('resume-detected', { uuid: match[1], terminalId });
```

## Best Practices

1. **Never block PTY writes** — send input immediately, do async work (snapshots) after
2. **Buffer incomplete UTF-8** in reader thread — don't emit partial sequences
3. **SIGTERM then SIGKILL** on close — give process group time to clean up
4. **Guard 0x0 resize** — happens when xterm container gets `display:none`
5. **Use refs for listeners** — prevent re-renders from killing event subscriptions
