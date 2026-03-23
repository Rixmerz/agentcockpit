<div align="center">

# AgentCockpit

**Intelligent Development Environment for AI-Assisted Coding**

A desktop application that enhances Claude Code, Cursor, and other AI coding tools with continuous quality feedback, experiential memory, and workflow enforcement.

Built with React 19 + Tauri v2 + Rust + TypeScript

</div>

---

## Overview

AgentCockpit is a desktop IDE wrapper that adds an intelligent middleware layer between you and your AI coding assistant. Instead of treating AI tools as black-box text generators, AgentCockpit instruments every edit with real-time quality analysis, injects lessons learned from past mistakes, and enforces structured workflows so that AI agents don't skip critical steps.

**What it does:**

- **Continuous code quality feedback** via DeltaCodeCube — not just at commit time, but after every file edit
- **Experiential memory** that auto-captures lessons from your git commits and injects them into future sessions across projects
- **Workflow enforcement** with graph-based pipelines that gate phase transitions on quality metrics
- **Semantic code embeddings** via local Ollama for cross-language similarity search
- **Native file watching** (inotify) for real-time change detection with a 2.5s feedback loop
- **Specialized subagents** that can be deployed per-project based on tech stack
- **Multiplexed PTY terminals** with xterm.js, session persistence, and snapshot versioning

---

## Key Features

| Feature | Description | Technology |
|---------|-------------|------------|
| **Terminal Management** | Multiplexed PTY terminals with session persistence and notification sounds | Rust portable-pty + xterm.js 6 |
| **Workflow System** | Graph-based pipelines with enforcer hooks, phase control, DCC integration | Python MCP + YAML workflows |
| **DeltaCodeCube** | 35+ MCP tools for code quality: smells, tensions, debt, clones, graph analysis | Python + SQLite + numpy |
| **Semantic Embeddings** | 768D neural embeddings for code similarity search | Local Ollama (nomic-embed-text) |
| **Experience Memory** | Auto-captures lessons from git commits, semantic search across projects | Python + SQLite + Ollama |
| **File Watcher** | Native inotify-based change detection, 2.5s feedback loop | Rust notify crate |
| **DCC Auto-Injection** | PostToolUse hooks inject quality feedback after every Edit/Write | Python hooks |
| **Rules Checker** | Language-specific code quality rules for 8+ languages | Python regex hooks |
| **Subagent System** | 25 specialized agents deployable per-project via MCP | Claude Code agents |
| **Skills Library** | 33 skill domains with 112 markdown files covering language patterns and tools | Claude Code skills |
| **Snapshot System** | Git-based versioned snapshots on terminal commands | Git tags |
| **Browser Panel** | Embedded Tauri child webview for web preview | Tauri v2 webview |

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    AgentCockpit                       │
├──────────────┬───────────────┬───────────────────────┤
│   Frontend   │  Rust Backend │   Python Services     │
│   React 19   │  Tauri v2     │                       │
│   TypeScript │  PTY Manager  │   Workflow Manager    │
│   xterm.js 6 │  File Watcher │   (MCP Server)        │
│   Zustand    │  DCC Client   │                       │
│              │  Browser View │   DeltaCodeCube       │
│              │               │   (MCP Server)        │
│              │               │                       │
│              │               │   Ollama              │
│              │               │   (Podman container)  │
└──────────────┴───────────────┴───────────────────────┘
```

**Stack:**

- **Frontend:** React 19, TypeScript, Vite (rolldown), xterm.js 6, Zustand, Lucide icons
- **Backend:** Rust, Tauri v2, portable-pty, notify (file watcher)
- **Services:** Python 3.10+, FastMCP, numpy, SQLite
- **AI:** Ollama (local), nomic-embed-text (768D embeddings)
- **Build:** Cargo + pnpm, builds in distrobox on Fedora Atomic

**Layer rules:** Components never call Tauri directly — all I/O goes through the service layer. Services are organized by domain (`services/workflow/`, `services/dcc/`, etc.).

---

## Getting Started

### Prerequisites

- Rust 1.85+ with cargo
- Node.js 20+ with pnpm
- Python 3.10+ with uv
- Podman (for Ollama container)
- Linux (primary platform), macOS (partial support)

### Build from Source

```bash
git clone https://github.com/Rixmerz/agentcockpit.git
cd agentcockpit
pnpm install

# Development
pnpm dev

# Production build (use distrobox on Fedora Atomic)
distrobox enter agentcockpit-build -- bash -c "cd /var/home/rixmerz/agentcockpit && pnpm tauri build"

# Lint
pnpm lint
```

The binary is output to `src-tauri/target/release/agentcockpit`.

### Ollama Setup (Semantic Embeddings)

```bash
podman run -d --name ollama -p 11434:11434 \
  --device nvidia.com/gpu=all docker.io/ollama/ollama
podman exec ollama ollama pull nomic-embed-text
```

Ollama auto-starts when AgentCockpit opens. If not available, embeddings are skipped silently — all other features work without it.

---

## Hooks & Rules

AgentCockpit auto-installs hooks and rules in every project opened via "Create Project":

### PostToolUse Hooks (after Edit/Write)

| Hook | Purpose |
|------|---------|
| `dcc_feedback.py` | DCC delta injection — shows new smells after edits |
| `rules_checker.py` | Language-specific code quality checks (8+ languages) |
| `experience_recorder.py` | Captures lessons from git commits into experience memory |
| `lsp_status_check.py` | LSP diagnostics check |

### PreToolUse Hooks (before Edit/Write)

| Hook | Purpose |
|------|---------|
| `experience_injector.py` | Injects relevant past experiences for files being edited |
| `memory_injector.py` | Loads project-specific memory context |
| `graph_enforcer.py` | Blocks tools not allowed in current workflow phase |
| `workflow_enforcer.py` | Validates workflow state before tool execution |

### Behavioral Rules (19 total)

5 behavioral rules (`autonomous-strategy`, `workflow-discipline`, `subagent-delegation`, `quality-feedback`, `commit-discipline`) plus 14 language/domain rules for TypeScript, Python, Rust, Go, Java, and more.

---

## Workflow System

Workflows are graph-based pipelines defined in YAML. Each node specifies which tools are allowed, what context gets injected, and what quality gates must pass before advancing.

### Activating a Workflow

```bash
# Via MCP (used by AI agents)
graph_list_available       # See available workflows
graph_activate(graph_id="debug", project_dir="/path/to/project")
graph_traverse(direction="next")
graph_status               # Check current phase, DCC status, tensions
```

### Creating Custom Workflows

Place YAML files in `.claude/workflows/`. Workflows define nodes with:
- `tools_blocked` — tools the agent cannot use in this phase
- `prompt_injection` — phase-specific instructions injected into the agent
- `gate_type` — conditions for advancing (DCC quality gates, manual, etc.)

### DCC Integration

DeltaCodeCube runs a baseline analysis on workflow activation and tracks quality deltas between phases. If new code smells or architectural tensions exceed thresholds, the tension gate blocks phase advancement until issues are resolved.

---

## Project Structure

```
agentcockpit/
├── src/                            # React frontend
│   ├── components/
│   │   ├── control-bar/            # ControlBar with status dropdowns
│   │   ├── workflow/               # Workflow panel UI
│   │   ├── terminal/               # Terminal components
│   │   └── settings/               # Settings components
│   ├── hooks/                      # React hooks (git, DCC, LSP, Ollama, etc.)
│   ├── services/                   # Service layer
│   │   ├── dcc/                    # DeltaCodeCube client
│   │   ├── workflow/               # Workflow graph services
│   │   ├── fileWatcherService.ts   # Native inotify bridge
│   │   ├── hookService.ts          # Hook install/uninstall in user projects
│   │   └── ollamaService.ts        # Ollama container management
│   └── layouts/                    # AppShell, sidebars
├── src-tauri/                      # Rust backend
│   ├── src/lib.rs                  # Tauri commands, DCC client
│   ├── src/pty.rs                  # PTY multiplexer
│   └── src/file_watcher.rs         # Native file watcher (notify crate)
├── .workflow-manager/              # Python MCP server
│   └── src/workflow_manager/       # Graph engine, DCC integration, experience memory
├── .deltacodecube/                 # Code analysis engine (submodule)
│   └── src/deltacodecube/          # 35+ MCP tools, embeddings module
├── .claude/
│   ├── agents/                     # 25 specialized subagents
│   ├── skills/                     # 33 skill domains (112 markdown files)
│   ├── rules/                      # 19 rules (5 behavioral + 14 code quality)
│   ├── hooks/                      # PostToolUse + PreToolUse hooks
│   ├── commands/                   # Slash commands (/project:setup-agents)
│   └── workflows/                  # Graph-based workflow definitions
├── scripts/                        # Claude LSP setup, utilities
└── public/
    └── sounds/                     # Notification sounds
```

---

## Contributing

- Build requires distrobox on Fedora Atomic (or equivalent dev environment with system libs)
- Run `pnpm lint` before submitting PRs
- Use conventional commits (`fix:`, `feat:`, `refactor:`, etc.) with a `Why:` body
- See the architectural rules in `CLAUDE.md` — components never call Tauri directly, all I/O goes through services

---

## License

Rixmerz License (RXL) — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Tauri](https://tauri.app/) — Desktop framework
- [xterm.js](https://xtermjs.org/) — Terminal emulation
- [Ollama](https://ollama.ai/) — Local AI model serving
- [Lucide](https://lucide.dev/) — Icons
- [Mixkit](https://mixkit.co/) — Notification sounds

---

<p align="center">
  Made with care by the AgentCockpit team
</p>
