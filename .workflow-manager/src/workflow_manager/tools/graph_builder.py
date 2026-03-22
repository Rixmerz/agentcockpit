"""Graph builder tools: graph_builder_create/add_node/add_edge/preview/save/list/delete."""

import uuid

from ..hub_config import get_global_workflows_dir
from ..graph_parser import parse_graph_yaml, GraphParseError
from ..session import resolve_project_dir


# In-memory graph builder storage
# Key: builder_id, Value: {"metadata": {...}, "nodes": [...], "edges": [...]}
_graph_builders: dict[str, dict] = {}


def _get_or_create_builder(builder_id: str) -> dict:
    """Get or create a graph builder by ID."""
    if builder_id not in _graph_builders:
        _graph_builders[builder_id] = {
            "metadata": {
                "name": "Untitled Graph",
                "description": "",
                "version": "1.0.0",
                "type": "graph"
            },
            "nodes": [],
            "edges": []
        }
    return _graph_builders[builder_id]


def _generate_graph_yaml(builder: dict) -> str:
    """Generate YAML content from builder data."""
    lines = []

    # Metadata
    lines.append("metadata:")
    lines.append(f'  name: "{builder["metadata"].get("name", "Untitled")}"')
    lines.append(f'  description: "{builder["metadata"].get("description", "")}"')
    lines.append(f'  version: "{builder["metadata"].get("version", "1.0.0")}"')
    lines.append(f'  type: "graph"')
    lines.append("")

    # Nodes
    lines.append("nodes:")
    for node in builder["nodes"]:
        lines.append(f'  - id: "{node["id"]}"')
        lines.append(f'    name: "{node.get("name", node["id"])}"')

        if node.get("is_start"):
            lines.append("    is_start: true")
        if node.get("is_end"):
            lines.append("    is_end: true")

        # MCPs enabled
        mcps = node.get("mcps_enabled", ["*"])
        if mcps:
            lines.append("    mcps_enabled:")
            for mcp_name in mcps:
                lines.append(f'      - "{mcp_name}"')

        # Tools blocked
        blocked = node.get("tools_blocked", [])
        if blocked:
            lines.append("    tools_blocked:")
            for tool in blocked:
                lines.append(f'      - "{tool}"')

        # Max visits
        if node.get("max_visits"):
            lines.append(f'    max_visits: {node["max_visits"]}')

        # Prompt injection
        if node.get("prompt_injection"):
            lines.append("    prompt_injection: |")
            for pi_line in node["prompt_injection"].split("\n"):
                lines.append(f"      {pi_line}")

        lines.append("")

    # Edges
    lines.append("edges:")
    for edge in builder["edges"]:
        lines.append(f'  - id: "{edge["id"]}"')
        lines.append(f'    from: "{edge["from"]}"')
        lines.append(f'    to: "{edge["to"]}"')
        lines.append("    condition:")
        lines.append(f'      type: "{edge.get("condition_type", "always")}"')

        if edge.get("condition_tool"):
            lines.append(f'      tool: "{edge["condition_tool"]}"')

        if edge.get("condition_phrases"):
            lines.append("      phrases:")
            for phrase in edge["condition_phrases"]:
                lines.append(f'        - "{phrase}"')

        if edge.get("priority", 1) != 1:
            lines.append(f'    priority: {edge["priority"]}')

        lines.append("")

    return "\n".join(lines)


def register_graph_builder_tools(mcp):

    @mcp.tool()
    def graph_builder_create(
        name: str,
        description: str = "",
        version: str = "1.0.0",
        builder_id: str | None = None
    ) -> dict:
        # destructiveHint: False
        """Create a new graph builder session.

        Use this to start building a new graph programmatically.
        Returns a builder_id to use in subsequent calls.

        Args:
            name: Name of the graph (e.g., "CFA Remember Workflow")
            description: Description of what the graph does
            version: Version string (default "1.0.0")
            builder_id: Optional custom ID (auto-generated if not provided)

        Example:
            graph_builder_create(name="My Workflow", description="Does X and Y")
            graph_builder_add_node(node_id="start", name="Start", is_start=True)
            graph_builder_add_edge(edge_id="start-to-end", from_node="start", to_node="end")
            graph_builder_save(filename="my-workflow")
        """
        bid = builder_id or str(uuid.uuid4())[:8]

        _graph_builders[bid] = {
            "metadata": {
                "name": name,
                "description": description,
                "version": version,
                "type": "graph"
            },
            "nodes": [],
            "edges": []
        }

        return {
            "success": True,
            "builder_id": bid,
            "message": f"Graph builder created: {name}",
            "hint": "Use graph_builder_add_node() and graph_builder_add_edge() to build the graph"
        }

    @mcp.tool()
    def graph_builder_add_node(
        builder_id: str,
        node_id: str,
        name: str,
        is_start: bool = False,
        is_end: bool = False,
        mcps_enabled: list[str] | None = None,
        tools_blocked: list[str] | None = None,
        max_visits: int = 10,
        prompt_injection: str | None = None
    ) -> dict:
        # destructiveHint: False
        """Add a node to a graph builder.

        Args:
            builder_id: ID from graph_builder_create()
            node_id: Unique identifier for this node (e.g., "start", "analysis", "complete")
            name: Human-readable name (e.g., "Sequential Thinking")
            is_start: True if this is the starting node
            is_end: True if this is an ending node
            mcps_enabled: List of MCP names allowed (default ["*"] = all)
            tools_blocked: List of tools to block (e.g., ["Write", "Edit", "Bash"])
            max_visits: Maximum visits before blocking (default 10)
            prompt_injection: Prompt text injected when entering this node

        Example:
            graph_builder_add_node(
                builder_id="abc123",
                node_id="thinking",
                name="Sequential Thinking",
                is_start=True,
                mcps_enabled=["sequential-thinking"],
                tools_blocked=["Write", "Edit"],
                prompt_injection="Use sequential thinking to analyze the task..."
            )
        """
        if builder_id not in _graph_builders:
            return {
                "success": False,
                "message": f"Builder '{builder_id}' not found. Use graph_builder_create() first."
            }

        builder = _graph_builders[builder_id]

        # Check for duplicate node_id
        for existing in builder["nodes"]:
            if existing["id"] == node_id:
                return {
                    "success": False,
                    "message": f"Node '{node_id}' already exists in this builder"
                }

        node = {
            "id": node_id,
            "name": name,
            "is_start": is_start,
            "is_end": is_end,
            "mcps_enabled": mcps_enabled or ["*"],
            "tools_blocked": tools_blocked or [],
            "max_visits": max_visits
        }

        if prompt_injection:
            node["prompt_injection"] = prompt_injection

        builder["nodes"].append(node)

        return {
            "success": True,
            "builder_id": builder_id,
            "node_id": node_id,
            "node_count": len(builder["nodes"]),
            "message": f"Node '{name}' added"
        }

    @mcp.tool()
    def graph_builder_add_edge(
        builder_id: str,
        edge_id: str,
        from_node: str,
        to_node: str,
        condition_type: str = "always",
        condition_tool: str | None = None,
        condition_phrases: list[str] | None = None,
        priority: int = 1
    ) -> dict:
        # destructiveHint: False
        """Add an edge (transition) to a graph builder.

        Args:
            builder_id: ID from graph_builder_create()
            edge_id: Unique identifier for this edge (e.g., "start-to-analysis")
            from_node: Source node ID
            to_node: Destination node ID
            condition_type: "always", "tool", or "phrase"
            condition_tool: For type="tool", the tool that triggers (e.g., "mcp__cfa4__cfa.remember")
            condition_phrases: For type="phrase", list of phrases that trigger (e.g., ["done", "complete"])
            priority: Higher priority edges are evaluated first (default 1)

        Examples:
            # Tool-triggered transition
            graph_builder_add_edge(
                builder_id="abc123",
                edge_id="capture-to-complete",
                from_node="capture",
                to_node="complete",
                condition_type="tool",
                condition_tool="mcp__cfa4__cfa.remember"
            )

            # Phrase-triggered transition
            graph_builder_add_edge(
                builder_id="abc123",
                edge_id="analysis-to-dev",
                from_node="analysis",
                to_node="development",
                condition_type="phrase",
                condition_phrases=["ready to implement", "proceed with development"]
            )
        """
        if builder_id not in _graph_builders:
            return {
                "success": False,
                "message": f"Builder '{builder_id}' not found. Use graph_builder_create() first."
            }

        builder = _graph_builders[builder_id]

        # Validate nodes exist
        node_ids = {n["id"] for n in builder["nodes"]}
        if from_node not in node_ids:
            return {
                "success": False,
                "message": f"from_node '{from_node}' not found. Add it with graph_builder_add_node() first.",
                "available_nodes": list(node_ids)
            }
        if to_node not in node_ids:
            return {
                "success": False,
                "message": f"to_node '{to_node}' not found. Add it with graph_builder_add_node() first.",
                "available_nodes": list(node_ids)
            }

        # Check for duplicate edge_id
        for existing in builder["edges"]:
            if existing["id"] == edge_id:
                return {
                    "success": False,
                    "message": f"Edge '{edge_id}' already exists in this builder"
                }

        edge = {
            "id": edge_id,
            "from": from_node,
            "to": to_node,
            "condition_type": condition_type,
            "priority": priority
        }

        if condition_type == "tool" and condition_tool:
            edge["condition_tool"] = condition_tool
        elif condition_type == "phrase" and condition_phrases:
            edge["condition_phrases"] = condition_phrases

        builder["edges"].append(edge)

        return {
            "success": True,
            "builder_id": builder_id,
            "edge_id": edge_id,
            "edge_count": len(builder["edges"]),
            "message": f"Edge '{from_node}' -> '{to_node}' added"
        }

    @mcp.tool()
    def graph_builder_preview(builder_id: str) -> dict:
        # readOnlyHint: True
        """Preview the YAML that will be generated.

        Args:
            builder_id: ID from graph_builder_create()

        Returns:
            The YAML content that would be saved
        """
        if builder_id not in _graph_builders:
            return {
                "success": False,
                "message": f"Builder '{builder_id}' not found"
            }

        builder = _graph_builders[builder_id]
        yaml_content = _generate_graph_yaml(builder)

        return {
            "success": True,
            "builder_id": builder_id,
            "yaml": yaml_content,
            "stats": {
                "nodes": len(builder["nodes"]),
                "edges": len(builder["edges"])
            }
        }

    @mcp.tool()
    def graph_builder_save(
        builder_id: str,
        filename: str,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: True (writes file to workflows library)
        """Save the graph to the workflows library.

        Args:
            builder_id: ID from graph_builder_create()
            filename: Name for the file (without extension, e.g., "cfa-remember")
            project_dir: Project directory (optional after set_session)
            session_id: Session ID for parallel isolation

        The file will be saved as {filename}-graph.yaml in the workflows directory.
        """
        if builder_id not in _graph_builders:
            return {
                "success": False,
                "message": f"Builder '{builder_id}' not found"
            }

        builder = _graph_builders[builder_id]

        # Validate before saving
        if not builder["nodes"]:
            return {
                "success": False,
                "message": "Cannot save: no nodes defined. Use graph_builder_add_node() first."
            }

        has_start = any(n.get("is_start") for n in builder["nodes"])
        if not has_start:
            return {
                "success": False,
                "message": "Cannot save: no start node defined. Set is_start=True on one node."
            }

        # Generate YAML
        yaml_content = _generate_graph_yaml(builder)

        # Validate the generated YAML can be parsed
        try:
            test_graph = parse_graph_yaml(yaml_content)
            errors = test_graph.validate()
            if errors:
                return {
                    "success": False,
                    "message": "Generated graph has validation errors",
                    "errors": errors
                }
        except GraphParseError as e:
            return {
                "success": False,
                "message": f"Generated YAML is invalid: {e}"
            }

        # Get workflows directory
        workflows_dir = get_global_workflows_dir()
        workflows_dir.mkdir(parents=True, exist_ok=True)

        # Save file
        safe_filename = filename.replace(" ", "-").lower()
        if not safe_filename.endswith("-graph"):
            safe_filename = f"{safe_filename}-graph"

        output_path = workflows_dir / f"{safe_filename}.yaml"
        output_path.write_text(yaml_content)

        # Clean up builder
        del _graph_builders[builder_id]

        return {
            "success": True,
            "message": f"Graph saved successfully",
            "file": str(output_path),
            "graph_name": builder["metadata"]["name"],
            "stats": {
                "nodes": len(builder["nodes"]),
                "edges": len(builder["edges"])
            },
            "hint": f"Use graph_activate('{safe_filename}') to activate this graph"
        }

    @mcp.tool()
    def graph_builder_list() -> dict:
        # readOnlyHint: True
        """List all active graph builders.

        Returns the current in-memory builders and their status.
        """
        builders = []
        for bid, builder in _graph_builders.items():
            builders.append({
                "builder_id": bid,
                "name": builder["metadata"].get("name", "Untitled"),
                "nodes": len(builder["nodes"]),
                "edges": len(builder["edges"]),
                "has_start": any(n.get("is_start") for n in builder["nodes"]),
                "has_end": any(n.get("is_end") for n in builder["nodes"])
            })

        return {
            "builders": builders,
            "count": len(builders),
            "hint": "Use graph_builder_preview(builder_id) to see YAML or graph_builder_save() to save"
        }

    @mcp.tool()
    def graph_builder_delete(builder_id: str) -> dict:
        # destructiveHint: True (deletes builder without saving)
        """Delete a graph builder without saving.

        Args:
            builder_id: ID of the builder to delete
        """
        if builder_id not in _graph_builders:
            return {
                "success": False,
                "message": f"Builder '{builder_id}' not found"
            }

        name = _graph_builders[builder_id]["metadata"].get("name", "Untitled")
        del _graph_builders[builder_id]

        return {
            "success": True,
            "message": f"Builder '{name}' deleted"
        }
