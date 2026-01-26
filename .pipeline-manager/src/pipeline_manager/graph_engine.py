"""Graph Engine - Core data structures for directed graph pipeline.

This module provides the fundamental classes for representing and manipulating
directed graphs with conditional edges, supporting loops and multiple transition paths.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class EdgeCondition:
    """Condition that must be met for an edge to be traversable.

    Attributes:
        type: Condition type - 'tool', 'phrase', 'always', or 'default'
            - 'tool': Triggered when specific MCP tool is used
            - 'phrase': Triggered when text contains specific phrases
            - 'always': Always available (manual traverse only)
            - 'default': Fallback when no other conditions match
        tool: Full tool name for 'tool' type (e.g., 'mcp__Context7__get-library-docs')
        phrases: List of phrases for 'phrase' type
    """
    type: str  # 'tool', 'phrase', 'always', 'default'
    tool: Optional[str] = None
    phrases: list[str] = field(default_factory=list)

    def matches_tool(self, mcp_name: str, tool_name: str) -> bool:
        """Check if a tool call matches this condition."""
        if self.type not in ('tool', 'default'):
            return False
        if not self.tool:
            return self.type == 'default'

        full_name = f"mcp__{mcp_name}__{tool_name}"
        # Support partial matching (prefix or contains)
        return (
            full_name == self.tool or
            full_name.startswith(self.tool) or
            self.tool in full_name
        )

    def matches_phrase(self, text: str) -> tuple[bool, Optional[str]]:
        """Check if text contains any matching phrase.

        Returns:
            Tuple of (matched: bool, matched_phrase: Optional[str])
        """
        if self.type not in ('phrase', 'default'):
            return False, None
        if not self.phrases:
            return self.type == 'default', None

        text_lower = text.lower()
        for phrase in self.phrases:
            if phrase.lower() in text_lower:
                return True, phrase
        return False, None


@dataclass
class Node:
    """A node in the pipeline graph.

    Attributes:
        id: Unique identifier for the node
        name: Human-readable name
        mcps_enabled: List of MCP names allowed in this node ('*' for all)
        tools_blocked: List of specific tools blocked in this node
        prompt_injection: Optional prompt to inject when entering this node
        is_start: Whether this is a valid starting node
        is_end: Whether this is a terminal node
        max_visits: Maximum times this node can be visited (loop protection)
    """
    id: str
    name: str
    mcps_enabled: list[str] = field(default_factory=lambda: ["*"])
    tools_blocked: list[str] = field(default_factory=list)
    prompt_injection: Optional[str] = None
    is_start: bool = False
    is_end: bool = False
    max_visits: int = 10


@dataclass
class Edge:
    """A directed edge connecting two nodes.

    Attributes:
        id: Unique identifier for the edge
        from_node: Source node ID
        to_node: Destination node ID
        condition: Condition for traversing this edge
        priority: Lower number = higher priority when multiple edges match
    """
    id: str
    from_node: str
    to_node: str
    condition: EdgeCondition
    priority: int = 1


@dataclass
class Graph:
    """A complete pipeline graph with nodes and edges.

    Attributes:
        metadata: Graph metadata (name, version, type)
        nodes: Dictionary of node_id -> Node
        edges: List of all edges
        edges_by_source: Index of from_node_id -> list of edges (built automatically)
    """
    metadata: dict = field(default_factory=dict)
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: list[Edge] = field(default_factory=list)
    edges_by_source: dict[str, list[Edge]] = field(default_factory=dict)

    def __post_init__(self):
        """Build edge index after initialization."""
        self._rebuild_edge_index()

    def _rebuild_edge_index(self):
        """Rebuild the edges_by_source index."""
        self.edges_by_source = {}
        for edge in self.edges:
            if edge.from_node not in self.edges_by_source:
                self.edges_by_source[edge.from_node] = []
            self.edges_by_source[edge.from_node].append(edge)

        # Sort edges by priority for each source
        for node_id in self.edges_by_source:
            self.edges_by_source[node_id].sort(key=lambda e: e.priority)

    def add_node(self, node: Node):
        """Add a node to the graph."""
        self.nodes[node.id] = node

    def add_edge(self, edge: Edge):
        """Add an edge and update the index."""
        self.edges.append(edge)
        if edge.from_node not in self.edges_by_source:
            self.edges_by_source[edge.from_node] = []
        self.edges_by_source[edge.from_node].append(edge)
        self.edges_by_source[edge.from_node].sort(key=lambda e: e.priority)

    def get_start_node(self) -> Optional[Node]:
        """Get the designated start node."""
        for node in self.nodes.values():
            if node.is_start:
                return node
        # Fallback: return first node if no explicit start
        return next(iter(self.nodes.values())) if self.nodes else None

    def get_outgoing_edges(self, node_id: str) -> list[Edge]:
        """Get all edges leaving a node, sorted by priority."""
        return self.edges_by_source.get(node_id, [])

    def validate(self) -> list[str]:
        """Validate graph structure.

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []

        # Check for start node
        start_nodes = [n for n in self.nodes.values() if n.is_start]
        if not start_nodes:
            errors.append("No start node defined (set is_start: true on at least one node)")
        elif len(start_nodes) > 1:
            errors.append(f"Multiple start nodes: {[n.id for n in start_nodes]}")

        # Check for orphan nodes (no incoming or outgoing edges)
        nodes_with_outgoing = set()
        nodes_with_incoming = set()
        for edge in self.edges:
            nodes_with_outgoing.add(edge.from_node)
            nodes_with_incoming.add(edge.to_node)

        for node_id in self.nodes:
            node = self.nodes[node_id]
            if node_id not in nodes_with_outgoing and not node.is_end:
                errors.append(f"Node '{node_id}' has no outgoing edges and is not marked as end node")
            if node_id not in nodes_with_incoming and not node.is_start:
                errors.append(f"Node '{node_id}' has no incoming edges and is not marked as start node")

        # Check edge references
        for edge in self.edges:
            if edge.from_node not in self.nodes:
                errors.append(f"Edge '{edge.id}' references unknown from_node: {edge.from_node}")
            if edge.to_node not in self.nodes:
                errors.append(f"Edge '{edge.id}' references unknown to_node: {edge.to_node}")

        return errors


@dataclass
class PathEntry:
    """A single entry in the execution path history."""
    from_node: Optional[str]
    to_node: str
    edge_id: Optional[str]
    timestamp: str
    reason: str


@dataclass
class GraphState:
    """Runtime state of graph execution.

    Attributes:
        current_nodes: List of currently active node IDs (array for future parallelism)
        node_visits: Count of visits per node ID
        execution_path: History of all transitions
        active_graph: Name of the active graph file
        max_visits_default: Default max visits for nodes without explicit limit
        total_transitions: Total number of transitions made
    """
    current_nodes: list[str] = field(default_factory=list)
    node_visits: dict[str, int] = field(default_factory=dict)
    execution_path: list[PathEntry] = field(default_factory=list)
    active_graph: Optional[str] = None
    max_visits_default: int = 10
    total_transitions: int = 0
    last_activity: Optional[str] = None

    def get_current_node(self) -> Optional[str]:
        """Get the primary current node (first in list)."""
        return self.current_nodes[0] if self.current_nodes else None

    def get_visit_count(self, node_id: str) -> int:
        """Get number of times a node has been visited."""
        return self.node_visits.get(node_id, 0)

    def record_transition(
        self,
        from_node: Optional[str],
        to_node: str,
        edge_id: Optional[str],
        reason: str
    ):
        """Record a transition in the execution path."""
        entry = PathEntry(
            from_node=from_node,
            to_node=to_node,
            edge_id=edge_id,
            timestamp=datetime.now().isoformat(),
            reason=reason
        )
        self.execution_path.append(entry)
        self.node_visits[to_node] = self.node_visits.get(to_node, 0) + 1
        self.current_nodes = [to_node]
        self.total_transitions += 1
        self.last_activity = entry.timestamp


class MaxVisitsExceeded(Exception):
    """Raised when a node's max_visits limit is exceeded."""

    def __init__(self, node_id: str, current_visits: int, max_visits: int):
        self.node_id = node_id
        self.current_visits = current_visits
        self.max_visits = max_visits
        super().__init__(
            f"Node '{node_id}' has reached max visits ({current_visits}/{max_visits})"
        )


def evaluate_transitions(
    graph: Graph,
    state: GraphState,
    trigger_type: str,  # 'tool', 'phrase', 'none'
    trigger_value: Optional[dict] = None
) -> list[Edge]:
    """Evaluate which edges can be traversed from current node.

    Args:
        graph: The pipeline graph
        state: Current execution state
        trigger_type: Type of trigger ('tool', 'phrase', 'none')
        trigger_value: For 'tool': {'mcp': str, 'tool': str}
                      For 'phrase': {'text': str}

    Returns:
        List of valid edges sorted by priority (lower = higher priority)
    """
    current_node = state.get_current_node()
    if not current_node:
        return []

    outgoing = graph.get_outgoing_edges(current_node)
    valid_edges = []

    for edge in outgoing:
        condition = edge.condition

        if trigger_type == 'tool' and trigger_value:
            if condition.matches_tool(
                trigger_value.get('mcp', ''),
                trigger_value.get('tool', '')
            ):
                valid_edges.append(edge)

        elif trigger_type == 'phrase' and trigger_value:
            matched, _ = condition.matches_phrase(trigger_value.get('text', ''))
            if matched:
                valid_edges.append(edge)

        elif trigger_type == 'none':
            # Return all edges that are 'always' or 'default' type
            if condition.type in ('always', 'default'):
                valid_edges.append(edge)

    # Sort by priority (already sorted in edges_by_source, but ensure consistency)
    valid_edges.sort(key=lambda e: e.priority)
    return valid_edges


def take_transition(
    graph: Graph,
    state: GraphState,
    edge: Edge,
    reason: str
) -> GraphState:
    """Execute a transition, updating state.

    Args:
        graph: The pipeline graph
        state: Current execution state
        edge: The edge to traverse
        reason: Human-readable reason for transition

    Returns:
        Updated GraphState

    Raises:
        MaxVisitsExceeded: If destination node has reached max visits
    """
    dest_node = graph.nodes.get(edge.to_node)
    if not dest_node:
        raise ValueError(f"Edge '{edge.id}' references unknown node: {edge.to_node}")

    # Check max_visits
    current_visits = state.get_visit_count(edge.to_node)
    max_visits = dest_node.max_visits if dest_node.max_visits > 0 else state.max_visits_default

    if current_visits >= max_visits:
        raise MaxVisitsExceeded(edge.to_node, current_visits, max_visits)

    # Record the transition
    state.record_transition(
        from_node=state.get_current_node(),
        to_node=edge.to_node,
        edge_id=edge.id,
        reason=reason
    )

    return state


def generate_mermaid(graph: Graph, state: Optional[GraphState] = None) -> str:
    """Generate Mermaid diagram from graph.

    Args:
        graph: The pipeline graph
        state: Optional state to highlight current node

    Returns:
        Mermaid flowchart diagram as string
    """
    lines = ["flowchart TD"]
    current_node = state.get_current_node() if state else None

    # Add nodes
    for node_id, node in graph.nodes.items():
        label = node.name.replace('"', "'")

        # Determine node shape
        if node.is_start:
            shape = f"([{label}])"  # Stadium shape for start
        elif node.is_end:
            shape = f"[/{label}/]"  # Parallelogram for end
        else:
            shape = f"[{label}]"  # Rectangle for regular

        lines.append(f"    {node_id}{shape}")

    # Add edges
    for edge in graph.edges:
        label = ""
        if edge.condition.type == 'tool' and edge.condition.tool:
            # Extract tool name from full path
            tool_short = edge.condition.tool.split('__')[-1] if '__' in edge.condition.tool else edge.condition.tool
            label = f"|{tool_short}|"
        elif edge.condition.type == 'phrase' and edge.condition.phrases:
            phrases_short = edge.condition.phrases[0][:15]
            label = f"|'{phrases_short}'|"
        elif edge.condition.type == 'default':
            label = "|default|"

        lines.append(f"    {edge.from_node} -->{label} {edge.to_node}")

    # Highlight current node
    if current_node:
        lines.append(f"    style {current_node} fill:#90EE90,stroke:#333,stroke-width:3px")

    return "\n".join(lines)
