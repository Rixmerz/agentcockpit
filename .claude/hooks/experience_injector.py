#!/usr/bin/env python3
"""Experience Memory Injector — PreToolUse hook for Write/Edit.

Reads experience memory JSONs and injects relevant memories as context
when the agent modifies files. Self-contained (no MCP imports).

Protocol (same as graph_enforcer.py):
  stdin:  {"tool_name": "Write", ...}
  env:    FILE (path being modified), CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}  (never blocks)
  stderr: experience memory context (visible to agent)
  exit 0: always
"""

import json
import os
import re
import sys
from pathlib import Path


def _extract_keywords(path: str) -> list[str]:
    """Extract keywords from a file path (inline, no imports)."""
    stem = Path(path).stem.lower()
    words = re.split(r'(?<=[a-z])(?=[A-Z])|[-_./\\]', stem)
    words = [w.lower() for w in words if len(w) > 1]
    parent = Path(path).parent.name.lower()
    if parent and len(parent) > 1 and parent not in (".", "src"):
        words.append(parent)
    return list(dict.fromkeys(words))  # dedupe preserving order


_DOMAIN_MAP = {
    "auth": ["auth", "login", "session", "token", "jwt"],
    "api": ["api", "endpoint", "route", "controller", "handler", "middleware"],
    "ui": ["component", "page", "view", "layout", "modal", "form", "panel"],
    "config": ["config", "setting", "env", "constant"],
    "data": ["model", "schema", "entity", "migration", "repository", "store"],
    "style": ["style", "css", "theme"],
    "util": ["util", "helper", "lib", "common", "shared"],
}


def _guess_domain(path: str) -> str:
    lower = path.lower()
    best, best_score = "", 0
    for domain, kws in _DOMAIN_MAP.items():
        score = sum(1 for kw in kws if kw in lower)
        if score > best_score:
            best_score = score
            best = domain
    return best or "general"


def _score_entry(entry: dict, target_path: str, target_kws: list[str],
                 target_domain: str) -> float:
    """Compute relevance score (simplified inline version)."""
    # Path match
    pattern = entry.get("file_pattern", "")
    path_score = 0.0
    if pattern:
        try:
            regex = pattern.replace("*", ".*")
            if re.fullmatch(regex, target_path):
                path_score = 1.0
            elif str(Path(pattern).parent) == str(Path(target_path).parent):
                path_score = 0.7
        except re.error:
            pass

    # Keyword overlap (Jaccard)
    entry_kws = set(entry.get("keywords", []))
    target_set = set(target_kws)
    kw_score = 0.0
    if entry_kws and target_set:
        kw_score = len(entry_kws & target_set) / len(entry_kws | target_set)

    # Domain match
    domain_score = 1.0 if entry.get("domain") == target_domain else 0.0

    # Confidence
    conf = entry.get("confidence", 0.3)

    return path_score * 0.30 + kw_score * 0.25 + domain_score * 0.20 + conf * 0.15


def _load_entries(path: Path) -> list[dict]:
    """Load entries from a memory JSON file."""
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
        return data.get("entries", [])
    except Exception:
        return []


def main():
    # Always approve — this hook is informational only
    approve = json.dumps({"decision": "approve"})

    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(approve)
        return

    # Get the file being modified
    file_path = os.environ.get("FILE", "")
    if not file_path:
        # Try to extract from tool_input
        tool_input = hook_input.get("tool_input", {})
        file_path = tool_input.get("file_path", tool_input.get("path", ""))

    if not file_path:
        print(approve)
        return

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    project_name = Path(project_dir).name if project_dir else ""

    # Load memory files
    wm_dir = Path.home() / ".workflow-manager"
    global_entries = _load_entries(wm_dir / "experience_memory.json")

    project_entries = []
    if project_name:
        project_entries = _load_entries(
            wm_dir / "project_memories" / project_name / "experience_memory.json"
        )

    all_entries = global_entries + project_entries
    if not all_entries:
        print(approve)
        return

    # Score and rank
    target_kws = _extract_keywords(file_path)
    target_domain = _guess_domain(file_path)

    scored = []
    for entry in all_entries:
        score = _score_entry(entry, file_path, target_kws, target_domain)
        if score > 0.10:
            scored.append((entry, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:3]

    if top:
        filename = Path(file_path).name
        lines = [f"\u26a1 Experience Memory ({len(top)} match{'es' if len(top) > 1 else ''} for {filename}):"]
        for entry, score in top:
            occurrences = entry.get("occurrences", 1)
            desc = entry.get("description", "")[:80]
            resolution = entry.get("resolution", "")
            lines.append(f"  [{score:.2f}] {desc} ({occurrences}x)")
            if resolution:
                lines.append(f"    \u2192 {resolution[:100]}")

        print("\n".join(lines), file=sys.stderr)

    print(approve)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail-safe: always approve
        print(json.dumps({"decision": "approve"}))
