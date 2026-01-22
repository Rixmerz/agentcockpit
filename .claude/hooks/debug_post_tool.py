#!/usr/bin/env python3
"""Debug hook to verify PostToolUse execution."""
import json
import sys
import os
from datetime import datetime
from pathlib import Path

def main():
    try:
        hook_input = json.load(sys.stdin)
    except:
        hook_input = {}

    tool_name = hook_input.get("tool_name", "unknown")
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")

    # Write to debug log
    log_file = Path(project_dir) / ".claude" / "pipeline" / "hook_debug.log"
    with open(log_file, "a") as f:
        f.write(f"{datetime.now().isoformat()} - PostToolUse: {tool_name}\n")

if __name__ == "__main__":
    main()
