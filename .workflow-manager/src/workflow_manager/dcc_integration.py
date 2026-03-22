"""DCC (DeltaCodeCube) integration for workflow context injection.

Handles DCC analysis execution, result summarization, tension gate logic,
impact preview simulation, and experience collection from DCC results.
"""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from .hub_config import load_mcp_configs, load_enforcer_config
from .mcp_connection import get_mcp_connection, increment_request_counter
from .experience_memory import (
    ExperienceMemoryStore, ExperienceEntry, merge_stores,
    generalize_path, extract_file_keywords, guess_domain,
    GLOBAL_MEMORY_FILE, PROJECT_MEMORIES_DIR,
)


# ============================================================================
# DCC Summarizers
# ============================================================================

def _summarize_stats(result: dict | None) -> str | None:
    """Summarize cube_get_stats result into a concise string."""
    if not result:
        return None
    try:
        # Handle content array from MCP response
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break

        if isinstance(content, dict):
            total = content.get("total_files", content.get("totalFiles", "?"))
            grade = content.get("grade", "?")
            score = content.get("codebase_score", content.get("score", "?"))
            return f"Files: {total}, Grade: {grade}, Score: {score}/100"
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to summarize stats: {e}", file=sys.stderr)
        pass
    return str(result)[:200]


def _summarize_smells(result: dict | None) -> str | None:
    """Summarize cube_detect_smells result (works with summary_only format)."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break

        if isinstance(content, dict):
            total = content.get("total_smells", 0)
            if total == 0:
                return "No smells detected"

            # Use pre-aggregated by_severity / by_type (works with summary_only)
            by_severity = content.get("by_severity", {})
            by_type = content.get("by_type", {})

            sev_order = ["critical", "high", "medium", "low"]
            sev_parts = [f"{by_severity[s]} {s}" for s in sev_order if by_severity.get(s)]
            type_parts = [f"{t}: {c}" for t, c in sorted(by_type.items())]

            summary = f"{total} smells ({', '.join(sev_parts)})"
            if type_parts:
                summary += f" — {', '.join(type_parts)}"
            summary += ". Use cube_detect_smells(smell_type=...) for details"
            return summary
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to summarize smells: {e}", file=sys.stderr)
        pass
    return str(result)[:200]


def _summarize_tensions(result: dict | None) -> str | None:
    """Summarize cube_get_tensions result."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break

        if isinstance(content, dict):
            tensions = content.get("tensions", [])
            total = len(tensions)
            if total == 0:
                return "No tensions detected"
            types = {}
            for t in tensions:
                tt = t.get("type", "unknown")
                types[tt] = types.get(tt, 0) + 1
            parts = [f"{c} {t}" for t, c in sorted(types.items())]
            return f"{total} tensions ({', '.join(parts)})"
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to summarize tensions: {e}", file=sys.stderr)
        pass
    return str(result)[:200]


def _summarize_debt(result: dict | None) -> str | None:
    """Summarize cube_get_debt result."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break

        if isinstance(content, dict):
            grade = content.get("grade", "?")
            score = content.get("codebase_score", content.get("score", "?"))
            hotspots = content.get("all_files", [])
            n_hotspots = len([f for f in hotspots if isinstance(f, dict) and f.get("score", 0) > 60])
            return f"Grade: {grade}, Score: {score}/100, Hotspots: {n_hotspots} files"
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to summarize debt: {e}", file=sys.stderr)
        pass
    return str(result)[:200]


_DCC_SUMMARIZERS = {
    "stats": ("cube_get_stats", {}, _summarize_stats),
    "smells": ("cube_detect_smells", {"summary_only": True}, _summarize_smells),
    "tensions": ("cube_get_tensions", {"limit": 10}, _summarize_tensions),
    "debt": ("cube_get_debt", {}, _summarize_debt),
}


# ============================================================================
# Severity and Tension Gate State
# ============================================================================

_SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}

# Key: (project_dir, node_id) -> {"attempts": int, "acknowledged": bool}
_tension_gate_state: dict[tuple[str, str], dict] = {}


# ============================================================================
# Experience Memory Integration
# ============================================================================

_experience_store: ExperienceMemoryStore | None = None


def _get_experience_store() -> ExperienceMemoryStore:
    """Lazy-load the global experience memory store."""
    global _experience_store
    if _experience_store is None:
        _experience_store = ExperienceMemoryStore()
        _experience_store.load("global")
    return _experience_store


def _get_project_experience_store(project_dir: str) -> ExperienceMemoryStore:
    """Load project-scoped experience store."""
    project_name = Path(project_dir).name
    store = ExperienceMemoryStore()
    store.load("project", project_name)
    return store


def get_experience_store() -> ExperienceMemoryStore:
    """Public accessor for global experience store."""
    return _get_experience_store()


def get_project_experience_store(project_dir: str) -> ExperienceMemoryStore:
    """Public accessor for project experience store."""
    return _get_project_experience_store(project_dir)


# ============================================================================
# DCC Tool Execution
# ============================================================================

async def _execute_dcc_tool(tool_name: str, args: dict, project_dir: str) -> dict | None:
    """Execute a DeltaCodeCube tool via the MCP connection pool.

    Reuses the same McpConnection infrastructure as execute_mcp_tool().

    Returns:
        Tool result dict, or None on failure.
    """
    conn = await get_mcp_connection("deltacodecube")
    if not conn:
        return None

    request_id = increment_request_counter()
    try:
        response = await conn.call_tool(tool_name, args, request_id)
        if "error" in response:
            return None
        return response.get("result", response)
    except Exception as e:
        print(f"[DCC Context] Error calling {tool_name}: {e}", file=sys.stderr)
        return None


def _extract_mcp_content(result: dict | None) -> dict | list | None:
    """Unwrap MCP content array to get the parsed JSON payload."""
    if not result:
        return None
    try:
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    return json.loads(item["text"])
        return result
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to unwrap MCP result: {e}", file=sys.stderr)
        return result


def _extract_tensions(result: dict | None) -> list[dict]:
    """Extract tension list from DCC cube_get_tensions MCP response."""
    if not result:
        return []
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break
        if isinstance(content, dict):
            return content.get("tensions", [])
        if isinstance(content, list):
            return content
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to extract tensions: {e}", file=sys.stderr)
        pass
    return []


# ============================================================================
# Experience Collection from DCC Results
# ============================================================================

def _collect_experiences_from_dcc(raw_results: dict, project_dir: str) -> None:
    """Extract experiences from DCC analysis raw results and record them.

    raw_results: {analysis_name: raw_mcp_response}
    """
    global_store = _get_experience_store()
    project_name = Path(project_dir).name
    project_store = _get_project_experience_store(project_dir)

    now = datetime.now().isoformat()
    recorded_any = False

    # Extract tensions
    if "tensions" in raw_results and raw_results["tensions"]:
        content = _extract_mcp_content(raw_results["tensions"])
        tensions = []
        if isinstance(content, dict):
            tensions = content.get("tensions", [])
        elif isinstance(content, list):
            tensions = content

        for t in tensions:
            source = t.get("source", t.get("file", ""))
            if not source:
                continue

            entry = ExperienceEntry(
                type="tension_caused",
                file_pattern=generalize_path(source),
                keywords=extract_file_keywords(source),
                domain=guess_domain(source),
                description=t.get("description", t.get("message", ""))[:300],
                severity=t.get("severity", "medium"),
                project_origin=project_name,
                related_files=[f for f in [t.get("target", t.get("related_file"))] if f],
                scope="project",
                first_seen=now,
            )
            project_store.record(entry)

            # Also record globally (with global scope)
            global_entry = ExperienceEntry(
                type="tension_caused",
                file_pattern=entry.file_pattern,
                keywords=entry.keywords,
                domain=entry.domain,
                description=entry.description,
                severity=entry.severity,
                project_origin=project_name,
                related_files=entry.related_files,
                scope="global",
                first_seen=now,
            )
            global_store.record(global_entry)
            recorded_any = True

    # Extract smells
    if "smells" in raw_results and raw_results["smells"]:
        content = _extract_mcp_content(raw_results["smells"])
        if isinstance(content, dict):
            smells = content.get("smells", [])
            for s in smells:
                source = s.get("file", s.get("source", ""))
                if not source:
                    continue

                entry = ExperienceEntry(
                    type="smell_introduced",
                    file_pattern=generalize_path(source),
                    keywords=extract_file_keywords(source),
                    domain=guess_domain(source),
                    description=f"{s.get('type', 'unknown')}: {s.get('description', '')}",
                    severity=s.get("severity", "medium"),
                    project_origin=project_name,
                    scope="project",
                    first_seen=now,
                )
                project_store.record(entry)

                global_entry = ExperienceEntry(
                    type="smell_introduced",
                    file_pattern=entry.file_pattern,
                    keywords=entry.keywords,
                    domain=entry.domain,
                    description=entry.description,
                    severity=entry.severity,
                    project_origin=project_name,
                    scope="global",
                    first_seen=now,
                )
                global_store.record(global_entry)
                recorded_any = True

    if recorded_any:
        try:
            project_store.save()
            global_store.save()
        except Exception as e:
            print(f"[workflow-manager] Experience save failed (non-fatal): {e}", file=sys.stderr)


def _collect_gate_blocked(project_dir: str, node_id: str,
                          blocking_tensions: list[dict], severity: str) -> None:
    """Record a gate-blocked experience."""
    project_name = Path(project_dir).name
    global_store = _get_experience_store()
    project_store = _get_project_experience_store(project_dir)

    # Build description from blocking tensions
    tension_descs = [t.get("description", t.get("type", "unknown"))[:100] for t in blocking_tensions[:3]]
    desc = f"Gate blocked at node '{node_id}': {'; '.join(tension_descs)}"

    files = [t.get("source", t.get("file", "")) for t in blocking_tensions if t.get("source") or t.get("file")]

    for store, scope in [(project_store, "project"), (global_store, "global")]:
        for f in files[:3]:
            if f:
                entry = ExperienceEntry(
                    type="gate_blocked",
                    file_pattern=generalize_path(f),
                    keywords=extract_file_keywords(f),
                    domain=guess_domain(f),
                    description=desc[:300],
                    severity=severity,
                    project_origin=project_name,
                    related_files=[rf for rf in files if rf != f][:5],
                    scope=scope,
                )
                store.record(entry)

    try:
        project_store.save()
        global_store.save()
    except Exception as e:
        print(f"[workflow-manager] Experience gate_blocked save failed: {e}", file=sys.stderr)


def _collect_gate_resolved(project_dir: str, node_id: str, attempts: int) -> None:
    """Record a gate-resolved experience (gate passed after previous blocks)."""
    project_name = Path(project_dir).name
    global_store = _get_experience_store()
    project_store = _get_project_experience_store(project_dir)

    desc = f"Gate resolved at node '{node_id}' after {attempts} attempt(s)"

    for store, scope in [(project_store, "project"), (global_store, "global")]:
        entry = ExperienceEntry(
            type="gate_resolved",
            file_pattern=f"workflow/{node_id}",
            keywords=[node_id.replace("_", " ").replace("-", " ").split()[0]],
            domain="config",
            description=desc,
            severity="low",
            project_origin=project_name,
            scope=scope,
        )
        store.record(entry)

    try:
        project_store.save()
        global_store.save()
    except Exception as e:
        print(f"[workflow-manager] Experience gate_resolved save failed: {e}", file=sys.stderr)


# ============================================================================
# DCC Analysis Execution
# ============================================================================

def _is_dcc_available() -> bool:
    """Check if deltacodecube MCP is configured (without starting it)."""
    configs = load_mcp_configs()
    return "deltacodecube" in configs


_DCC_DEFAULT_ANALYSES = ["stats", "smells"]
_DCC_DEFAULT_TOKEN_BUDGET = 400


def _resolve_dcc_config(node, enforcer_config: dict) -> tuple[bool, list[str], int]:
    """Resolve DCC injection config for a node.

    Returns: (should_run, analyses, token_budget)

    Priority:
    1. DCC MCP not available -> skip
    2. enforcer_config["dcc_injection_enabled"] == False -> skip
    3. node.dcc_context.enabled == False -> skip (per-node opt-out)
    4. node.dcc_context exists with analyses -> use those
    5. No per-node config -> use defaults
    """
    if not _is_dcc_available():
        return False, [], 0

    if not enforcer_config.get("dcc_injection_enabled", True):
        return False, [], 0

    if node and node.dcc_context:
        if not node.dcc_context.get("enabled", True):
            return False, [], 0
        analyses = node.dcc_context.get("analyses", _DCC_DEFAULT_ANALYSES)
        budget = node.dcc_context.get("token_budget", _DCC_DEFAULT_TOKEN_BUDGET)
        return True, analyses, budget

    return True, _DCC_DEFAULT_ANALYSES, _DCC_DEFAULT_TOKEN_BUDGET


async def _run_dcc_reindex(project_dir: str) -> dict | None:
    """Reindex the project directory in DeltaCodeCube before analysis.

    Calls cube_index_directory to ensure DCC has fresh data for any files
    that were created, modified, or deleted since the last indexing.

    Returns:
        Reindex result dict, or None on failure.
    """
    try:
        result = await _execute_dcc_tool("cube_index_directory", {
            "path": project_dir,
            "patterns": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.css"],
        }, project_dir)
        if result:
            print(f"[workflow-manager] DCC reindex: {project_dir}", file=sys.stderr)
        return result
    except Exception as e:
        print(f"[workflow-manager] DCC reindex failed (non-fatal): {e}", file=sys.stderr)
        return None


async def _run_dcc_analysis(analyses: list[str], token_budget: int,
                           project_dir: str) -> tuple[dict | None, dict]:
    """Execute DCC analyses and return (summaries, raw_results).

    Automatically reindexes the project before running analyses to ensure
    results reflect the current state of the codebase.

    Args:
        analyses: List of analysis names to run (e.g. ["stats", "smells"]).
        token_budget: Approximate token budget for the combined output.
        project_dir: Project directory for DCC tool calls.

    Returns:
        Tuple of (summaries_dict, raw_results_dict).
        summaries_dict: analysis_name -> summary string, or None.
        raw_results_dict: analysis_name -> raw MCP response (for experience collection).
    """
    if not analyses:
        return None, {}

    # Reindex project so analyses reflect current codebase state
    await _run_dcc_reindex(project_dir)

    results = {}
    raw_results = {}
    total_chars = 0

    for analysis_name in analyses:
        if analysis_name not in _DCC_SUMMARIZERS:
            results[analysis_name] = f"Unknown analysis: {analysis_name}"
            continue

        tool_name, default_args, summarizer = _DCC_SUMMARIZERS[analysis_name]
        raw = await _execute_dcc_tool(tool_name, default_args, project_dir)
        raw_results[analysis_name] = raw
        summary = summarizer(raw)
        if summary:
            # Rough token budget check (1 token ~ 4 chars)
            if total_chars + len(summary) > token_budget * 4:
                results[analysis_name] = summary[:max(50, token_budget * 4 - total_chars)] + "..."
                break
            results[analysis_name] = summary
            total_chars += len(summary)

    return (results if results else None), raw_results


# ============================================================================
# Tension Gate Logic
# ============================================================================

def _summarize_fix_suggestion(result: dict | None) -> str | None:
    """Parse cube_suggest_fix result into actionable text."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break
        if isinstance(content, dict):
            fix = content.get("suggestion", content.get("fix", ""))
            files = content.get("files", content.get("affected_files", []))
            if fix:
                summary = str(fix)[:300]
                if files:
                    summary += f" (files: {', '.join(str(f) for f in files[:3])})"
                return summary
        return str(content)[:300]
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to summarize fix suggestion: {e}", file=sys.stderr)
        return str(result)[:200]


async def _check_tension_gate(node, project_dir: str) -> dict | None:
    """Check tension gate for a node before allowing transition out.

    Returns None if no gate or gate allows passage.
    Returns dict with blocking details if tensions prevent traversal.
    """
    if not node or not node.dcc_context:
        return None

    gate_config = node.dcc_context.get("tension_gate")
    if not gate_config or not gate_config.get("enabled", False):
        return None

    gate_key = (project_dir, node.id)
    gate_state = _tension_gate_state.setdefault(gate_key, {"attempts": 0, "acknowledged": False})

    # Escape hatches
    if gate_state["acknowledged"]:
        return None
    max_retries = gate_config.get("max_retries", 5)
    if gate_state["attempts"] >= max_retries:
        return {"blocked": False, "auto_escaped": True, "attempts": gate_state["attempts"]}

    # Run DCC analysis
    min_severity = gate_config.get("min_severity", "medium")
    min_sev_level = _SEVERITY_ORDER.get(min_severity, 1)

    await _run_dcc_reindex(project_dir)
    raw_tensions = await _execute_dcc_tool("cube_get_tensions", {"status": "detected"}, project_dir)
    tensions = _extract_tensions(raw_tensions)

    # Filter by severity
    blocking = [
        t for t in tensions
        if _SEVERITY_ORDER.get(t.get("severity", "low"), 0) >= min_sev_level
    ]

    if not blocking:
        # Gate passed -- record resolution if there were previous attempts
        if gate_state["attempts"] > 0:
            try:
                _collect_gate_resolved(project_dir, node.id, gate_state["attempts"])
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to collect gate_resolved experience: {e}", file=sys.stderr)
                pass
        return None

    gate_state["attempts"] += 1

    # Experience memory: record gate blocked
    try:
        _collect_gate_blocked(project_dir, node.id, blocking, min_severity)
    except Exception as e:
        print(f"[workflow-manager] Warning: failed to collect gate_blocked experience: {e}", file=sys.stderr)
        pass  # Non-fatal

    result = {
        "blocked": True,
        "attempts": gate_state["attempts"],
        "max_retries": max_retries,
        "remaining_retries": max_retries - gate_state["attempts"],
        "blocking_tensions": len(blocking),
        "min_severity": min_severity,
        "tensions": [
            {
                "type": t.get("type", "unknown"),
                "severity": t.get("severity", "unknown"),
                "source": t.get("source", t.get("file", "?")),
                "target": t.get("target", t.get("related_file", "?")),
                "description": t.get("description", t.get("message", ""))[:200],
            }
            for t in blocking[:5]
        ],
    }

    # Optionally get fix suggestions
    if gate_config.get("suggest_fixes", False):
        max_suggestions = gate_config.get("max_fix_suggestions", 3)
        suggestions = []
        for t in blocking[:max_suggestions]:
            source = t.get("source", t.get("file"))
            if source:
                fix_result = await _execute_dcc_tool("cube_suggest_fix", {"file": source}, project_dir)
                suggestion = _summarize_fix_suggestion(fix_result)
                if suggestion:
                    suggestions.append({"file": source, "suggestion": suggestion})
        if suggestions:
            result["fix_suggestions"] = suggestions

    return result


def _clear_tension_gate_state(project_dir: str, node_id: str | None = None) -> None:
    """Clear tension gate state for a project (optionally for a specific node)."""
    if node_id:
        _tension_gate_state.pop((project_dir, node_id), None)
    else:
        keys_to_remove = [k for k in _tension_gate_state if k[0] == project_dir]
        for k in keys_to_remove:
            del _tension_gate_state[k]


def _get_tension_gate_info(node, project_dir: str, node_id: str | None) -> dict | None:
    """Get tension gate status info for graph_status()."""
    if not node or not node.dcc_context:
        return None
    gate_config = node.dcc_context.get("tension_gate")
    if not gate_config or not gate_config.get("enabled", False):
        return None
    gate_key = (project_dir, node_id) if node_id else None
    gate_state = _tension_gate_state.get(gate_key, {"attempts": 0, "acknowledged": False}) if gate_key else None
    return {
        "enabled": True,
        "min_severity": gate_config.get("min_severity", "medium"),
        "max_retries": gate_config.get("max_retries", 5),
        "attempts": gate_state["attempts"] if gate_state else 0,
        "acknowledged": gate_state["acknowledged"] if gate_state else False,
        "suggest_fixes": gate_config.get("suggest_fixes", False),
    }


def acknowledge_tension_gate(project_dir: str, node_id: str) -> dict:
    """Mark tension gate as acknowledged for a specific node."""
    gate_key = (project_dir, node_id)
    gate_state = _tension_gate_state.setdefault(gate_key, {"attempts": 0, "acknowledged": False})
    gate_state["acknowledged"] = True
    return gate_state


# ============================================================================
# Impact Preview (Mejora 2: Impact Simulation Pre-Refactor)
# ============================================================================

async def _run_impact_preview(node, project_dir: str) -> dict | None:
    """Run impact simulation preview when entering a node with impact_preview configured.

    Uses cube_simulate_wave on recently changed files to predict which areas
    of the codebase are at risk from upcoming changes.

    Returns:
        Dict with impact analysis or None if not configured/available.
    """
    if not node or not node.dcc_context:
        return None

    preview_config = node.dcc_context.get("impact_preview")
    if not preview_config or not preview_config.get("enabled", False):
        return None

    if not _is_dcc_available():
        return None

    max_hops = preview_config.get("max_hops", 3)
    risk_threshold = preview_config.get("risk_threshold", "medium")
    risk_level = _SEVERITY_ORDER.get(risk_threshold, 1)

    try:
        # Get recently changed files from git
        git_result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~3"],
            cwd=project_dir, capture_output=True, text=True, timeout=10
        )
        changed_files = [f.strip() for f in git_result.stdout.strip().split("\n") if f.strip()]

        if not changed_files:
            # Fallback: get files from DCC tensions
            raw_tensions = await _execute_dcc_tool("cube_get_tensions", {"limit": 5}, project_dir)
            tensions = _extract_tensions(raw_tensions)
            changed_files = list({t.get("source", t.get("file", "")) for t in tensions if t.get("source") or t.get("file")})

        if not changed_files:
            return None

        # Run wave simulation on top changed files (max 5)
        wave_results = []
        for file_path in changed_files[:5]:
            wave = await _execute_dcc_tool("cube_simulate_wave", {
                "file": file_path,
                "max_hops": max_hops,
            }, project_dir)
            if wave:
                wave_results.append({"source_file": file_path, "wave": wave})

        if not wave_results:
            return None

        # Aggregate impact
        files_at_risk = set()
        risk_details = []
        for wr in wave_results:
            wave_data = wr["wave"]
            content = wave_data
            if isinstance(wave_data, dict) and "content" in wave_data:
                for item in wave_data["content"]:
                    if item.get("type") == "text":
                        try:
                            content = json.loads(item["text"])
                        except Exception as e:
                            print(f"[workflow-manager] Warning: failed to parse wave data JSON: {e}", file=sys.stderr)
                            content = wave_data
                        break

            affected = []
            if isinstance(content, dict):
                affected = content.get("affected_files", content.get("wave", content.get("ripple", [])))
            elif isinstance(content, list):
                affected = content

            for af in affected:
                if isinstance(af, dict):
                    sev = _SEVERITY_ORDER.get(af.get("risk", af.get("severity", "low")), 0)
                    if sev >= risk_level:
                        fname = af.get("file", af.get("path", "?"))
                        files_at_risk.add(fname)
                        risk_details.append({
                            "file": fname,
                            "risk": af.get("risk", af.get("severity", "unknown")),
                            "reason": af.get("reason", af.get("description", ""))[:150],
                            "from": wr["source_file"],
                        })
                elif isinstance(af, str):
                    files_at_risk.add(af)

        if not files_at_risk and not risk_details:
            return {"risk_level": "low", "message": "No significant impact detected"}

        return {
            "files_at_risk": len(files_at_risk),
            "risk_threshold": risk_threshold,
            "changed_files_analyzed": len(wave_results),
            "details": risk_details[:10],
            "review_order": list(files_at_risk)[:10],
        }

    except Exception as e:
        return {"error": f"Impact preview failed: {e}"}
