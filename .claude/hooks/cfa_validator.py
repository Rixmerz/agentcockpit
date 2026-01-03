#!/usr/bin/env python3
"""
CFA Protocol Validator - Enforcement Hooks for Context-First Architecture v3

This module provides validation hooks that ensure agents follow the CFA protocol:
1. SessionStart: Force onboarding at session start
2. PreToolUse: Verify context was loaded before editing
3. PostToolUse: Remind to check breaking changes after edits
4. Stop: Verify documentation was updated before ending

Exit codes:
- 0: Success (allow action)
- 2: Block action (with reason in stderr)
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional

# State file location
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
        # Smart suggestions metrics
        "kg_builds_this_session": 0,
        "contract_checks_this_session": 0,
        "edits_since_last_kg_build": 0,
        "breaking_changes_checked": False,
        "last_kg_build_time": None,
        "suggestions_pending": [],
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
        Path(project_path) / "contracts",
    ]
    return any(m.exists() for m in cfa_markers)


def output_decision(decision: str, reason: str, system_message: str = None) -> None:
    """Output structured decision for Claude Code."""
    output = {
        "decision": decision,  # "approve" or "block"
        "reason": reason,
        "continue": True
    }
    if system_message:
        output["systemMessage"] = system_message
    print(json.dumps(output))


# ============================================================================
# HOOK: SessionStart
# ============================================================================

def handle_session_start(data: Dict[str, Any]) -> int:
    """
    Handle session start event.

    Checks if this is a CFA project and reminds about onboarding.
    """
    session_id = data.get("session_id", "unknown")
    cwd = data.get("cwd", os.getcwd())

    state = load_state()

    # Reset state for new session
    state["session_id"] = session_id
    state["project_path"] = cwd
    state["onboarding_done"] = False
    state["kg_retrieve_done"] = False
    state["files_modified"] = []
    state["functions_modified"] = []
    state["kg_build_pending"] = False

    save_state(state)

    if is_cfa_project(cwd):
        output_decision(
            "approve",
            "CFA project detected",
            """
## CFA Project Detected

This is a **Context-First Architecture v3** project. Follow this protocol:

1. **FIRST**: `workflow.onboard(project_path=".", show_instructions=true)`
2. **BEFORE EDITING**: `kg.retrieve(task="your task description")`
3. **AFTER FUNCTION CHANGES**: `contract.check_breaking(symbol="...")`
4. **BEFORE ENDING**: `kg.build(incremental=true)` + `memory.set` for learnings

Do NOT start coding without loading context first.
"""
        )

    return 0


# ============================================================================
# HOOK: PreToolUse (Edit/Write)
# ============================================================================

def handle_pre_edit(data: Dict[str, Any]) -> int:
    """
    Handle pre-edit validation.

    Blocks edits if kg.retrieve hasn't been called yet.
    """
    state = load_state()
    cwd = data.get("cwd", os.getcwd())
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")

    # Only enforce on CFA projects
    if not is_cfa_project(cwd):
        return 0

    # Skip validation for .claude/ internal files
    if ".claude/" in file_path or ".claude\\" in file_path:
        return 0

    # Check if context was loaded
    if not state.get("kg_retrieve_done", False):
        # STRICT ENFORCEMENT: Block edits until context is loaded
        output_decision(
            "block",
            "Cannot edit without loading context first",
            """
## ⛔ Cannot Proceed: Context Not Loaded

CFA enforces that context must be retrieved BEFORE editing code.

**Required first step:**
```
kg.retrieve(project_path=".", task="describe your current task")
```

This ensures you understand:
- Existing code patterns
- Function dependencies
- Potential impacts of your changes

**After context is loaded**, you'll be able to edit.
"""
        )
        return 2  # Block the action

    # Track modified file
    if file_path and file_path not in state.get("files_modified", []):
        state.setdefault("files_modified", []).append(file_path)
        state["kg_build_pending"] = True
        # Increment counter for smart suggestions
        state["edits_since_last_kg_build"] = state.get("edits_since_last_kg_build", 0) + 1
        save_state(state)

    return 0


# ============================================================================
# HOOK: PostToolUse (Edit)
# ============================================================================

def handle_post_edit(data: Dict[str, Any]) -> int:
    """
    Handle post-edit actions.

    Reminds to check for breaking changes if function signatures might have changed.
    """
    state = load_state()
    cwd = data.get("cwd", os.getcwd())
    tool_input = data.get("tool_input", {})

    # Only enforce on CFA projects
    if not is_cfa_project(cwd):
        return 0

    # Check if edit might have modified function signatures
    old_string = tool_input.get("old_string", "")
    new_string = tool_input.get("new_string", "")
    file_path = tool_input.get("file_path", "")

    # Simple heuristic: function signature changed if def/function pattern differs
    function_keywords = ["def ", "async def ", "function ", "const ", "export function"]

    old_has_func = any(kw in old_string for kw in function_keywords)
    new_has_func = any(kw in new_string for kw in function_keywords)

    if old_has_func or new_has_func:
        # Extract function name (simple heuristic)
        import re
        func_pattern = r'(?:def|async def|function|const)\s+(\w+)'

        old_funcs = set(re.findall(func_pattern, old_string))
        new_funcs = set(re.findall(func_pattern, new_string))

        modified_funcs = old_funcs | new_funcs

        if modified_funcs:
            # Add to tracking (avoid duplicates)
            existing = set(state.get("functions_modified", []))
            new_modified = existing | modified_funcs
            state["functions_modified"] = list(new_modified)
            state["breaking_changes_checked"] = False  # Reset check flag
            save_state(state)

            output_decision(
                "approve",
                "Function signature may have changed",
                f"""
## Function Modified: Check for Breaking Changes

You modified function(s): **{', '.join(modified_funcs)}**

**Before marking task complete, run:**
```
contract.check_breaking(project_path=".", symbol="{list(modified_funcs)[0]}")
```

This ensures no callers are broken by your changes.
"""
            )

    return 0


# ============================================================================
# HOOK: Track kg.retrieve calls
# ============================================================================

def handle_kg_retrieve(data: Dict[str, Any]) -> int:
    """Track when kg.retrieve is called."""
    state = load_state()
    state["kg_retrieve_done"] = True
    save_state(state)
    return 0


def handle_kg_build(data: Dict[str, Any]) -> int:
    """Track when kg.build is called."""
    state = load_state()
    state["kg_build_pending"] = False
    state["edits_since_last_kg_build"] = 0  # Reset counter
    state["last_kg_build_time"] = datetime.now().isoformat()
    state["kg_builds_this_session"] = state.get("kg_builds_this_session", 0) + 1
    save_state(state)
    return 0


def handle_contract_check_breaking(data: Dict[str, Any]) -> int:
    """Track when contract.check_breaking is called."""
    state = load_state()
    state["breaking_changes_checked"] = True
    state["contract_checks_this_session"] = state.get("contract_checks_this_session", 0) + 1
    save_state(state)
    return 0


def handle_workflow_onboard(data: Dict[str, Any]) -> int:
    """Track when workflow.onboard is called."""
    state = load_state()
    state["onboarding_done"] = True
    state["kg_retrieve_done"] = True  # onboard includes context
    save_state(state)
    return 0


# ============================================================================
# MAIN DISPATCHER
# ============================================================================

def main():
    """Main entry point - dispatch based on event and tool."""
    try:
        # Read input from stdin
        data = json.load(sys.stdin)

        event = data.get("hook_event_name", "")
        tool_name = data.get("tool_name", "")

        # Dispatch to appropriate handler
        if event == "SessionStart":
            return handle_session_start(data)

        elif event == "PreToolUse":
            if tool_name in ("Edit", "Write"):
                return handle_pre_edit(data)
            elif tool_name == "mcp__cfa__kg_retrieve":
                return handle_kg_retrieve(data)
            elif tool_name == "mcp__cfa__kg_build":
                return handle_kg_build(data)
            elif tool_name == "mcp__cfa__contract_check_breaking":
                return handle_contract_check_breaking(data)
            elif tool_name == "mcp__cfa__workflow_onboard":
                return handle_workflow_onboard(data)

        elif event == "PostToolUse":
            if tool_name == "Edit":
                return handle_post_edit(data)

        return 0

    except Exception as e:
        # Non-blocking error - log but don't fail
        print(f"CFA Validator Error: {e}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
