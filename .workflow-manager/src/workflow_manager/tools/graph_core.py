"""Graph core tools: graph_status, graph_traverse, graph_check_tool/phrase,
graph_reset, graph_set_node, graph_acknowledge_tensions.
"""

import subprocess
import sys
from datetime import datetime

from ..session import resolve_project_dir
from ..hub_config import load_enforcer_config
from ..graph_engine import (
    Graph, GraphState, MaxVisitsExceeded,
    evaluate_transitions, take_transition,
    _write_contract_files, _cleanup_contract_files,
    compute_ready_tasks, is_dag_complete, Task,
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
    acknowledge_tension_gate, _query_relevant_experiences,
    _detect_project_languages, _enrich_smells_with_skills,
    _select_skills_for_context, _record_skill_references,
    _run_mid_phase_check, _run_pre_transition_check,
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

        # Collect outputs recorded on the current node's path entry
        current_outputs: dict[str, str] = {}
        if state.execution_path:
            last_entry = state.execution_path[-1]
            if last_entry.outputs:
                current_outputs = last_entry.outputs

        # DAG info (only when current node is a DAG)
        dag_info = None
        if current_node and current_node.node_type == "dag" and current_node.tasks:
            completed_ids = set(state.get_completed_tasks_for_node(current_node.id))
            ready = compute_ready_tasks(graph, state, current_node.id)
            ready_ids = {t.id for t in ready}
            blocked_ids = {t.id for t in current_node.tasks if t.id not in completed_ids and t.id not in ready_ids}
            dag_info = {
                "total_tasks": len(current_node.tasks),
                "completed": list(completed_ids),
                "ready": [
                    {
                        "id": t.id,
                        "name": t.name,
                        "prompt": t.prompt[:200] if t.prompt else None,
                        "tools_blocked": t.tools_blocked,
                        "mcps_enabled": t.mcps_enabled,
                    }
                    for t in ready
                ],
                "blocked": list(blocked_ids),
                "is_complete": is_dag_complete(graph, state, current_node.id),
            }

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
            "tension_gate": _get_tension_gate_info(current_node, resolved_dir, current_node_id, state),
            "dcc_status": {
                "last_analysis": state.last_dcc_result,
                "timestamp": state.last_dcc_timestamp,
            },
            "current_outputs": current_outputs,
            "dag_info": dag_info,
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
        gate_result = await _check_tension_gate(current_node, resolved_dir, state)
        if gate_result and gate_result.get("blocked"):
            # Persist updated gate state (attempt count was incremented)
            save_graph_state(resolved_dir, state)
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

        # Pre-transition DCC check (optional, configured per-node)
        pre_check_result = None
        try:
            pre_check_result = await _run_pre_transition_check(
                current_node, resolved_dir, baseline_smells=state.baseline_smells
            )
        except Exception:
            pass  # Non-fatal

        if pre_check_result and pre_check_result.get("blocked"):
            return {
                "error": f"Pre-transition DCC check failed: {pre_check_result.get('reason', 'quality gate blocked')}",
                "pre_check_details": pre_check_result,
            }

        # Capture current HEAD SHA before transition (for 1C impact preview and entry tracking)
        entry_commit_sha: str | None = None
        try:
            sha_result = subprocess.run(
                ["git", "-C", resolved_dir, "rev-parse", "HEAD"],
                capture_output=True, text=True, timeout=5
            )
            if sha_result.returncode == 0:
                entry_commit_sha = sha_result.stdout.strip()
        except Exception:
            pass

        # Clean up contract stubs from the current node before leaving it.
        # Stubs that have been superseded by real implementations are removed;
        # stubs still containing original content are also removed (orphans).
        _cleanup_contract_files(current_node, resolved_dir)

        # Execute transition
        try:
            state = take_transition(graph, state, edge, reason)
            # Attach commit SHA to the PathEntry just recorded
            if entry_commit_sha and state.execution_path:
                state.execution_path[-1].commit_sha = entry_commit_sha
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

        # Write contract files for the new node before agents start working.
        contracts_written: list[str] = []
        if new_node:
            contracts_written = _write_contract_files(new_node, resolved_dir)

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

        # Store DCC result in persisted state (1G)
        if dcc_result is not None:
            state.last_dcc_result = dcc_result
            state.last_dcc_timestamp = datetime.now().isoformat()
            save_graph_state(resolved_dir, state)

        # Experience memory: auto-collect from DCC results
        experience_context: list[dict] = []
        if dcc_raw:
            try:
                _collect_experiences_from_dcc(dcc_raw, resolved_dir)
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to collect DCC experiences: {e}", file=sys.stderr)
                pass  # Non-fatal
            try:
                experience_context = _query_relevant_experiences(dcc_raw, resolved_dir)
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to query relevant experiences: {e}", file=sys.stderr)

        # Enrich with skill recommendations (2A, 2B, 2C)
        skill_recs = None
        if dcc_raw:
            try:
                detected_langs = await _detect_project_languages(resolved_dir)
                skill_recs = _enrich_smells_with_skills(dcc_raw, detected_langs)
                contextual = _select_skills_for_context(
                    skill_recs if skill_recs else {}, new_node, detected_langs
                )
                if contextual:
                    skill_recs["contextual_skills"] = contextual
            except Exception:
                pass

        # Feedback loop: record skill references (4C)
        if skill_recs:
            try:
                _record_skill_references(skill_recs, resolved_dir)
            except Exception:
                pass

        # Impact preview: simulate wave for nodes with impact_preview configured
        # Pass the previous node's entry commit SHA so diff is accurate (1C)
        prev_entry_sha: str | None = None
        if len(state.execution_path) >= 2:
            prev_entry = state.execution_path[-2]
            prev_entry_sha = prev_entry.commit_sha if hasattr(prev_entry, 'commit_sha') else None

        impact_result = None
        try:
            impact_result = await _run_impact_preview(new_node, resolved_dir, entry_sha=prev_entry_sha)
        except Exception as e:
            impact_result = {"error": str(e)}

        # Build prompt_injection, appending previous wave outputs if present
        base_prompt = new_node.prompt_injection if new_node else None
        prev_entry = state.execution_path[-2] if len(state.execution_path) >= 2 else None
        if prev_entry and prev_entry.outputs:
            output_lines = ["## Available from previous wave"]
            for k, v in prev_entry.outputs.items():
                output_lines.append(f"- **{k}**: {v}")
            outputs_section = "\n".join(output_lines)
            if base_prompt:
                prompt_injection = f"{base_prompt}\n\n{outputs_section}"
            else:
                prompt_injection = outputs_section
        else:
            prompt_injection = base_prompt

        # Conditionally inject patterns, checklist, metadata for implementation nodes
        _IMPL_KEYWORDS = {"implement", "execute", "wave", "build", "code"}
        _node_id_lower = (new_node.id if new_node else "").lower()
        if any(kw in _node_id_lower for kw in _IMPL_KEYWORDS):
            _injections: list[str] = []
            _budget = 6000

            try:
                from ..graph_state import _get_centralized_state_dir
                _state_dir = str(_get_centralized_state_dir(resolved_dir))
            except Exception:
                _state_dir = ""

            if _state_dir:
                # Pattern catalog
                try:
                    from ..pattern_catalog import PatternCatalog
                    _pc = PatternCatalog.load(resolved_dir, _state_dir)
                    if _pc:
                        _snippet = _pc.to_prompt_injection()
                        if _snippet and len(_snippet) <= 2500:
                            _injections.append(_snippet)
                            _budget -= len(_snippet)
                except Exception:
                    pass

                # Experience checklist
                try:
                    from ..experience_memory import derive_implementation_checklist, format_checklist_for_prompt
                    _task_type = "bounded_context"
                    if "feature" in _node_id_lower:
                        _task_type = "feature"
                    elif "migration" in _node_id_lower:
                        _task_type = "migration"
                    elif "endpoint" in _node_id_lower or "api" in _node_id_lower:
                        _task_type = "api_endpoint"
                    _checklist = derive_implementation_checklist(resolved_dir, task_type=_task_type)
                    if _checklist and _checklist.get("checklist"):
                        _cl_text = format_checklist_for_prompt(_checklist)
                        if _cl_text and len(_cl_text) <= min(3000, _budget):
                            _injections.append(_cl_text)
                            _budget -= len(_cl_text)
                except Exception:
                    pass

                # Project metadata (key sections only)
                try:
                    from ..project_metadata import ProjectMetadata
                    _pm = ProjectMetadata.load(resolved_dir, _state_dir)
                    if _pm:
                        _meta = _pm.get()
                        _sections = []
                        for _key in ("migration_number", "id_patterns", "bounded_contexts"):
                            if _key in _meta and _meta[_key]:
                                import json as _json
                                _sections.append(f"- **{_key}**: `{_json.dumps(_meta[_key], default=str)[:500]}`")
                        if _sections:
                            _meta_text = "## Project Metadata\n" + "\n".join(_sections)
                            if len(_meta_text) <= _budget:
                                _injections.append(_meta_text)
                                _budget -= len(_meta_text)
                except Exception:
                    pass

                # Security findings for implementation context
                try:
                    _findings_result = await _execute_dcc_tool(
                        "cube_get_findings",
                        {"status": "open", "limit": 5},
                        resolved_dir
                    )
                    if _findings_result and isinstance(_findings_result, dict):
                        _findings = _findings_result.get("findings", [])
                        if _findings and len(_findings) > 0:
                            _sec_lines = ["## Security Findings (open)"]
                            for _f in _findings[:5]:
                                _sev = _f.get("severity", "?")
                                _rule = _f.get("rule_id", "?")
                                _fpath = _f.get("file_path", "?")
                                _line = _f.get("start_line", "?")
                                _sec_lines.append(f"- [{_sev}] {_rule} in {_fpath}:{_line}")
                            _sec_lines.append("→ Use `cube_security_remediation(finding_id)` for fix guidance")
                            _sec_text = "\n".join(_sec_lines)
                            if len(_sec_text) <= _budget:
                                _injections.append(_sec_text)
                                _budget -= len(_sec_text)
                except Exception:
                    pass

            if _injections:
                _extra = "\n\n".join(_injections)
                prompt_injection = f"{prompt_injection}\n\n{_extra}" if prompt_injection else _extra

        # If new node is a DAG, compute initial ready tasks
        dag_schedule = None
        if new_node and new_node.node_type == "dag" and new_node.tasks:
            ready = compute_ready_tasks(graph, state, new_node.id)
            dag_schedule = {
                "total_tasks": len(new_node.tasks),
                "ready_tasks": [
                    {
                        "id": t.id,
                        "name": t.name,
                        "prompt": t.prompt,
                        "dependencies": t.dependencies,
                        "tools_blocked": t.tools_blocked,
                        "mcps_enabled": t.mcps_enabled,
                    }
                    for t in ready
                ],
                "hint": "Launch ready tasks as parallel subagents. Call graph_task_complete(task_id) as each finishes to unlock dependent tasks.",
            }

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
            "prompt_injection": prompt_injection,
            "dcc_analysis": dcc_result,
            "contracts_written": contracts_written,
            "dag_schedule": dag_schedule,
            "reason": reason,
            "project_dir": resolved_dir
        }

        if impact_result:
            result["impact_preview"] = impact_result

        if experience_context:
            result["experience_context"] = experience_context

        if skill_recs:
            result["skill_recommendations"] = skill_recs

        return result

    @mcp.tool()
    def graph_task_complete(
        task_id: str,
        outputs: dict[str, str] | None = None,
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        """Mark a DAG task as complete and return newly unblocked tasks.

        Call this when a subagent finishes its assigned task. The engine will
        compute which tasks are now unblocked and return them.

        Args:
            task_id: ID of the completed task
            outputs: Optional key-value outputs (forwarded to dependent tasks)
            project_dir: Project directory
            session_id: Session ID
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir,
            }

        node_id = state.get_current_node()
        current_node = graph.nodes.get(node_id) if node_id else None

        if not current_node or current_node.node_type != "dag":
            return {
                "error": True,
                "session_id": sid,
                "message": f"Current node '{node_id}' is not a DAG node",
                "project_dir": resolved_dir,
            }

        task_ids = {t.id for t in current_node.tasks}
        if task_id not in task_ids:
            return {
                "error": True,
                "session_id": sid,
                "message": f"Task '{task_id}' not found in node '{node_id}'",
                "available_tasks": list(task_ids),
                "project_dir": resolved_dir,
            }

        if state.is_task_complete(node_id, task_id):
            return {
                "error": True,
                "session_id": sid,
                "message": f"Task '{task_id}' is already complete",
                "project_dir": resolved_dir,
            }

        state.mark_task_complete(node_id, task_id, outputs)
        save_graph_state(resolved_dir, state)

        newly_ready = compute_ready_tasks(graph, state, node_id)
        is_complete = is_dag_complete(graph, state, node_id)
        completed_count = len(state.get_completed_tasks_for_node(node_id))

        return {
            "success": True,
            "session_id": sid,
            "completed": task_id,
            "newly_ready": [
                {
                    "id": t.id,
                    "name": t.name,
                    "prompt": t.prompt,
                    "dependencies": t.dependencies,
                    "tools_blocked": t.tools_blocked,
                    "mcps_enabled": t.mcps_enabled,
                }
                for t in newly_ready
            ],
            "is_dag_complete": is_complete,
            "completed_count": completed_count,
            "total_tasks": len(current_node.tasks),
            "remaining": len(current_node.tasks) - completed_count,
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def graph_get_ready_tasks(
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        """Return tasks in the current DAG node that can run now.

        Use this to check which tasks have their dependencies satisfied
        and can be launched as parallel subagents.

        Args:
            project_dir: Project directory
            session_id: Session ID
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir,
            }

        node_id = state.get_current_node()
        current_node = graph.nodes.get(node_id) if node_id else None

        if not current_node or current_node.node_type != "dag":
            return {
                "error": True,
                "session_id": sid,
                "message": f"Current node '{node_id}' is not a DAG node",
                "project_dir": resolved_dir,
            }

        ready = compute_ready_tasks(graph, state, node_id)
        completed_ids = set(state.get_completed_tasks_for_node(node_id))

        return {
            "session_id": sid,
            "node_id": node_id,
            "ready_tasks": [
                {
                    "id": t.id,
                    "name": t.name,
                    "prompt": t.prompt,
                    "dependencies": t.dependencies,
                    "tools_blocked": t.tools_blocked,
                    "mcps_enabled": t.mcps_enabled,
                }
                for t in ready
            ],
            "completed_count": len(completed_ids),
            "total_tasks": len(current_node.tasks),
            "is_dag_complete": is_dag_complete(graph, state, node_id),
            "project_dir": resolved_dir,
        }

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
        _clear_tension_gate_state(state)
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
        _clear_tension_gate_state(state, node_id)

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

        gate_state = acknowledge_tension_gate(resolved_dir, current_node_id, state)
        save_graph_state(resolved_dir, state)

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

    @mcp.tool()
    async def graph_mid_phase_dcc(
        files: list[str],
        project_dir: str | None = None,
    ) -> dict:
        """[CATEGORY: analysis] Run lightweight DCC analysis on specific files between workflow traversals.

        Use this tool when you want DCC feedback on files you've modified without
        advancing the workflow. Provides continuous quality feedback similar to
        IDE-integrated analysis.

        Args:
            files: List of file paths that were recently modified
            project_dir: Project directory (uses session default if not specified)
        """
        resolved_dir, _sid = resolve_project_dir(project_dir)

        if not _is_dcc_available():
            return {"error": "DCC (deltacodecube) MCP not configured"}

        enforcer_config = load_enforcer_config(resolved_dir)

        if not enforcer_config.get("mid_phase_dcc", False):
            return {"error": "mid_phase_dcc not enabled in config"}

        if not enforcer_config.get("dcc_injection_enabled", True):
            return {"error": "dcc_injection_enabled is False in config"}

        baseline_smells = None
        try:
            _, _mid_state = _load_active_graph(resolved_dir)
            baseline_smells = _mid_state.baseline_smells
        except Exception:
            pass

        result = await _run_mid_phase_check(resolved_dir, files, baseline_smells=baseline_smells)
        if result is None:
            return {"error": "DCC mid-phase check returned no result"}

        return result

    @mcp.tool()
    def graph_record_output(
        key: str,
        value: str,
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        """Record an output from the current workflow node.

        Agents call this to register what they produced during a phase.
        These outputs are injected into the next node's prompt when traversing.

        Example: After discovering the next migration number, call:
            graph_record_output(key="next_migration", value="000028")

        The next wave's agents will receive:
            "## Available from previous wave: next_migration = 000028"

        Args:
            key: Short identifier for the output (e.g., "migration_number", "types_file")
            value: The value to record (string)
            project_dir: Optional project directory
            session_id: Optional session ID
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        try:
            graph, state = _load_active_graph(resolved_dir)
        except (ValueError, GraphParseError) as e:
            return {
                "error": True,
                "session_id": sid,
                "message": str(e),
                "project_dir": resolved_dir,
            }

        if not state.execution_path:
            return {
                "error": True,
                "session_id": sid,
                "message": "No active path entry to record output on",
                "project_dir": resolved_dir,
            }

        last_entry = state.execution_path[-1]
        if last_entry.outputs is None:
            last_entry.outputs = {}
        last_entry.outputs[key] = value

        save_graph_state(resolved_dir, state)

        return {
            "success": True,
            "session_id": sid,
            "key": key,
            "value": value,
            "current_outputs": last_entry.outputs,
            "node": state.get_current_node(),
            "project_dir": resolved_dir,
        }
