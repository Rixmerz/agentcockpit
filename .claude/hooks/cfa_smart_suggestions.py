#!/usr/bin/env python3
"""
CFA Smart Suggestions - Intelligent Hook for Predictive Recommendations

This module analyzes session patterns and suggests/auto-executes necessary tools:
- Detects when kg.build is needed (after X edits)
- Detects when contract.check_breaking is needed (after function changes)
- Suggests memory.set for learnings
- Auto-executes safe operations
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

STATE_FILE = Path.home() / ".claude" / "cfa_session_state.json"


def load_state() -> Dict[str, Any]:
    """Load current session state."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except:
            pass
    return {
        "session_id": None,
        "project_path": None,
        "onboarding_done": False,
        "kg_retrieve_done": False,
        "files_modified": [],
        "functions_modified": [],
        "kg_build_pending": False,
        "kg_builds_this_session": 0,
        "contract_checks_this_session": 0,
        "edits_since_last_kg_build": 0,
        "breaking_changes_checked": False,
        "last_kg_build_time": None,
        "suggestions_made": [],
        "last_activity": None
    }


def save_state(state: Dict[str, Any]) -> None:
    """Save session state."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    state["last_activity"] = datetime.now().isoformat()
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def is_cfa_project(project_path: str) -> bool:
    """Check if the current project uses CFA."""
    cfa_markers = [
        Path(project_path) / ".claude" / "settings.json",
        Path(project_path) / ".claude" / "knowledge_graph.db",
    ]
    return any(m.exists() for m in cfa_markers)


def detect_suggestions(data: Dict[str, Any], state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Analyze session state and detect what tools should be suggested/auto-executed.

    Returns list of suggestions with: tool, reason, auto_executable, priority
    """
    suggestions = []
    cwd = data.get("cwd", os.getcwd())

    if not is_cfa_project(cwd):
        return suggestions

    # Get current metrics
    edits_total = len(state.get("files_modified", []))
    edits_since_kg_build = state.get("edits_since_last_kg_build", 0)
    functions_modified = state.get("functions_modified", [])
    breaking_changes_checked = state.get("breaking_changes_checked", False)

    # RULE 1: After 3+ edits, suggest kg.build
    if edits_since_kg_build >= 3:
        suggestions.append({
            "tool": "kg.build",
            "reason": f"Made {edits_since_kg_build} edits since last kg.build",
            "priority": "high",
            "auto_executable": True,
            "command": 'kg.build(project_path=".", incremental=true)'
        })

    # RULE 2: If functions modified, require contract.check_breaking
    if functions_modified and not breaking_changes_checked:
        func_names = ", ".join(functions_modified[:3])  # Show first 3
        suggestions.append({
            "tool": "contract.check_breaking",
            "reason": f"Modified function(s): {func_names}",
            "priority": "critical",
            "auto_executable": False,  # Requires analysis
            "command": f'contract.check_breaking(project_path=".", symbol="{functions_modified[0]}")',
            "block_until_done": True
        })

    # RULE 3: After significant changes, suggest memory.set
    if edits_total >= 5 and state.get("kg_retrieve_done"):
        suggestions.append({
            "tool": "memory.set",
            "reason": f"Completed significant work: {edits_total} files modified",
            "priority": "medium",
            "auto_executable": False,  # User provides learning content
            "hint": "Store what you learned about this feature/pattern"
        })

    # RULE 4: Detect risky patterns
    if edits_total >= 10 and state.get("kg_builds_this_session", 0) == 0:
        suggestions.append({
            "tool": "safe_point.create",
            "reason": "Made 10+ edits without checkpoint - consider safe point",
            "priority": "medium",
            "auto_executable": False,
            "command": 'safe_point.create(project_path=".", task_summary="...")'
        })

    # Store suggestions in state
    state["suggestions_pending"] = [s["tool"] for s in suggestions]
    save_state(state)

    return suggestions


def format_suggestions_message(suggestions: List[Dict[str, Any]]) -> str:
    """Format suggestions as a readable system message."""
    if not suggestions:
        return ""

    # Separate by priority
    critical = [s for s in suggestions if s.get("priority") == "critical"]
    high = [s for s in suggestions if s.get("priority") == "high"]
    medium = [s for s in suggestions if s.get("priority") == "medium"]

    message = "\n## 💡 CFA Smart Suggestions\n\n"

    if critical:
        message += "### 🔴 CRITICAL (Must do before continuing):\n"
        for s in critical:
            message += f"- **{s['tool']}** - {s['reason']}\n"
            if "command" in s:
                message += f"  ```\n  {s['command']}\n  ```\n"
        message += "\n"

    if high:
        message += "### 🟠 HIGH PRIORITY:\n"
        for s in high:
            message += f"- **{s['tool']}** - {s['reason']}\n"
            if s.get("auto_executable"):
                message += "  *(Can auto-execute)*\n"
            elif "command" in s:
                message += f"  ```\n  {s['command']}\n  ```\n"
        message += "\n"

    if medium:
        message += "### 🟡 MEDIUM PRIORITY:\n"
        for s in medium:
            message += f"- **{s['tool']}** - {s['reason']}\n"
            if "hint" in s:
                message += f"  *Hint: {s['hint']}*\n"
        message += "\n"

    return message


def output_decision(decision: str, reason: str, system_message: str = None) -> None:
    """Output structured decision for Claude Code."""
    output = {
        "decision": decision,
        "reason": reason,
        "continue": True
    }
    if system_message:
        output["systemMessage"] = system_message
    print(json.dumps(output))


def handle_smart_suggestions(data: Dict[str, Any]) -> int:
    """
    Main handler for smart suggestions.

    Called after Edit/Write to suggest next steps.
    """
    state = load_state()
    cwd = data.get("cwd", os.getcwd())

    if not is_cfa_project(cwd):
        return 0

    # Detect what's needed
    suggestions = detect_suggestions(data, state)

    if not suggestions:
        return 0

    # Check for blocking suggestions
    blocking = [s for s in suggestions if s.get("block_until_done")]

    # Format message
    message = format_suggestions_message(suggestions)

    if blocking:
        # Block and require critical action
        output_decision(
            "block",
            f"Critical: {blocking[0]['reason']}",
            message + "\n**Please complete critical items before continuing.**"
        )
        return 2
    else:
        # Suggest without blocking
        output_decision(
            "approve",
            f"Suggestions available ({len(suggestions)} items)",
            message
        )
        return 0


def main():
    """Main entry point."""
    try:
        data = json.load(sys.stdin)
        event = data.get("hook_event_name", "")
        tool_name = data.get("tool_name", "")

        # Only trigger after Edit/Write operations
        if event == "PostToolUse" and tool_name in ("Edit", "Write"):
            return handle_smart_suggestions(data)

        return 0

    except Exception as e:
        print(f"CFA Smart Suggestions Error: {e}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
