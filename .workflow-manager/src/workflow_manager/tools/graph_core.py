"""Graph core tools: graph_status, graph_traverse, graph_check_tool/phrase,
graph_reset, graph_set_node, graph_acknowledge_tensions.
"""

import sys

from ..session import resolve_project_dir
from ..hub_config import load_enforcer_config
from ..graph_engine import (
    Graph, GraphState, MaxVisitsExceeded,
    evaluate_transitions, take_transition,
)
from ..graph_parser import load_graph_from_file, GraphParseError
from ..graph_state import (
    load_graph_state, save_graph_state, initialize_graph_state,
    reset_graph_state, get_graph_file, get_node_visit_warning,
)
from ..dcc_integration import (
    _is_dcc_available, _resolve_dcc_config, _run_dcc_analysis,
    _collect_experiences_from_dcc, _check_tension_gate,
    _clear_tension_gate_state, _get_tension_gate_info,
    _run_impact_preview, _execute_dcc_tool,
    acknowledge_tension_gate,
)


def _load_active_graph(project_dir: str) -> tuple[Graph, GraphState]:
    """Load active graph and state for a project.

    Returns:
        Tuple of (Graph, GraphState)

    Raises:
        ValueError: If no graph is configured
    """
    graph_file = get_graph_file(project_dir)
    if not graph_file.exists():
        raise ValueError(f"No graph.yaml found at {graph_file}")

    graph = load_graph_from_file(graph_file)
    state = load_graph_state(project_dir)

    # Initialize state if empty
    if not state.current_nodes:
        graph_name = graph.metadata.get('name', 'unnamed')
        state = initialize_graph_state(project_dir, graph, graph_name)

    return graph, state


def register_graph_core_tools(mcp):

    @mcp.tool()
    def graph_status(project_dir: str | None = None, session_id: str | None = None) -> dict:
        # readOnlyHint: True
        """Get current graph workflow status: current node, available edges, visits.

        Returns the current node, outgoing edges sorted by priority,
        and visit counts for loop protection monitoring.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except ValueError as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "hint": "Create a graph.yaml file or use graph_activate() to load one",
                "project_dir": resolved_dir
            }
        except GraphParseError as e:
            return {
                "error": True,
                "session_id": sid,
                "message": f"Graph parse error: {e}",
                "project_dir": resolved_dir
            }

        current_node_id = state.get_current_node()
        current_node = graph.nodes.get(current_node_id) if current_node_id else None

        # Get outgoing edges
        outgoing_edges = graph.get_outgoing_edges(current_node_id) if current_node_id else []
        edges_info = []
        for edge in outgoing_edges:
            edge_info = {
                "id": edge.id,
                "to": edge.to_node,
                "to_name": graph.nodes[edge.to_node].name if edge.to_node in graph.nodes else edge.to_node,
                "condition_type": edge.condition.type,
                "priority": edge.priority
            }
            if edge.condition.tool:
                edge_info["condition_tool"] = edge.condition.tool
            if edge.condition.phrases:
                edge_info["condition_phrases"] = edge.condition.phrases
            edges_info.append(edge_info)

        # Check for visit warnings
        warnings = []
        if current_node:
            warning = get_node_visit_warning(state, current_node_id, current_node.max_visits)
            if warning:
                warnings.append(warning)

        # Get enforcer config
        enforcer_config = load_enforcer_config(resolved_dir)

        return {
            "session_id": sid,
            "graph_name": state.active_graph or graph.metadata.get('name', 'unnamed'),
            "current_node": {
                "id": current_node_id,
                "name": current_node.name if current_node else None,
                "mcps_enabled": current_node.mcps_enabled if current_node else [],
                "tools_blocked": current_node.tools_blocked if current_node else [],
                "is_end": current_node.is_end if current_node else False,
                "visits": state.get_visit_count(current_node_id) if current_node_id else 0,
                "max_visits": current_node.max_visits if current_node else 10
            },
            "available_edges": edges_info,
            "total_transitions": state.total_transitions,
            "warnings": warnings if warnings else None,
            "enabled": enforcer_config.get("enforcer_enabled", True),
            "prompt_injection": current_node.prompt_injection if current_node else None,
            "dcc_injection": {
                "available": _is_dcc_available(),
                "enabled": enforcer_config.get("dcc_injection_enabled", True),
                "node_override": current_node.dcc_context if current_node and current_node.dcc_context else None,
            },
            "tension_gate": _get_tension_gate_info(current_node, resolved_dir, current_node_id),
            "last_activity": state.last_activity,
            "project_dir": resolved_dir
        }

    @mcp.tool()
    async def graph_traverse(
        edge_id: str,
        reason: str = "Manual traverse",
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: True (modifies graph state)
        """Traverse a specific edge to move to next node.

        Use this to explicitly move through the graph. Check graph_status()
        first to see available edges.

        Args:
            edge_id: ID of the edge to traverse
            reason: Human-readable reason for this transition
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        # Find the edge
        edge = None
        for e in graph.edges:
            if e.id == edge_id:
                edge = e
                break

        if not edge:
            return {
                "error": True,
                "session_id": sid,
                "message": f"Edge '{edge_id}' not found",
                "available_edges": [e.id for e in graph.get_outgoing_edges(state.get_current_node())],
                "project_dir": resolved_dir
            }

        # Verify edge starts from current node
        current_node_id = state.get_current_node()
        if edge.from_node != current_node_id:
            return {
                "error": True,
                "session_id": sid,
                "message": f"Edge '{edge_id}' does not start from current node '{current_node_id}'",
                "edge_from": edge.from_node,
                "project_dir": resolved_dir
            }

        # Tension gate: check if current node blocks exit due to unresolved tensions
        current_node = graph.nodes.get(current_node_id)
        gate_result = await _check_tension_gate(current_node, resolved_dir)
        if gate_result and gate_result.get("blocked"):
            return {
                "error": True,
                "tension_gate_blocked": True,
                "session_id": sid,
                "message": (
                    f"Tension gate blocked: {gate_result['blocking_tensions']} unresolved tension(s) "
                    f"with severity >= {gate_result['min_severity']}. "
                    f"Fix the issues and retry, or use graph_acknowledge_tensions() to force advance. "
                    f"Attempt {gate_result['attempts']}/{gate_result['max_retries']} "
                    f"(auto-passes after {gate_result['max_retries']})."
                ),
                "gate_details": gate_result,
                "project_dir": resolved_dir
            }

        # Execute transition
        try:
            state = take_transition(graph, state, edge, reason)
            save_graph_state(resolved_dir, state)
        except MaxVisitsExceeded as e:
            # Get alternative edges
            other_edges = [
                ed for ed in graph.get_outgoing_edges(current_node_id)
                if ed.to_node != edge.to_node
            ]
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "blocked_node": e.node_id,
                "visits": e.current_visits,
                "max_visits": e.max_visits,
                "alternative_edges": [ed.id for ed in other_edges],
                "hint": "Use graph_override_max_visits() if you need to exceed the limit",
                "project_dir": resolved_dir
            }

        # Get new node info
        new_node = graph.nodes.get(state.get_current_node())

        # Run DCC analysis (global injection -- auto-detects availability)
        enforcer_config = load_enforcer_config(resolved_dir)
        should_run, analyses, token_budget = _resolve_dcc_config(new_node, enforcer_config)

        dcc_result = None
        dcc_raw = {}
        if should_run:
            try:
                dcc_result, dcc_raw = await _run_dcc_analysis(analyses, token_budget, resolved_dir)
            except Exception as e:
                dcc_result = {"error": str(e)}

        # Experience memory: auto-collect from DCC results
        if dcc_raw:
            try:
                _collect_experiences_from_dcc(dcc_raw, resolved_dir)
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to collect DCC experiences: {e}", file=sys.stderr)
                pass  # Non-fatal

        # Impact preview: simulate wave for nodes with impact_preview configured
        impact_result = None
        try:
            impact_result = await _run_impact_preview(new_node, resolved_dir)
        except Exception as e:
            impact_result = {"error": str(e)}

        result = {
            "success": True,
            "session_id": sid,
            "traversed_edge": edge_id,
            "from_node": edge.from_node,
            "to_node": edge.to_node,
            "new_node": {
                "id": new_node.id if new_node else edge.to_node,
                "name": new_node.name if new_node else None,
                "mcps_enabled": new_node.mcps_enabled if new_node else [],
                "is_end": new_node.is_end if new_node else False,
                "visits": state.get_visit_count(edge.to_node)
            },
            "total_transitions": state.total_transitions,
            "prompt_injection": new_node.prompt_injection if new_node else None,
            "dcc_analysis": dcc_result,
            "reason": reason,
            "project_dir": resolved_dir
        }

        if impact_result:
            result["impact_preview"] = impact_result

        return result

    @mcp.tool()
    def graph_check_tool(
        mcp_name: str,
        tool_name: str,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # readOnlyHint: True
        """Check if a tool call would trigger any edge transitions.

        Use this BEFORE executing a tool to see if it would cause a transition.
        Does NOT execute the transition - use graph_traverse() for that.

        Args:
            mcp_name: Name of the MCP server
            tool_name: Name of the tool
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "matched": False,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        # Evaluate transitions
        trigger_value = {'mcp': mcp_name, 'tool': tool_name}
        matching_edges = evaluate_transitions(graph, state, 'tool', trigger_value)

        if not matching_edges:
            return {
                "matched": False,
                "session_id": sid,
                "message": f"Tool '{mcp_name}.{tool_name}' does not trigger any transitions",
                "current_node": state.get_current_node(),
                "project_dir": resolved_dir
            }

        edges_info = []
        for edge in matching_edges:
            edges_info.append({
                "id": edge.id,
                "to": edge.to_node,
                "to_name": graph.nodes[edge.to_node].name if edge.to_node in graph.nodes else edge.to_node,
                "priority": edge.priority
            })

        return {
            "matched": True,
            "session_id": sid,
            "tool": f"{mcp_name}.{tool_name}",
            "matching_edges": edges_info,
            "recommended_edge": matching_edges[0].id if matching_edges else None,
            "hint": "Use graph_traverse(edge_id) to execute the transition",
            "project_dir": resolved_dir
        }

    @mcp.tool()
    def graph_check_phrase(
        text: str,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # readOnlyHint: True
        """Check if text contains phrases that would trigger edge transitions.

        Use this to indicate conditions through phrases (e.g., "trivial", "no docs needed").
        Does NOT execute the transition - use graph_traverse() for that.

        Args:
            text: Text to check against edge phrases
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "matched": False,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        # Evaluate transitions
        trigger_value = {'text': text}
        matching_edges = evaluate_transitions(graph, state, 'phrase', trigger_value)

        if not matching_edges:
            # Get available phrases from current node's edges
            current_edges = graph.get_outgoing_edges(state.get_current_node())
            all_phrases = []
            for edge in current_edges:
                if edge.condition.phrases:
                    all_phrases.extend(edge.condition.phrases)

            return {
                "matched": False,
                "session_id": sid,
                "message": "No matching phrases found",
                "current_node": state.get_current_node(),
                "available_phrases": all_phrases if all_phrases else None,
                "project_dir": resolved_dir
            }

        # Find which phrase matched
        matched_phrase = None
        for edge in matching_edges:
            _, phrase = edge.condition.matches_phrase(text)
            if phrase:
                matched_phrase = phrase
                break

        edges_info = []
        for edge in matching_edges:
            edges_info.append({
                "id": edge.id,
                "to": edge.to_node,
                "to_name": graph.nodes[edge.to_node].name if edge.to_node in graph.nodes else edge.to_node,
                "priority": edge.priority
            })

        return {
            "matched": True,
            "session_id": sid,
            "matched_phrase": matched_phrase,
            "matching_edges": edges_info,
            "recommended_edge": matching_edges[0].id if matching_edges else None,
            "hint": "Use graph_traverse(edge_id) to execute the transition",
            "project_dir": resolved_dir
        }

    @mcp.tool()
    def graph_reset(project_dir: str | None = None, session_id: str | None = None) -> dict:
        # destructiveHint: True (clears graph state)
        """Reset graph to start node.

        Clears all visit counts and execution history.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, _ = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        state = reset_graph_state(resolved_dir, graph)
        _clear_tension_gate_state(resolved_dir)
        start_node = graph.get_start_node()

        return {
            "success": True,
            "session_id": sid,
            "message": "Graph reset to start node",
            "current_node": {
                "id": start_node.id if start_node else None,
                "name": start_node.name if start_node else None
            },
            "project_dir": resolved_dir
        }

    @mcp.tool()
    def graph_set_node(
        node_id: str,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: True (bypasses normal transition logic)
        """Jump to a specific node (admin function).

        Use with caution - bypasses normal transition logic.

        Args:
            node_id: ID of the node to jump to
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        if node_id not in graph.nodes:
            return {
                "error": True,
                "session_id": sid,
                "message": f"Node '{node_id}' not found",
                "available_nodes": list(graph.nodes.keys()),
                "project_dir": resolved_dir
            }

        # Record the jump
        state.record_transition(
            from_node=state.get_current_node(),
            to_node=node_id,
            edge_id=None,
            reason=f"Admin jump to {node_id}"
        )
        save_graph_state(resolved_dir, state)
        _clear_tension_gate_state(resolved_dir, node_id)

        node = graph.nodes[node_id]
        return {
            "success": True,
            "session_id": sid,
            "message": f"Jumped to node '{node_id}'",
            "current_node": {
                "id": node.id,
                "name": node.name,
                "mcps_enabled": node.mcps_enabled,
                "is_end": node.is_end,
                "visits": state.get_visit_count(node_id)
            },
            "prompt_injection": node.prompt_injection,
            "project_dir": resolved_dir
        }

    @mcp.tool()
    async def graph_acknowledge_tensions(
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: True (bypasses tension gate)
        """Acknowledge unresolved tensions and force-advance past the tension gate.

        Use this as an escape hatch when the agent has reviewed the tensions but
        decides to proceed anyway. The next graph_traverse() from this node will
        skip the tension gate check.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir
            }

        current_node_id = state.get_current_node()
        current_node = graph.nodes.get(current_node_id) if current_node_id else None

        if not current_node or not current_node.dcc_context:
            return {
                "error": True,
                "session_id": sid,
                "message": f"Node '{current_node_id}' has no tension gate configured",
                "project_dir": resolved_dir
            }

        gate_config = current_node.dcc_context.get("tension_gate", {})
        if not gate_config.get("enabled", False):
            return {
                "error": True,
                "session_id": sid,
                "message": f"Node '{current_node_id}' has no tension gate enabled",
                "project_dir": resolved_dir
            }

        gate_state = acknowledge_tension_gate(resolved_dir, current_node_id)

        # Mark tensions as reviewed in DCC
        try:
            await _execute_dcc_tool("cube_get_tensions", {"status": "reviewed"}, resolved_dir)
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to mark tensions as reviewed: {e}", file=sys.stderr)
            pass

        return {
            "success": True,
            "session_id": sid,
            "message": f"Tensions acknowledged for node '{current_node_id}'. Next traverse will pass the gate.",
            "node_id": current_node_id,
            "attempts_before_ack": gate_state["attempts"],
            "project_dir": resolved_dir
        }
