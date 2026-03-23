"""AgentCockpit Hub Configuration (Centralized Architecture).

Manages hub paths, workflow directories, project state directories,
and enforcer configuration.
"""

import json
import sys
from datetime import datetime
from pathlib import Path


AGENTCOCKPIT_CONFIG_FILE = Path.home() / ".agentcockpit" / "config.json"
_hub_config: dict | None = None


def load_hub_config() -> dict:
    """Load AgentCockpit hub configuration from ~/.agentcockpit/config.json.

    Returns config with keys:
        - hub_dir: Absolute path to agentcockpit project
        - workflows_dir: Relative path for workflows (default: .claude/workflows)
        - states_dir: Relative path for states (default: .agentcockpit/states)
    """
    global _hub_config

    if _hub_config is not None:
        return _hub_config

    if not AGENTCOCKPIT_CONFIG_FILE.exists():
        raise ValueError(
            f"AgentCockpit config not found at {AGENTCOCKPIT_CONFIG_FILE}. "
            "Create it with: {\"hub_dir\": \"/path/to/agentcockpit\"}"
        )

    try:
        _hub_config = json.loads(AGENTCOCKPIT_CONFIG_FILE.read_text())
    except Exception as e:
        raise ValueError(f"Error reading AgentCockpit config: {e}")

    if "hub_dir" not in _hub_config:
        raise ValueError("AgentCockpit config missing 'hub_dir' key")

    # Set defaults
    _hub_config.setdefault("workflows_dir", ".claude/workflows")
    _hub_config.setdefault("states_dir", ".agentcockpit/states")

    return _hub_config


def get_hub_dir() -> Path:
    """Get the AgentCockpit hub directory."""
    config = load_hub_config()
    return Path(config["hub_dir"])


def get_global_workflows_dir() -> Path:
    """Get the GLOBAL workflows directory (in AgentCockpit hub)."""
    config = load_hub_config()
    return Path(config["hub_dir"]) / config["workflows_dir"]


def get_project_state_dir(project_dir: str) -> Path:
    """Get the centralized state directory for a specific project.

    States are stored in: {agentcockpit}/.agentcockpit/states/{project_name}/
    """
    config = load_hub_config()
    project_name = Path(project_dir).name
    return Path(config["hub_dir"]) / config["states_dir"] / project_name


def get_workflow_dir(project_dir: str) -> Path:
    """Get workflow directory for a specific project.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)

    Returns:
        Path to {project_dir}/.claude/workflow/

    Raises:
        ValueError: If project_dir is empty or None
    """
    if not project_dir:
        raise ValueError("project_dir is required. Workflow manager only works per-project.")

    project_path = Path(project_dir)
    if not project_path.exists():
        raise ValueError(f"Project directory does not exist: {project_dir}")

    return project_path / ".claude" / "workflow"


def get_workflows_library_dir(project_dir: str | None = None) -> Path:
    """Get the GLOBAL workflows library directory from AgentCockpit hub.

    Workflows are ALWAYS global (centralized in AgentCockpit).
    Returns {agentcockpit}/.claude/workflows/

    Args:
        project_dir: Ignored - kept for backward compatibility
    """
    return get_global_workflows_dir()


# MCP Configuration paths (order of priority)
AGENTCOCKPIT_MCP_CONFIG = Path.home() / ".agentcockpit" / "mcps.json"
CLAUDE_CODE_CONFIG = Path.home() / ".claude.json"


def load_mcp_configs() -> dict[str, dict]:
    """Load MCP configurations.

    Priority:
    1. ~/.agentcockpit/mcps.json (centralized AgentCockpit config)
    2. ~/.claude.json (Claude Code config, fallback)

    The AgentCockpit config has a different structure with nested 'config' keys.
    """
    # Try AgentCockpit config first (centralized)
    try:
        if AGENTCOCKPIT_MCP_CONFIG.exists():
            data = json.loads(AGENTCOCKPIT_MCP_CONFIG.read_text())
            mcp_servers = data.get("mcpServers", {})
            # AgentCockpit format: {"name": {"name": ..., "config": {...}}}
            # We need to extract the config from each entry
            result = {}
            for name, entry in mcp_servers.items():
                if isinstance(entry, dict):
                    # Check if this is AgentCockpit format (has 'config' key)
                    if "config" in entry:
                        result[name] = entry["config"]
                    else:
                        # Fallback to treating entry as config directly
                        result[name] = entry
            if result:
                return result
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to read MCP config: {e}", file=sys.stderr)
        pass

    # Fallback to Claude Code config
    try:
        if CLAUDE_CODE_CONFIG.exists():
            config = json.loads(CLAUDE_CODE_CONFIG.read_text())
            return config.get("mcpServers", {})
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to read Claude Code config: {e}", file=sys.stderr)
        pass

    return {}


# ============================================================================
# Enforcer Configuration
# ============================================================================

def get_enforcer_config_file(project_dir: str) -> Path:
    """Get the enforcer config file path (CENTRALIZED in hub)."""
    return get_project_state_dir(project_dir) / "config.json"


def load_enforcer_config(project_dir: str) -> dict:
    """Load enforcer configuration from config.json."""
    config_file = get_enforcer_config_file(project_dir)
    if config_file.exists():
        try:
            return json.loads(config_file.read_text())
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to load enforcer config: {e}", file=sys.stderr)
            pass
    defaults = {"enforcer_enabled": True, "mid_phase_dcc": True}
    return defaults


def save_enforcer_config(project_dir: str, config: dict):
    """Save enforcer configuration to config.json."""
    config_file = get_enforcer_config_file(project_dir)
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config["last_updated"] = datetime.now().isoformat()
    config_file.write_text(json.dumps(config, indent=2))
