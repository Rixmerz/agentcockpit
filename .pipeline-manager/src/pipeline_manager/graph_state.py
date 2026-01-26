"""Graph State - Persistence layer for graph execution state.

Handles loading and saving graph_state.json files.

Architecture (Centralized Hub - AgentCockpit):
- States: CENTRALIZED in {agentcockpit}/.agentcockpit/states/{project_name}/
- Active graph.yaml: LOCAL in {project}/.claude/pipeline/graph.yaml
- Config: ~/.agentcockpit/config.json defines hub_dir
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from .graph_engine import GraphState, PathEntry, Graph


# ============================================================================
# Hub Configuration (Centralized State Storage)
# ============================================================================

AGENTCOCKPIT_CONFIG_FILE = Path.home() / ".agentcockpit" / "config.json"
_hub_config_cache: dict | None = None


def _load_hub_config() -> dict:
    """Load AgentCockpit hub configuration."""
    global _hub_config_cache

    if _hub_config_cache is not None:
        return _hub_config_cache

    if not AGENTCOCKPIT_CONFIG_FILE.exists():
        # Fallback to local storage if no hub configured
        return {}

    try:
        _hub_config_cache = json.loads(AGENTCOCKPIT_CONFIG_FILE.read_text())
        _hub_config_cache.setdefault("states_dir", ".agentcockpit/states")
        return _hub_config_cache
    except Exception:
        return {}


def _get_centralized_state_dir(project_dir: str) -> Path:
    """Get the centralized state directory for a project.

    If hub is configured: {agentcockpit}/.agentcockpit/states/{project_name}/
    Otherwise fallback: {project}/.claude/pipeline/
    """
    config = _load_hub_config()

    if "hub_dir" in config:
        project_name = Path(project_dir).name
        state_dir = Path(config["hub_dir"]) / config["states_dir"] / project_name
        state_dir.mkdir(parents=True, exist_ok=True)
        return state_dir

    # Fallback to local
    return Path(project_dir) / ".claude" / "pipeline"


def get_graph_state_file(project_dir: str) -> Path:
    """Get the graph state file path for a project (CENTRALIZED in hub)."""
    return _get_centralized_state_dir(project_dir) / "graph_state.json"


def get_graph_file(project_dir: str) -> Path:
    """Get the active graph file path for a project (LOCAL copy)."""
    return Path(project_dir) / ".claude" / "pipeline" / "graph.yaml"


def load_graph_state(project_dir: str) -> GraphState:
    """Load graph state from file.

    Args:
        project_dir: Project directory path

    Returns:
        GraphState object (empty state if file doesn't exist)
    """
    state_file = get_graph_state_file(project_dir)

    if not state_file.exists():
        return GraphState()

    try:
        data = json.loads(state_file.read_text())

        # Parse execution path
        execution_path: list[PathEntry] = []
        for entry_data in data.get('execution_path', []):
            entry = PathEntry(
                from_node=entry_data.get('from_node'),
                to_node=entry_data.get('to_node', ''),
                edge_id=entry_data.get('edge_id'),
                timestamp=entry_data.get('timestamp', ''),
                reason=entry_data.get('reason', '')
            )
            execution_path.append(entry)

        return GraphState(
            current_nodes=data.get('current_nodes', []),
            node_visits=data.get('node_visits', {}),
            execution_path=execution_path,
            active_graph=data.get('active_graph'),
            max_visits_default=data.get('max_visits_default', 10),
            total_transitions=data.get('total_transitions', 0),
            last_activity=data.get('last_activity')
        )
    except Exception:
        return GraphState()


def save_graph_state(project_dir: str, state: GraphState):
    """Save graph state to file.

    Args:
        project_dir: Project directory path
        state: GraphState to save
    """
    state_file = get_graph_state_file(project_dir)

    # Ensure directory exists
    state_file.parent.mkdir(parents=True, exist_ok=True)

    # Serialize execution path
    execution_path_data = []
    for entry in state.execution_path:
        execution_path_data.append({
            'from_node': entry.from_node,
            'to_node': entry.to_node,
            'edge_id': entry.edge_id,
            'timestamp': entry.timestamp,
            'reason': entry.reason
        })

    # Update last_activity
    state.last_activity = datetime.now().isoformat()

    data = {
        'current_nodes': state.current_nodes,
        'node_visits': state.node_visits,
        'execution_path': execution_path_data,
        'active_graph': state.active_graph,
        'max_visits_default': state.max_visits_default,
        'total_transitions': state.total_transitions,
        'last_activity': state.last_activity
    }

    state_file.write_text(json.dumps(data, indent=2))


def initialize_graph_state(project_dir: str, graph: Graph, graph_name: str) -> GraphState:
    """Initialize a new graph state for a given graph.

    Args:
        project_dir: Project directory path
        graph: The Graph to initialize state for
        graph_name: Name of the graph file (without extension)

    Returns:
        Newly initialized GraphState
    """
    start_node = graph.get_start_node()
    if not start_node:
        raise ValueError("Graph has no start node")

    state = GraphState(
        current_nodes=[start_node.id],
        node_visits={start_node.id: 1},
        execution_path=[
            PathEntry(
                from_node=None,
                to_node=start_node.id,
                edge_id=None,
                timestamp=datetime.now().isoformat(),
                reason="Graph initialized"
            )
        ],
        active_graph=graph_name,
        max_visits_default=10,
        total_transitions=0,
        last_activity=datetime.now().isoformat()
    )

    save_graph_state(project_dir, state)
    return state


def reset_graph_state(project_dir: str, graph: Graph) -> GraphState:
    """Reset graph state to start node.

    Args:
        project_dir: Project directory path
        graph: The Graph to reset state for

    Returns:
        Reset GraphState
    """
    # Load existing state to preserve active_graph name
    existing = load_graph_state(project_dir)
    graph_name = existing.active_graph

    start_node = graph.get_start_node()
    if not start_node:
        raise ValueError("Graph has no start node")

    state = GraphState(
        current_nodes=[start_node.id],
        node_visits={start_node.id: 1},
        execution_path=[
            PathEntry(
                from_node=None,
                to_node=start_node.id,
                edge_id=None,
                timestamp=datetime.now().isoformat(),
                reason="Graph reset"
            )
        ],
        active_graph=graph_name,
        max_visits_default=existing.max_visits_default,
        total_transitions=0,
        last_activity=datetime.now().isoformat()
    )

    save_graph_state(project_dir, state)
    return state


def get_node_visit_warning(state: GraphState, node_id: str, max_visits: int) -> Optional[str]:
    """Check if a node is approaching its max visits limit.

    Args:
        state: Current graph state
        node_id: Node to check
        max_visits: Maximum visits allowed

    Returns:
        Warning message if at 80%+ of limit, None otherwise
    """
    current_visits = state.get_visit_count(node_id)
    threshold = max_visits * 0.8

    if current_visits >= max_visits:
        return f"BLOCKED: Node '{node_id}' has reached max visits ({current_visits}/{max_visits})"
    elif current_visits >= threshold:
        remaining = max_visits - current_visits
        return f"WARNING: Node '{node_id}' approaching max visits ({current_visits}/{max_visits}, {remaining} remaining)"

    return None
