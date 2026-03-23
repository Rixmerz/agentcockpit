"""Graph management tools: graph_list_available, graph_activate, graph_visualize,
graph_timeline, graph_validate, graph_override_max_visits.
"""

import json
import subprocess
import sys

from ..session import resolve_project_dir
from ..hub_config import get_workflows_library_dir, load_enforcer_config
from ..graph_engine import Graph, GraphState, generate_mermaid
from ..graph_parser import load_graph_from_file, GraphParseError
from ..graph_state import (
    load_graph_state, initialize_graph_state,
    get_graph_file,
)
from ..dcc_integration import (
    _is_dcc_available, _execute_dcc_tool, _extract_tensions,
    _resolve_dcc_config, _run_dcc_analysis,
)


def _load_active_graph(project_dir: str) -> tuple[Graph, GraphState]:
    """Load active graph and state for a project."""
    graph_file = get_graph_file(project_dir)
    if not graph_file.exists():
        raise ValueError(f"No graph.yaml found at {graph_file}")

    graph = load_graph_from_file(graph_file)
    state = load_graph_state(project_dir)

    if not state.current_nodes:
        graph_name = graph.metadata.get('name', 'unnamed')
        state = initialize_graph_state(project_dir, graph, graph_name)

    return graph, state


def register_graph_management_tools(mcp):

    @mcp.tool()
    def graph_list_available(project_dir: str | None = None, session_id: str | None = None) -> dict:
        # readOnlyHint: True
        """List all available graphs in the project's workflows library.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        workflows_dir = get_workflows_library_dir(resolved_dir)

        if not workflows_dir.exists():
            return {
                "success": False,
                "session_id": sid,
                "message": f"Workflows directory not found: {workflows_dir}",
                "graphs": [],
                "project_dir": resolved_dir
            }

        graphs = []

        # Look for graph.yaml files (v2 format)
        for yaml_file in workflows_dir.glob("*-graph.yaml"):
            graph_name = yaml_file.stem
            try:
                content = yaml_file.read_text()
                name = graph_name
                description = ""
                version = ""
                for line in content.split('\n'):
                    stripped = line.strip()
                    if stripped.startswith('name:'):
                        name = stripped.split(':', 1)[1].strip().strip('"').strip("'")
                    elif stripped.startswith('description:'):
                        description = stripped.split(':', 1)[1].strip().strip('"').strip("'")
                    elif stripped.startswith('version:'):
                        version = stripped.split(':', 1)[1].strip().strip('"').strip("'")
                graphs.append({
                    "id": graph_name,
                    "name": name,
                    "description": description,
                    "version": version,
                    "file": str(yaml_file),
                    "type": "graph"
                })
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to parse graph YAML '{yaml_file}': {e}", file=sys.stderr)
                graphs.append({
                    "id": graph_name,
                    "name": graph_name,
                    "file": str(yaml_file),
                    "type": "graph"
                })

        return {
            "success": True,
            "session_id": sid,
            "graphs": graphs,
            "total": len(graphs),
            "project_dir": resolved_dir
        }

    @mcp.tool()
    async def graph_activate(
        graph_name: str,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: True (replaces active graph)
        """Activate a graph from the workflows library.

        Copies the graph YAML to graph.yaml and initializes state.
        Runs a DCC baseline analysis on the start node if DCC is configured.

        Args:
            graph_name: Name of the graph file (without -graph.yaml extension)
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        workflows_dir = get_workflows_library_dir(resolved_dir)

        # Try both naming conventions
        graph_file = workflows_dir / f"{graph_name}-graph.yaml"
        if not graph_file.exists():
            graph_file = workflows_dir / f"{graph_name}.yaml"

        if not graph_file.exists():
            available = [f.stem for f in workflows_dir.glob("*-graph.yaml")] if workflows_dir.exists() else []
            return {
                "success": False,
                "session_id": sid,
                "message": f"Graph '{graph_name}' not found",
                "available_graphs": available,
                "project_dir": resolved_dir
            }

        # Parse to validate
        try:
            graph = load_graph_from_file(graph_file)
        except GraphParseError as e:
            return {
                "success": False,
                "session_id": sid,
                "message": f"Invalid graph: {e}",
                "project_dir": resolved_dir
            }

        # Copy to active graph.yaml
        target_file = get_graph_file(resolved_dir)
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_text(graph_file.read_text())

        # Initialize state
        state = initialize_graph_state(resolved_dir, graph, graph_name)
        start_node = graph.get_start_node()

        # Run DCC baseline analysis on start node (non-fatal if DCC unavailable)
        dcc_baseline = None
        try:
            enforcer_config = load_enforcer_config(resolved_dir)
            should_run, analyses, token_budget = _resolve_dcc_config(start_node, enforcer_config)
            if should_run:
                dcc_result, _ = await _run_dcc_analysis(analyses, token_budget, resolved_dir)
                dcc_baseline = dcc_result
        except Exception as e:
            print(f"[workflow-manager] DCC baseline on activate failed (non-fatal): {e}", file=sys.stderr)

        return {
            "success": True,
            "session_id": sid,
            "message": f"Graph '{graph_name}' activated",
            "graph_name": graph.metadata.get('name', graph_name),
            "node_count": len(graph.nodes),
            "edge_count": len(graph.edges),
            "current_node": {
                "id": start_node.id if start_node else None,
                "name": start_node.name if start_node else None
            },
            "prompt_injection": start_node.prompt_injection if start_node else None,
            "dcc_baseline": dcc_baseline,
            "project_dir": resolved_dir
        }

    @mcp.tool()
    def graph_visualize(project_dir: str | None = None, session_id: str | None = None) -> dict:
        # readOnlyHint: True
        """Generate Mermaid diagram of the graph.

        Returns a Mermaid flowchart that can be rendered in markdown.
        Current node is highlighted in green.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        mermaid = generate_mermaid(graph, state)

        return {
            "success": True,
            "session_id": sid,
            "graph_name": state.active_graph or graph.metadata.get('name', 'unnamed'),
            "mermaid": mermaid,
            "hint": "Render this in a markdown code block with ```mermaid",
            "project_dir": resolved_dir
        }

    @mcp.tool()
    async def graph_timeline(
        since: str | None = None,
        limit: int = 50,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # readOnlyHint: True
        """Get a unified timeline of workflow transitions, DCC tensions, and git commits.

        Correlates three data sources into a single chronological view:
        - Workflow transitions (from execution_path in graph state)
        - DCC tensions and smells (from DeltaCodeCube)
        - Git commits (from git log)

        Args:
            since: ISO timestamp to filter events from (default: workflow start)
            limit: Maximum number of events to return (default: 50)
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        events = []

        # 1. Workflow transitions from execution_path
        for entry in state.execution_path:
            ts = entry.timestamp if hasattr(entry, 'timestamp') else entry.get("timestamp", "")
            from_node = entry.from_node if hasattr(entry, 'from_node') else entry.get("from_node")
            to_node = entry.to_node if hasattr(entry, 'to_node') else entry.get("to_node", "?")
            reason = entry.reason if hasattr(entry, 'reason') else entry.get("reason", "")
            edge_id_val = entry.edge_id if hasattr(entry, 'edge_id') else entry.get("edge_id")

            if since and ts < since:
                continue

            to_name = graph.nodes[to_node].name if to_node in graph.nodes else to_node
            events.append({
                "type": "transition",
                "timestamp": ts,
                "description": f"-> {to_name}" + (f" ({reason})" if reason else ""),
                "from_node": from_node,
                "to_node": to_node,
                "edge_id": edge_id_val,
            })

        # 2. Git commits
        since_flag = f"--since={since}" if since else "--since=7 days ago"
        try:
            git_result = subprocess.run(
                ["git", "log", since_flag, "--format=%H|%aI|%s", f"--max-count={limit}"],
                cwd=resolved_dir, capture_output=True, text=True, timeout=10
            )
            for line in git_result.stdout.strip().split("\n"):
                if not line or "|" not in line:
                    continue
                parts = line.split("|", 2)
                if len(parts) < 3:
                    continue
                commit_hash, ts, message = parts

                # Get changed files for this commit
                diff_result = subprocess.run(
                    ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit_hash],
                    cwd=resolved_dir, capture_output=True, text=True, timeout=10
                )
                files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]

                events.append({
                    "type": "commit",
                    "timestamp": ts,
                    "description": message,
                    "commit": commit_hash[:8],
                    "files": files[:10],
                })
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to parse git log for timeline: {e}", file=sys.stderr)
            pass

        # 3. DCC tensions (if available)
        if _is_dcc_available():
            try:
                raw_tensions = await _execute_dcc_tool("cube_get_tensions", {"limit": limit}, resolved_dir)
                tensions = _extract_tensions(raw_tensions)
                for t in tensions:
                    ts = t.get("detected_at", t.get("timestamp", t.get("created_at", "")))
                    if since and ts and ts < since:
                        continue
                    events.append({
                        "type": "tension",
                        "timestamp": ts or "",
                        "severity": t.get("severity", "unknown"),
                        "description": t.get("description", t.get("message", t.get("type", "tension")))[:200],
                        "source": t.get("source", t.get("file", "?")),
                        "target": t.get("target", t.get("related_file")),
                        "status": t.get("status", "detected"),
                    })

                # Also get smells
                raw_smells = await _execute_dcc_tool("cube_detect_smells", {"summary_only": False, "limit": 20}, resolved_dir)
                if raw_smells:
                    smell_content = raw_smells
                    if isinstance(raw_smells, dict) and "content" in raw_smells:
                        for item in raw_smells["content"]:
                            if item.get("type") == "text":
                                try:
                                    smell_content = json.loads(item["text"])
                                except Exception as e:
                                    print(f"[workflow-manager] Warning: failed to parse smell JSON: {e}", file=sys.stderr)
                                    smell_content = raw_smells
                                break

                    smells_list = []
                    if isinstance(smell_content, dict):
                        smells_list = smell_content.get("smells", [])
                    elif isinstance(smell_content, list):
                        smells_list = smell_content

                    for s in smells_list[:20]:
                        ts = s.get("detected_at", s.get("timestamp", ""))
                        if since and ts and ts < since:
                            continue
                        events.append({
                            "type": "smell",
                            "timestamp": ts or "",
                            "severity": s.get("severity", "unknown"),
                            "description": s.get("description", s.get("smell_type", s.get("type", "smell")))[:200],
                            "file": s.get("file", s.get("source", "?")),
                        })
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to collect DCC timeline events: {e}", file=sys.stderr)
                pass

        # Sort by timestamp (events without timestamps go last)
        events.sort(key=lambda e: e.get("timestamp") or "9999", reverse=False)

        return {
            "success": True,
            "session_id": sid,
            "total_events": len(events),
            "events": events[:limit],
            "event_counts": {
                "transitions": sum(1 for e in events if e["type"] == "transition"),
                "commits": sum(1 for e in events if e["type"] == "commit"),
                "tensions": sum(1 for e in events if e["type"] == "tension"),
                "smells": sum(1 for e in events if e["type"] == "smell"),
            },
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def graph_validate(project_dir: str | None = None, session_id: str | None = None) -> dict:
        # readOnlyHint: True
        """Validate the current graph structure.

        Checks for orphan nodes, missing references, and other structural issues.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        graph_file = get_graph_file(resolved_dir)
        if not graph_file.exists():
            return {
                "valid": False,
                "session_id": sid,
                "message": "No graph.yaml found",
                "project_dir": resolved_dir
            }

        try:
            graph = load_graph_from_file(graph_file)
        except GraphParseError as e:
            return {
                "valid": False,
                "session_id": sid,
                "errors": [str(e)],
                "project_dir": resolved_dir
            }

        errors = graph.validate()

        return {
            "valid": len(errors) == 0,
            "session_id": sid,
            "graph_name": graph.metadata.get('name', 'unnamed'),
            "node_count": len(graph.nodes),
            "edge_count": len(graph.edges),
            "errors": errors if errors else None,
            "project_dir": resolved_dir
        }

    @mcp.tool()
    def graph_override_max_visits(
        node_id: str,
        new_max: int,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: True (modifies visit limits)
        """Override max_visits for a specific node (escape hatch for loops).

        Use this when you need to exceed a node's visit limit for legitimate reasons.
        The override only affects the in-memory graph state for this session.

        Args:
            node_id: ID of the node to override
            new_max: New maximum visits (must be > current visits)
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        if node_id not in graph.nodes:
            return {
                "error": True,
                "session_id": sid,
                "message": f"Node '{node_id}' not found",
                "project_dir": resolved_dir
            }

        current_visits = state.get_visit_count(node_id)
        if new_max <= current_visits:
            return {
                "error": True,
                "session_id": sid,
                "message": f"new_max ({new_max}) must be greater than current visits ({current_visits})",
                "project_dir": resolved_dir
            }

        # Update the node's max_visits (in-memory only - doesn't persist to YAML)
        graph.nodes[node_id].max_visits = new_max

        return {
            "success": True,
            "session_id": sid,
            "message": f"Node '{node_id}' max_visits updated to {new_max}",
            "node_id": node_id,
            "current_visits": current_visits,
            "new_max_visits": new_max,
            "warning": "This override is in-memory only and will reset when graph is reloaded",
            "project_dir": resolved_dir
        }
