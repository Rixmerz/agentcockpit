#!/usr/bin/env python3
"""Experience Recorder — PostToolUse hook for Bash.

Detects git commits and records experiential knowledge into the
experience memory store. Captures lessons learned from actual coding work.

Protocol:
  stdin:  {"tool_name": "Bash", "tool_input": {"command": "git commit ..."}, ...}
  env:    CLAUDE_PROJECT_DIR
  stdout: {"decision": "approve"}  (always — never blocks)
  stderr: brief confirmation of recorded experience
  exit 0: always
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


_APPROVE = json.dumps({"decision": "approve"})


# ---------------------------------------------------------------------------
# Domain map (matches experience_injector.py)
# ---------------------------------------------------------------------------
_DOMAIN_MAP = {
    "auth": ["auth", "login", "session", "token", "jwt"],
    "api": ["api", "endpoint", "route", "controller", "handler", "middleware"],
    "ui": ["component", "page", "view", "layout", "modal", "form", "panel"],
    "config": ["config", "setting", "env", "constant"],
    "data": ["model", "schema", "entity", "migration", "repository", "store"],
    "style": ["style", "css", "theme"],
    "util": ["util", "helper", "lib", "common", "shared"],
}


def _extract_keywords(path: str) -> list:
    """Extract keywords from a file path (matches experience_injector.py)."""
    stem = Path(path).stem.lower()
    words = re.split(r'(?<=[a-z])(?=[A-Z])|[-_./\\]', stem)
    words = [w.lower() for w in words if len(w) > 1]
    parent = Path(path).parent.name.lower()
    if parent and len(parent) > 1 and parent not in (".", "src"):
        words.append(parent)
    return list(dict.fromkeys(words))  # dedupe preserving order


def _guess_domain(path: str) -> str:
    """Guess domain from file path (matches experience_injector.py)."""
    lower = path.lower()
    best, best_score = "", 0
    for domain, kws in _DOMAIN_MAP.items():
        score = sum(1 for kw in kws if kw in lower)
        if score > best_score:
            best_score = score
            best = domain
    return best or "general"


def _generalize_path(path: str) -> str:
    """Convert a specific file path to a glob pattern.

    Examples:
      src/services/authService.ts  -> src/services/*Service.ts
      src/components/LoginForm.tsx -> src/components/*Form.tsx
      src/utils/helpers.ts         -> src/utils/*.ts
    """
    p = Path(path)
    stem = p.stem
    suffix = p.suffix
    parent = str(p.parent)

    # Detect camelCase suffix — e.g. authService -> *Service
    camel_match = re.search(r'(?<=[a-z])([A-Z][a-z]+)$', stem)
    # Detect PascalCase with two words — e.g. LoginForm -> *Form
    pascal_match = re.match(r'^[A-Z][a-z]+([A-Z][a-z]+)$', stem)

    if camel_match:
        tail = camel_match.group(1)
        return f"{parent}/*{tail}{suffix}"
    elif pascal_match:
        tail = pascal_match.group(1)
        return f"{parent}/*{tail}{suffix}"
    else:
        return f"{parent}/*{suffix}"


def _parse_commit_type(subject: str) -> str:
    """Extract commit type from conventional commit subject line."""
    subject_lower = subject.lower()
    if subject_lower.startswith("fix"):
        return "bug_fix"
    if subject_lower.startswith("feat"):
        return "feature_pattern"
    if subject_lower.startswith("refactor"):
        return "refactor_pattern"
    if subject_lower.startswith("perf"):
        return "performance_fix"
    return "general"


def _load_store(path: Path) -> dict:
    """Load experience store JSON, returning empty store on any error."""
    if not path.exists():
        return {"entries": [], "version": 1}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"entries": [], "version": 1}
        if "entries" not in data:
            data["entries"] = []
        return data
    except Exception:
        return {"entries": [], "version": 1}


def _save_store(path: Path, data: dict) -> None:
    """Write experience store JSON, silently ignoring errors."""
    try:
        os.makedirs(str(path.parent), exist_ok=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass


def _find_duplicate(entries: list, commit_type: str, file_pattern: str, description: str) -> int:
    """Return index of matching entry or -1 if not found."""
    for i, entry in enumerate(entries):
        if (
            entry.get("type") == commit_type
            and entry.get("file_pattern") == file_pattern
            and entry.get("description") == description
        ):
            return i
    return -1


def _upsert_entry(entries: list, entry: dict) -> list:
    """Add new entry or increment occurrences/confidence if duplicate exists."""
    idx = _find_duplicate(
        entries,
        entry["type"],
        entry["file_pattern"],
        entry["description"],
    )
    if idx == -1:
        entries.append(entry)
    else:
        existing = entries[idx]
        existing["occurrences"] = existing.get("occurrences", 1) + 1
        # Increase confidence by 0.1 per recurrence, capped at 0.95
        existing["confidence"] = min(0.95, existing.get("confidence", 0.5) + 0.1)
        existing["last_seen"] = entry["last_seen"]
        # Update resolution if the new commit body is more detailed
        if entry.get("resolution") and len(entry["resolution"]) > len(existing.get("resolution", "")):
            existing["resolution"] = entry["resolution"]
        entries[idx] = existing
    return entries


def main():
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        print(_APPROVE)
        return

    # Only handle Bash tool
    tool_name = hook_input.get("tool_name", "")
    if tool_name != "Bash":
        print(_APPROVE)
        return

    tool_input = hook_input.get("tool_input", {})
    command = tool_input.get("command", "")

    # Only trigger on git commit commands
    if "git commit" not in command:
        print(_APPROVE)
        return

    # Resolve project dir from the command itself, fallback to env var
    project_dir = ""
    # Try git -C /path (e.g., "git -C /path/to/project commit ...")
    if " -C " in command:
        parts = command.split(" -C ", 1)
        if len(parts) > 1:
            rest = parts[1].strip()
            project_dir = rest.split()[0].strip('"').strip("'") if rest else ""
    # Try cd /path && git commit (e.g., "cd /path/to/project && git commit ...")
    if not project_dir and command.strip().startswith("cd "):
        cd_part = command.strip().split("&&")[0].strip()
        if cd_part.startswith("cd "):
            project_dir = cd_part[3:].strip().strip('"').strip("'")
    if not project_dir:
        project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        print(_APPROVE)
        return

    project_name = Path(project_dir).name

    # -----------------------------------------------------------------------
    # Extract commit info via subprocess
    # -----------------------------------------------------------------------

    # Get last commit message (subject + blank line + body)
    try:
        msg_result = subprocess.run(
            ["git", "-C", project_dir, "log", "-1", "--format=%s%n%n%b"],
            capture_output=True, text=True, timeout=3
        )
        commit_message = msg_result.stdout.strip()
    except Exception:
        print(_APPROVE)
        return

    if not commit_message:
        print(_APPROVE)
        return

    # Split into subject (first line) and body (rest)
    lines = commit_message.split("\n")
    commit_subject = lines[0].strip()
    commit_body = "\n".join(lines[2:]).strip() if len(lines) > 2 else ""

    # Get short commit hash
    try:
        hash_result = subprocess.run(
            ["git", "-C", project_dir, "log", "-1", "--format=%H"],
            capture_output=True, text=True, timeout=3
        )
        commit_hash = hash_result.stdout.strip()[:12]
    except Exception:
        commit_hash = ""

    # Get changed files
    try:
        files_result = subprocess.run(
            ["git", "-C", project_dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
            capture_output=True, text=True, timeout=3
        )
        changed_files = [f.strip() for f in files_result.stdout.strip().split("\n") if f.strip()]
    except Exception:
        changed_files = []

    if not changed_files:
        print(_APPROVE)
        return

    # -----------------------------------------------------------------------
    # Build experience entries
    # -----------------------------------------------------------------------
    commit_type = _parse_commit_type(commit_subject)
    now_iso = datetime.now(timezone.utc).isoformat()

    new_entries = []
    for file_path in changed_files:
        entry = {
            "type": commit_type,
            "file_pattern": _generalize_path(file_path),
            "keywords": _extract_keywords(file_path),
            "domain": _guess_domain(file_path),
            "description": commit_subject,
            "resolution": commit_body,
            "severity": "medium",
            "confidence": 0.5,
            "occurrences": 1,
            "last_seen": now_iso,
            "project_origin": project_name,
            "commit_hash": commit_hash,
        }
        new_entries.append(entry)

    # -----------------------------------------------------------------------
    # Persist to project store and global store
    # -----------------------------------------------------------------------
    wm_dir = Path.home() / ".workflow-manager"

    project_store_path = wm_dir / "project_memories" / project_name / "experience_memory.json"
    global_store_path = wm_dir / "experience_memory.json"

    for store_path in (project_store_path, global_store_path):
        store = _load_store(store_path)
        entries = store.get("entries", [])
        for entry in new_entries:
            entries = _upsert_entry(entries, entry)
        store["entries"] = entries
        store["last_updated"] = now_iso
        _save_store(store_path, store)

    # -----------------------------------------------------------------------
    # Report to Claude via stderr
    # -----------------------------------------------------------------------
    domains = list(dict.fromkeys(e["domain"] for e in new_entries))
    domain_str = ", ".join(domains)
    print(
        f"\U0001f4dd Experience recorded: {commit_subject} "
        f"({len(changed_files)} file{'s' if len(changed_files) != 1 else ''}, "
        f"domain: {domain_str})",
        file=sys.stderr,
    )

    print(_APPROVE)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Fail-safe: always approve
        print(_APPROVE)
