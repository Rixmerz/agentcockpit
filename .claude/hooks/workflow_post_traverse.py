#!/usr/bin/env python3
"""Workflow Post-Traverse Hook — PostToolUse for graph_traverse.

Fires after every graph_traverse MCP call and records experience data from
DCC analysis into the project experience_memory.json file. The frontend
DCC reindex is triggered internally by WorkflowPanel polling (not this hook).

Protocol:
  stdin:  {"tool_name": "mcp__workflow-manager__graph_traverse", "tool_result": {...}}
  env:    CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}
  stderr: brief transition summary
  exit 0: always
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

_APPROVE = json.dumps({"decision": "approve"})


def _record_experience(result: dict, project_path: str) -> None:
    """Persist experience entry from graph_traverse result."""
    dcc_analysis = result.get("dcc_analysis")
    from_node = result.get("from_node", "")
    to_node = result.get("to_node", "")
    edge_id = result.get("traversed_edge", "")
    reason = result.get("reason", "")
    impact = result.get("impact_preview", {})

    smells_summary = ""
    if isinstance(dcc_analysis, dict):
        smells_summary = dcc_analysis.get("smells", "")

    if not smells_summary and not impact and not from_node:
        return

    project_name = Path(project_path).name
    wm_dir = Path.home() / ".workflow-manager"
    proj_mem_dir = wm_dir / "project_memories" / project_name
    proj_mem_dir.mkdir(parents=True, exist_ok=True)
    mem_file = proj_mem_dir / "experience_memory.json"

    existing: dict = {"entries": []}
    if mem_file.exists():
        try:
            existing = json.loads(mem_file.read_text())
        except Exception:
            existing = {"entries": []}

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "workflow_transition": {
            "from": from_node,
            "to": to_node,
            "edge": edge_id,
            "reason": reason,
        },
        "dcc_smells": smells_summary,
        "impact": impact,
        "file_pattern": "*",
        "keywords": [w for w in to_node.replace("-", " ").split() if len(w) > 2],
        "domain": "workflow",
        "description": f"{from_node} → {to_node}: {smells_summary[:80]}" if smells_summary else f"{from_node} → {to_node}",
        "resolution": f"Edge: {edge_id}. Reason: {reason[:100]}",
        "confidence": 0.6,
        "occurrences": 1,
    }

    entries: list = existing.get("entries", [])
    entries.append(entry)
    existing["entries"] = entries[-200:]  # cap at 200
    existing["last_updated"] = datetime.now(timezone.utc).isoformat()

    try:
        mem_file.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
    except Exception:
        pass


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(_APPROVE)
        return

    if "graph_traverse" not in hook_input.get("tool_name", ""):
        print(_APPROVE)
        return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        print(_APPROVE)
        return

    tool_result = hook_input.get("tool_result", {})
    if isinstance(tool_result, str):
        try:
            tool_result = json.loads(tool_result)
        except Exception:
            tool_result = {}

    from_node = tool_result.get("from_node", "")
    to_node = tool_result.get("to_node", "")

    try:
        _record_experience(tool_result, project_dir)
    except Exception:
        pass

    if from_node and to_node:
        print(f"⚡ {from_node} → {to_node} (experience recorded)", file=sys.stderr)

    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(_APPROVE)
