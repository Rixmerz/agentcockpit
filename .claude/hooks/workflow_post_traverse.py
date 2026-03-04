#!/usr/bin/env python3
"""Workflow Post-Traverse Hook — PostToolUse for graph_traverse.

Fires after every graph_traverse MCP call and does 3 things:
1. Signals the Tauri frontend to re-run DCC reindex (updates ControlBar badge)
2. Records experience data from DCC analysis into experience_memory.json
3. Prints a brief summary to stderr so the agent sees the new node

Protocol:
  stdin:  {"tool_name": "mcp__workflow-manager__graph_traverse", "tool_result": {...}}
  env:    CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}   (PostToolUse hooks always approve)
  stderr: summary info
  exit 0: always

Debug bridge: http://127.0.0.1:19876/invoke (DEV mode only, fails silently)
"""

import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

_APPROVE = json.dumps({"decision": "approve"})
_DEBUG_BRIDGE_URL = "http://127.0.0.1:19876/invoke"
_EXPERIENCE_TIMEOUT = 2   # seconds for debug bridge call
_BRIDGE_TIMEOUT = 3       # seconds


def _signal_frontend_reindex(project_path: str) -> bool:
    """Call the Tauri debug bridge to trigger frontend DCC reindex.
    Returns True on success, False if bridge unavailable (DEV mode only)."""
    payload = json.dumps({
        "action": "dcc.reindexProject",
        "params": {"projectPath": project_path}
    }).encode()
    req = urllib.request.Request(
        _DEBUG_BRIDGE_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=_BRIDGE_TIMEOUT) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False  # Bridge not available (production build or DEV not running)


def _record_experience(result: dict, project_path: str) -> None:
    """Persist experience entry from graph_traverse result into experience_memory.json."""
    # Extract DCC analysis if present
    dcc_analysis = result.get("dcc_analysis")
    if not dcc_analysis:
        return

    from_node = result.get("from_node", "")
    to_node = result.get("to_node", "")
    edge_id = result.get("traversed_edge", "")
    reason = result.get("reason", "")
    impact = result.get("impact_preview", {})

    # Build a concise experience entry
    smells_summary = ""
    if isinstance(dcc_analysis, dict):
        smells_summary = dcc_analysis.get("smells", "")

    if not smells_summary and not impact:
        return  # No useful data to record

    project_name = Path(project_path).name
    wm_dir = Path.home() / ".workflow-manager"
    proj_mem_dir = wm_dir / "project_memories" / project_name
    proj_mem_dir.mkdir(parents=True, exist_ok=True)
    mem_file = proj_mem_dir / "experience_memory.json"

    # Load existing
    existing: dict = {"entries": []}
    if mem_file.exists():
        try:
            existing = json.loads(mem_file.read_text())
        except Exception:
            existing = {"entries": []}

    # Append new entry
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
        "keywords": [to_node.replace("-", " ")] if to_node else [],
        "domain": "workflow",
        "description": f"Transitioned {from_node} → {to_node}: {smells_summary[:80]}",
        "resolution": f"Edge: {edge_id}. Reason: {reason[:100]}",
        "confidence": 0.6,
        "occurrences": 1,
    }

    entries: list = existing.get("entries", [])
    entries.append(entry)

    # Cap to last 200 entries
    existing["entries"] = entries[-200:]
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

    tool_name = hook_input.get("tool_name", "")
    if "graph_traverse" not in tool_name:
        print(_APPROVE)
        return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        print(_APPROVE)
        return

    # Get tool result
    tool_result = hook_input.get("tool_result", {})
    if not isinstance(tool_result, dict):
        # Try parsing if it's a JSON string
        if isinstance(tool_result, str):
            try:
                tool_result = json.loads(tool_result)
            except Exception:
                tool_result = {}

    new_node = tool_result.get("to_node") or tool_result.get("new_node", {})
    if isinstance(new_node, dict):
        new_node = new_node.get("id", "")

    from_node = tool_result.get("from_node", "")

    # 1. Signal frontend to update DCC badge
    bridge_ok = _signal_frontend_reindex(project_dir)

    # 2. Record experience from DCC analysis
    try:
        _record_experience(tool_result, project_dir)
    except Exception:
        pass

    # 3. Print summary to stderr
    summary_parts = []
    if from_node and new_node:
        summary_parts.append(f"⚡ Traverse: {from_node} → {new_node}")
    if bridge_ok:
        summary_parts.append("DCC badge update triggered")
    else:
        summary_parts.append("DCC bridge unavailable (DEV mode only)")

    if summary_parts:
        print(" | ".join(summary_parts), file=sys.stderr)

    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(_APPROVE)
