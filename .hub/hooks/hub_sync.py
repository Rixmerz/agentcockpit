#!/usr/bin/env python3
"""Hub Sync — SessionStart hook.

Syncs .hub/ → .claude/ on every session start so agents, skills,
commands, rules, and shared hooks are always up to date.

Protocol:
  stdin:  SessionStart event JSON (ignored)
  stdout: {"decision": "approve"}  (never blocks)
  stderr: sync summary (visible to agent)
  exit 0: always
"""

import json
import shutil
import sys
from pathlib import Path


def sync_dir(src: Path, dst: Path, overwrite: bool = True) -> list[str]:
    """Copy all files from src into dst. Returns list of copied file names."""
    if not src.exists():
        return []
    dst.mkdir(parents=True, exist_ok=True)
    copied = []
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            if overwrite or not target.exists():
                if target.exists():
                    shutil.rmtree(target)
                shutil.copytree(item, target)
                copied.append(item.name + "/")
        else:
            if overwrite or not target.exists():
                shutil.copy2(item, target)
                copied.append(item.name)
    return copied


def main():
    try:
        project_dir = Path(__file__).resolve().parents[2]  # agentcockpit root
        hub = project_dir / ".hub"
        claude = project_dir / ".claude"

        results = {}

        # Agents — always overwrite (hub is source of truth)
        copied = sync_dir(hub / "agents", claude / "agents", overwrite=True)
        results["agents"] = len(copied)

        # Skills — always overwrite
        copied = sync_dir(hub / "skills", claude / "skills", overwrite=True)
        results["skills"] = len(copied)

        # Commands — always overwrite
        copied = sync_dir(hub / "commands", claude / "commands", overwrite=True)
        results["commands"] = len(copied)

        # Rules — only add missing (don't overwrite agentcockpit-specific rules)
        copied = sync_dir(hub / "rules", claude / "rules", overwrite=False)
        results["rules_added"] = len(copied)

        # Shared hooks — only add missing (don't overwrite agentcockpit-specific hooks)
        copied = sync_dir(hub / "hooks", claude / "hooks", overwrite=False)
        results["hooks_added"] = len(copied)

        summary = (
            f"[hub_sync] agents={results['agents']} skills={results['skills']} "
            f"commands={results['commands']} rules+={results['rules_added']} "
            f"hooks+={results['hooks_added']}"
        )
        print(summary, file=sys.stderr)

    except Exception as e:
        print(f"[hub_sync] error: {e}", file=sys.stderr)

    print(json.dumps({"decision": "approve"}))


if __name__ == "__main__":
    main()
