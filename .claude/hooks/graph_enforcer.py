#!/usr/bin/env python3
"""Graph Enforcer Hook — hard-blocks tools listed in current node's tools_blocked.

PreToolUse hook for Claude Code. Reads the active graph workflow state
(graph_state.json) and graph definition (graph.yaml) to enforce tool
restrictions per node. Fail-safe: approves on any error.

Replaces legacy workflow_enforcer.py which read steps.yaml/state.json.
"""

import json
import sys
import os
from pathlib import Path


def parse_tools_blocked(content):
    """Extract node_id -> tools_blocked mapping from graph YAML.

    Minimal parser (~25 lines). Only extracts 'id' and 'tools_blocked'
    fields from the nodes section. Stops at 'edges:' section.
    """
    mapping = {}
    node_id = None
    collecting = False

    for line in content.splitlines():
        stripped = line.strip()

        if not stripped or stripped.startswith("#"):
            continue

        # Stop at edges section — we only care about nodes
        if stripped == "edges:" or stripped == "edges":
            break

        # New node entry
        if stripped.startswith("- id:"):
            node_id = stripped.split(":", 1)[1].strip().strip('"').strip("'")
            mapping[node_id] = []
            collecting = False
            continue

        if node_id is None:
            continue

        # tools_blocked key (block list form)
        if stripped.startswith("tools_blocked:"):
            val = stripped.split(":", 1)[1].strip()
            if not val:  # List follows on next lines
                collecting = True
            continue

        # List item under tools_blocked
        if collecting and stripped.startswith("- "):
            mapping[node_id].append(stripped[2:].strip().strip('"').strip("'"))
            continue

        # Any other key ends tools_blocked collection
        if collecting and ":" in stripped:
            collecting = False

    return mapping


def get_state_path(project_dir):
    """Resolve graph_state.json path (hub-centralized or local fallback).

    Hub pattern: {hub_dir}/{states_dir}/{project_name}/graph_state.json
    Local fallback: {project}/.claude/workflow/graph_state.json
    """
    config_file = Path.home() / ".agentcockpit" / "config.json"
    if config_file.exists():
        try:
            config = json.loads(config_file.read_text())
            hub_dir = config.get("hub_dir")
            if hub_dir:
                states_dir = config.get("states_dir", ".agentcockpit/states")
                project_name = Path(project_dir).name
                return Path(hub_dir) / states_dir / project_name / "graph_state.json"
        except Exception:
            pass
    return Path(project_dir) / ".claude" / "workflow" / "graph_state.json"


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(json.dumps({"decision": "approve"}))
        return

    tool_name = hook_input.get("tool_name", "")
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        print(json.dumps({"decision": "approve"}))
        return

    try:
        # 1. Read graph state (centralized hub or local)
        state_path = get_state_path(project_dir)
        if not state_path.exists():
            print(json.dumps({"decision": "approve"}))
            return

        state = json.loads(state_path.read_text())
        active_graph = state.get("active_graph")
        current_nodes = state.get("current_nodes", [])

        if not active_graph or not current_nodes:
            print(json.dumps({"decision": "approve"}))
            return

        # Check enforcer_enabled flag (written by the UI toggle)
        config_path = state_path.parent / "config.json"
        if config_path.exists():
            cfg = json.loads(config_path.read_text())
            if not cfg.get("enforcer_enabled", True):
                print(json.dumps({"decision": "approve"}))
                return

        current_node = current_nodes[0]

        # 2. Read graph YAML (always local to project)
        graph_file = Path(project_dir) / ".claude" / "workflow" / "graph.yaml"
        if not graph_file.exists():
            print(json.dumps({"decision": "approve"}))
            return

        blocked_map = parse_tools_blocked(graph_file.read_text())
        tools_blocked = blocked_map.get(current_node, [])

        # 3. Check if tool is blocked ("*" = block everything)
        if "*" in tools_blocked or tool_name in tools_blocked:
            print(json.dumps({
                "decision": "block",
                "message": (
                    f"[Graph Enforcer] Tool '{tool_name}' is blocked at node "
                    f"'{current_node}' (workflow: {active_graph}). "
                    f"Advance the workflow to use this tool."
                )
            }))
            return

    except Exception:
        pass  # Fail-safe: approve on any error

    print(json.dumps({"decision": "approve"}))


if __name__ == "__main__":
    main()
