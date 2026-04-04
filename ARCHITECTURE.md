# AgentCockpit Architecture

## System Overview

Three-layer desktop application for controlling AI agents from a unified terminal interface.

```
┌─────────────────────────────────────────────┐
│ Frontend: React 19 + TypeScript + Vite      │
│ Components → Hooks → Services → Tauri IPC   │
├─────────────────────────────────────────────┤
│ Backend: Rust + Tauri v2                     │
│ PTY mgmt, file watcher, DCC bridge, env     │
├─────────────────────────────────────────────┤
│ MCP Servers (subprocess, JSON-RPC stdio)     │
│ ├── workflow-manager (Python/FastMCP)        │
│ └── deltacodecube (Python/FastMCP)           │
└─────────────────────────────────────────────┘
```

**Version:** 1.2.0 | **Platform:** Linux (Bazzite/Fedora Atomic, Wayland)

## Frontend Architecture

### Layers
| Layer | Path | Files | Purpose |
|-------|------|-------|---------|
| Components | `src/components/` (9 dirs) | 28 `.tsx` | UI only: local state, handlers, JSX |
| Hooks | `src/hooks/` | 17 custom hooks | Domain logic (PTY, git, DCC, workflow, etc.) |
| Services | `src/services/` | 45+ `.ts` | Business logic, I/O, Tauri invoke |
| Contexts | `src/contexts/` | 6 files | Global state: AppContext + domain splits |
| Layouts | `src/layouts/` | 4 files | AppShell, MainContent, SidebarLeft, SidebarRight |
| Core | `src/core/` | utils, debug | Event buses, debug registry, pure utilities |

### Key Patterns
- `memo()` on heavy components (TerminalView, ControlBar, SidebarLeft, MainContentArea)
- `useCallback` with stable deps for all context callbacks
- `TerminalActivityContext` isolated from main AppContext (prevents PTY output re-renders)
- `requestAnimationFrame` for `xterm.open()` (deferred DOM work)
- All terminals rendered in DOM with `display:none` for inactive projects (PTY persistence)
- `PanelErrorBoundary` per-section (crash isolation)

### State Management
AppContext uses `useReducer` with 3 domain reducers (project, settings, terminal).
`stableStateRef` + version counter pattern prevents terminalActivity churn from
invalidating the main context memo.

### Key Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.2 | UI framework |
| `@tauri-apps/api` | 2.9 | Rust backend IPC |
| `@xterm/xterm` | 6.0 | Terminal emulator |
| `mermaid` | 11.13 | Workflow graph rendering (lazy-loaded) |
| `lucide-react` | 0.562 | Icons |
| `rolldown-vite` | 7.2 | Build tool (aliased as `vite`) |

## Rust Backend (`src-tauri/src/`)

| Module | Lines | Purpose |
|--------|-------|---------|
| `lib.rs` | 440 | Tauri app setup, DCC MCP client (JSON-RPC over stdio), execute_command |
| `pty.rs` | 450 | PTY spawn/read/write/resize/close via portable-pty, reader threads |
| `file_watcher.rs` | 423 | Native inotify watcher with 300ms batch window, Tauri events |
| `env_utils.rs` | 250 | PATH building with NVM detection, OnceLock cache |
| `debug_server.rs` | 258 | Dev-only HTTP server for debug bridge (`cfg(debug_assertions)`) |
| `browser.rs` | 579 | Child webview management (disconnected, planned feature) |

### Key Rust Dependencies
| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.9.5 | App framework (unstable + macos-private-api features) |
| `portable-pty` | 0.8 | Cross-platform PTY |
| `parking_lot` | 0.12 | Fast mutexes (preferred over std::sync::Mutex) |
| `notify` | 7 | File system watcher (inotify on Linux) |
| `serde_json` | 1.0 | JSON serialization |
| `tiny_http` | 0.12 | Debug HTTP server |

### Key Patterns
- `parking_lot::Mutex` over `std::sync::Mutex`
- DCC MCP client: stdin/stdout JSON-RPC, stale detection on timeout, auto-restart
- `execute_command`: `sh -c` with curated environment (trust boundary = WebView)
- MCP messages built with `serde_json::json!()` (not `format!`)
- `build_extended_path()` cached via `OnceLock<String>` -- computed once per process

## DCC MCP Server (`.deltacodecube/`)

57 MCP tools across 7 categories:
- **Core** (8): index, position, search, stats
- **Analysis** (11): graph centrality, smells, clusters, debt, clones, drift
- **Contracts** (2): dependency tracking with baseline distances
- **Deltas** (5): reindex, tensions, movement detection
- **Search** (7): compare, export, semantic similarity (Ollama)
- **Visualizations** (4): HTML heatmaps, architecture graphs, timelines, matrices
- **Security** (20): SARIF ingestion, Trivy/Semgrep scanning, risk scoring, blast radius

### Database
SQLite with WAL mode. 13 tables across 6 migrations:
- `code_points` -- 63D feature vectors (lexical + structural + semantic + AST + graph)
- `contracts` -- file dependencies with baseline distances
- `deltas` + `tensions` -- change tracking and contract violations
- `security_findings` + `security_risks` -- SARIF ingestion + hybrid risk scoring
- `runtime_zones` -- execution count tracking
- `embeddings` (separate DB) -- 768D Ollama embeddings cache

### Embeddings
`nomic-embed-text` via local Ollama (auto-started in Podman). Used in:
1. Pattern catalog semantic ranking
2. Experience memory scoring (60% embedding + 40% keyword)
3. Experience recorder (embeds at commit time)
4. Graph traverse (related files injection)
5. Security findings ranking

## Workflow Manager (`.workflow-manager/`)

Python MCP server (FastMCP) with these subsystems:

| Module | Purpose |
|--------|---------|
| `graph_engine.py` | DAG-based workflow execution engine |
| `graph_parser.py` | YAML workflow definition parser |
| `tools/graph_core.py` | Traverse, status, task management MCP tools |
| `tools/graph_builder.py` | Workflow creation/editing tools |
| `tools/graph_management.py` | Activate, reset, validate |
| `tools/experience.py` | Cross-project learning from commits |
| `tools/pattern_catalog_tools.py` | Auto-extracted code patterns |
| `tools/project_metadata_tools.py` | Migration numbers, bounded contexts, tech stack |
| `tools/trend_tools.py` | Quality metrics snapshots over time |
| `dcc_integration.py` | Smart filtering, baseline comparison, tension gates |
| `mcp_connection.py` | MCP proxy for DCC tools |
| `session.py` | Session state management |

### DAG Task System
Nodes can be `node_type="dag"` with individual `tasks[]` that have:
- `dependencies: list[str]` -- explicit dep edges
- `tools_blocked: list[str]` -- per-task enforcement (e.g., block Write until design phase)
- `mcps_enabled: list[str]` -- per-task MCP access (e.g., force sequential-thinking)

Orchestrator flow: `graph_get_ready_tasks()` -> launch subagents -> `graph_task_complete()` -> cascade

## Hook System (`.claude/hooks/`)

Python hooks auto-installed by `setupProjectDefaults()` in `src/services/hookService.ts`:

| Hook | Trigger | What it injects |
|------|---------|-----------------|
| `smart_context.py` | PreToolUse Read/Edit/Write | Project metadata (1st Read), patterns (1st Edit), checklist (new dir), security findings |
| `experience_injector.py` | PreToolUse Edit/Write | Past experience entries (60% embedding + 40% keyword scoring) |
| `memory_injector.py` | PreToolUse Edit/Write | Relevant `.claude/memory/` files |
| `dcc_feedback.py` | PostToolUse Edit/Write | Smell deltas, security cache summary |
| `rules_checker.py` | PostToolUse Edit/Write | Language-specific rule violations |
| `experience_recorder.py` | PostToolUse Bash (git commit) | Records experience + trend summary |
| `graph_enforcer.py` | PreToolUse | Workflow phase enforcement (blocked tools) |
| `workflow_enforcer.py` | PreToolUse | Workflow state enforcement |
| `workflow_post_traverse.py` | PostToolUse | Post-traverse actions |

### Smart Context Timing
- Uses a session state file (`.smart_context_state.json`) to avoid repeating injections
- Session resets after 30 min inactivity
- Security findings have 10 min cooldown per file
- All hooks read pre-computed caches -- no MCP/Ollama calls in hooks

## Behavioral Rules (`.claude/rules/`)

8 core rules bundled to all projects via `setupProjectDefaults()`:
1. `autonomous-strategy.md` -- When to use direct/plan/workflow
2. `workflow-discipline.md` -- Respect phases, DCC gates
3. `subagent-delegation.md` -- When/how to delegate
4. `quality-feedback.md` -- DCC smells, experience memory
5. `commit-discipline.md` -- Conventional commits with Why: body
6. `execution-philosophy.md` -- Max parallelization, bias toward action
7. `sprint-execution.md` -- Wave-based execution with dependency analysis
8. `security-awareness.md` -- Check risk before editing, parameterized queries

Plus language-specific rules (`typescript.md`, `rust.md`, `python.md`, etc.) and domain rules (`ui.md`, `ux.md`, `devops.md`, `qa.md`).

## Service Architecture

### DCC Services (`src/services/dcc/`)
| File | Purpose |
|------|---------|
| `_dccInternal.ts` | DCC MCP client bridge (Rust -> JSON-RPC) |
| `dccIndexService.ts` | Codebase indexing triggers |
| `dccAnalysisService.ts` | Analysis tool wrappers |
| `dccServerService.ts` | DCC process lifecycle |
| `dccInstallService.ts` | DCC installation/updates |
| `dccClaudeMdService.ts` | CLAUDE.md generation from DCC data |
| `dccVisualizationService.ts` | HTML visualization generation |
| `dccTypes.ts` | Shared type definitions |

### Workflow Services (`src/services/workflow/`)
| File | Purpose |
|------|---------|
| `index.ts` | Re-exports (always import from here) |
| `workflowGraphService.ts` | Graph state, activation, reset, enforcer |
| `workflowIOService.ts` | File read/write for `.workflow-manager/` state |
| `workflowNodeService.ts` | Individual node logic |

## Build

```bash
# Dev (host)
pnpm dev

# Production (ALWAYS from distrobox)
distrobox enter agentcockpit-build -- bash -c "cd /var/home/rixmerz/agentcockpit && pnpm tauri build 2>&1"

# Frontend only
pnpm build

# Tests
pnpm test                                     # Frontend (vitest)
cd .workflow-manager && python -m pytest       # Python
cargo test                                     # Rust (from distrobox)
```

Binary output: `src-tauri/target/release/agentcockpit`
Release profile: LTO enabled, single codegen unit, symbols stripped.

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `src/contexts/AppContext.tsx` | Global state, reducers, actions |
| `src/layouts/AppShell.tsx` | App shell, service lifecycle |
| `src/layouts/MainContent.tsx` | Terminal rendering (all projects, display:none for inactive) |
| `src/components/terminal/TerminalView.tsx` | xterm.js + PTY connection |
| `src/hooks/usePty.ts` | PTY spawn/write/resize, snapshot throttle |
| `src/services/hookService.ts` | Bundled rules/hooks/commands installation |
| `src/services/dcc/_dccInternal.ts` | DCC MCP client bridge |
| `src-tauri/src/lib.rs` | Tauri commands, DCC process management |
| `src-tauri/src/pty.rs` | PTY lifecycle management |
| `.workflow-manager/src/workflow_manager/tools/graph_core.py` | Workflow traverse, DAG tools |
| `.workflow-manager/src/workflow_manager/dcc_integration.py` | DCC analysis, smart filtering, tension gates |
| `.claude/hooks/smart_context.py` | Intelligent context injection (session-aware) |
