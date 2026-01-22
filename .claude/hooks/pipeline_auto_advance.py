#!/usr/bin/env python3
"""
Pipeline Auto-Advance Hook for Claude Code
Automatically advances the pipeline when a gate tool is used.
"""

import json
import sys
import os
from pathlib import Path
from datetime import datetime


def parse_steps_yaml(content: str) -> list:
    """Simple YAML parser for steps configuration."""
    steps = []
    current_step = None
    current_list = None

    for line in content.split('\n'):
        stripped = line.strip()

        if not stripped or stripped.startswith('#'):
            continue

        if stripped.startswith('- id:'):
            if current_step is not None:
                steps.append(current_step)
            id_val = stripped.split(':', 1)[1].strip().strip('"').strip("'")
            current_step = {"id": id_val, "tools_blocked": [], "mcps_enabled": [], "gate_phrases": []}
            current_list = None
            continue

        if current_step is not None:
            if stripped.startswith('- ') and current_list:
                value = stripped[2:].strip().strip('"').strip("'")
                if current_list in current_step:
                    current_step[current_list].append(value)
            elif ':' in stripped:
                key, val = stripped.split(':', 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")

                if not val:
                    current_list = key
                    if key not in current_step:
                        current_step[key] = []
                else:
                    current_step[key] = val
                    current_list = None

    if current_step is not None:
        steps.append(current_step)

    return steps


def main():
    # Read hook input from stdin
    try:
        hook_input = json.load(sys.stdin)
    except json.JSONDecodeError:
        return

    tool_name = hook_input.get("tool_name", "")

    # Get project directory from environment
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_dir:
        return

    pipeline_dir = Path(project_dir) / ".claude" / "pipeline"
    state_file = pipeline_dir / "state.json"
    steps_file = pipeline_dir / "steps.yaml"

    if not state_file.exists() or not steps_file.exists():
        return

    try:
        # Load current state
        with open(state_file, 'r') as f:
            state = json.load(f)

        current_step_idx = state.get("current_step", 0)

        # Parse steps
        with open(steps_file, 'r') as f:
            steps_content = f.read()
        steps = parse_steps_yaml(steps_content)

        if current_step_idx >= len(steps):
            return

        current_step = steps[current_step_idx]
        gate_tool = current_step.get("gate_tool", "")
        gate_type = current_step.get("gate_type", "any")

        # Check if this tool triggers the gate
        if gate_type == "always":
            return

        # Check if tool matches gate_tool pattern
        tool_matches = False
        if gate_tool:
            # gate_tool can be a prefix like "mcp__Context7__" or full name
            if tool_name.startswith(gate_tool) or gate_tool in tool_name:
                tool_matches = True

        if tool_matches:
            # Advance to next step
            new_step_idx = current_step_idx + 1

            if new_step_idx < len(steps):
                state["current_step"] = new_step_idx
                state["completed_steps"] = state.get("completed_steps", [])
                state["completed_steps"].append({
                    "id": current_step.get("id", f"step_{current_step_idx}"),
                    "completed_at": datetime.now().isoformat(),
                    "reason": f"Gate tool used: {tool_name}"
                })
                state["step_history"] = state.get("step_history", [])
                state["step_history"].append({
                    "from_step": current_step_idx,
                    "to_step": new_step_idx,
                    "timestamp": datetime.now().isoformat(),
                    "reason": f"Auto-advance: gate tool {tool_name}"
                })
                state["last_activity"] = datetime.now().isoformat()

                # Save updated state
                with open(state_file, 'w') as f:
                    json.dump(state, f, indent=2)

                # Print notification to stderr (visible to user)
                next_step = steps[new_step_idx]
                print(f"[Pipeline] Auto-advanced to Step {new_step_idx}: {next_step.get('name', next_step.get('id'))}", file=sys.stderr)

    except Exception as e:
        # Silently fail - don't block the tool
        pass


if __name__ == "__main__":
    main()
