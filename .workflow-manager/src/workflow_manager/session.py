"""Session management for workflow-manager.

Handles project directory resolution and session storage.
"""

import uuid
from datetime import datetime


# Global session storage - persists within MCP server process
# Key: session_id, Value: {"project_dir": str, "created_at": str}
_session_store: dict[str, dict] = {}

# Default session for single-project use (most common case)
_default_session: dict = {"project_dir": None}


def get_or_create_session(session_id: str | None = None) -> str:
    """Get existing session ID or create a new one."""
    if session_id:
        return session_id
    return str(uuid.uuid4())


def get_session_project_dir(session_id: str | None) -> str | None:
    """Get project_dir for a specific session or default."""
    if session_id and session_id in _session_store:
        return _session_store[session_id].get("project_dir")
    # Fall back to default session
    return _default_session.get("project_dir")


def set_session_project_dir(session_id: str | None, project_dir: str):
    """Store project_dir for a specific session or default."""
    if session_id:
        if session_id not in _session_store:
            _session_store[session_id] = {"created_at": datetime.now().isoformat()}
        _session_store[session_id]["project_dir"] = project_dir
    # Always update default for convenience
    _default_session["project_dir"] = project_dir


def resolve_project_dir(project_dir: str | None, session_id: str | None = None) -> tuple[str, str]:
    """Resolve project_dir from parameter or session.

    Returns (project_dir, session_id).
    Priority: explicit parameter > session cache > default > error
    """
    sid = session_id or "default"

    if project_dir:
        set_session_project_dir(session_id, project_dir)
        return project_dir, sid

    # Try session-specific first, then default
    cached = get_session_project_dir(session_id)
    if cached:
        return cached, sid

    raise ValueError(
        "project_dir required on first call. "
        "Use set_session(project_dir) or pass project_dir explicitly."
    )
