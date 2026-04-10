# AgentCockpit Runtime Context

> Always use these AgentCockpit capabilities when working within this project.

This project is managed by AgentCockpit. You have access to a workflow-manager MCP server with capabilities beyond standard Claude Code.

## MCP Proxy — Discover & Use Any Tool
- `search_tools(query)` — semantic search across ALL configured MCP servers. Learns from your selections over time.
- `execute_mcp_tool(mcp_name, tool_name, arguments)` — execute any tool from any MCP server. The workflow manager maintains a connection pool to all configured MCPs.
- Use these when you need a capability not in your direct tool list — search first, then execute.

## Workflow Graphs — Structured Multi-Phase Execution
- `graph_list_available` — list existing workflow definitions (debug, feature-dev, etc.)
- `graph_builder_create` — create new workflow graphs interactively
- `graph_activate(graph_id)` — start a workflow
- `graph_traverse` — advance to the next phase (returns context injections, experience memory, and skill recommendations)

### Node Enforcement
Workflow nodes can enforce behavior:
- **`tools_blocked`** — block specific tools (e.g., Edit/Write) until a phase completes
- **`mcps_enabled`** — restrict which MCPs are available per phase (e.g., only sequential-thinking in analysis, only Context7 in research)
- **`tension_gate`** — block advancement until DCC quality issues are resolved
- **DAG tasks** — inter-task dependencies within a node; `graph_get_ready_tasks` returns only unblocked tasks
- **`prompt_injection`** — each node injects phase-specific instructions into your context

## Experience Memory — Cross-Project Learning
- `experience_query(file_path)` — find relevant patterns and past issues for files you're about to modify
- `experience_derive_checklist(task_type)` — generate implementation checklists from accumulated patterns
- `experience_record(type, file_path, description)` — manually save insights for future reference

## DCC (DeltaCodeCube) — Code Quality Analysis
- Auto-injected during workflow transitions (configurable per node)
- `graph_mid_phase_dcc(files=[...])` — get quality feedback mid-phase without advancing
- Detects: god files, circular dependencies, hub overload, code smells, security findings
- Tension gates use DCC as real quality gates — they block, not just warn

## Pattern Catalog & Metadata
- `pattern_catalog_get` — discover project patterns (repositories, handlers, entities, tests)
- `project_metadata_get` — cached project info (tech stack, bounded contexts, ID patterns, migration numbers)

## Trend Tracking
- `trend_record_snapshot` / `trend_get_summary` — track quality metrics over time
