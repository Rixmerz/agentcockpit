"""DCC (DeltaCodeCube) integration for workflow context injection.

Handles DCC analysis execution, result summarization, tension gate logic,
impact preview simulation, and experience collection from DCC results.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .graph_engine import Node

from .hub_config import load_mcp_configs, load_enforcer_config
from .mcp_connection import get_mcp_connection, increment_request_counter
from .experience_memory import (
    ExperienceMemoryStore, ExperienceEntry, merge_stores,
    generalize_path, extract_file_keywords, guess_domain,
    compute_relevance,
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


# ============================================================================
# Skills Bridge — Language Detection and Smell-to-Skill Mapping
# ============================================================================

_EXT_LANGUAGE_MAP: dict[str, str] = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".php": "php",
    ".swift": "swift",
    ".lua": "lua",
    ".cs": "csharp",
    ".kt": "kotlin", ".kts": "kotlin",
}

_SMELL_SKILL_MAP: dict[str, dict] = {
    "god_file": {"skills": ["dev-patterns"], "section": "design-patterns.md#single-responsibility"},
    "circular_dependency": {"skills": ["dev-patterns"], "section": "architecture.md#dependency-inversion"},
    "feature_envy": {"skills": ["dev-patterns"], "section": "design-patterns.md#encapsulation"},
    "hub_overload": {"skills": ["dev-patterns"], "section": "architecture.md#facade-pattern"},
    "dead_code_candidate": {"skills": ["qa-patterns"], "section": "best-practices.md#dead-code"},
    "orphan": {"skills": ["dev-patterns"], "section": "architecture.md#module-organization"},
    "unstable_interface": {"skills": ["dev-patterns"], "section": "design-patterns.md#interface-segregation"},
}


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


def _query_relevant_experiences(raw_results: dict, project_dir: str) -> list[dict]:
    """Extract file paths from DCC results, query experience stores for relevant past entries.

    Args:
        raw_results: {analysis_name: raw_mcp_response} from _run_dcc_analysis.
        project_dir: Project directory path.

    Returns:
        List of up to 5 experience dicts with score > 0.10, sorted by relevance.
    """
    try:
        # Collect unique file paths from smells and tensions in raw_results
        file_paths: set[str] = set()

        if "tensions" in raw_results and raw_results["tensions"]:
            content = _extract_mcp_content(raw_results["tensions"])
            tensions = []
            if isinstance(content, dict):
                tensions = content.get("tensions", [])
            elif isinstance(content, list):
                tensions = content
            for t in tensions:
                for key in ("source", "file", "target", "related_file"):
                    val = t.get(key)
                    if val and isinstance(val, str):
                        file_paths.add(val)

        if "smells" in raw_results and raw_results["smells"]:
            content = _extract_mcp_content(raw_results["smells"])
            if isinstance(content, dict):
                smells = content.get("smells", [])
                for s in smells:
                    for key in ("file", "source"):
                        val = s.get(key)
                        if val and isinstance(val, str):
                            file_paths.add(val)

        if not file_paths:
            return []

        # Load and merge global + project stores
        global_store = _get_experience_store()
        project_store = _get_project_experience_store(project_dir)
        merged_entries = merge_stores(global_store, project_store)

        # Score each experience against each file path, take max score per entry
        best_scores: dict[str, tuple] = {}  # entry.id -> (score, entry)
        for entry in merged_entries:
            max_score = 0.0
            for fp in file_paths:
                score = compute_relevance(entry, fp)
                if score > max_score:
                    max_score = score
            if max_score > 0.10:
                best_scores[entry.id] = (max_score, entry)

        # Sort by score descending and return top 5
        ranked = sorted(best_scores.values(), key=lambda x: x[0], reverse=True)[:5]
        return [
            {
                "id": entry.id,
                "type": entry.type,
                "file_pattern": entry.file_pattern,
                "description": entry.description,
                "severity": entry.severity,
                "confidence": round(entry.confidence, 3),
                "occurrences": entry.occurrences,
                "relevance_score": round(score, 3),
                "last_seen": entry.last_seen,
            }
            for score, entry in ranked
        ]
    except Exception as e:
        print(f"[workflow-manager] Warning: _query_relevant_experiences failed: {e}", file=sys.stderr)
        return []


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


async def _run_dcc_reindex_incremental(project_dir: str, since_sha: str | None = None) -> dict | None:
    """Incrementally reindex the project directory in DeltaCodeCube.

    If a since_sha is provided and <=20 files changed, indexes only those
    files via cube_index_file. Falls back to full cube_index_directory otherwise.

    Args:
        project_dir: Project directory to reindex.
        since_sha: Git SHA to diff against (uses HEAD~1 if None).

    Returns:
        Reindex result dict, or None on failure.
    """
    try:
        # Get list of changed files via git diff
        since_ref = since_sha if since_sha else "HEAD~1"
        git_result = subprocess.run(
            ["git", "-C", project_dir, "diff", "--name-only", since_ref],
            capture_output=True, text=True, timeout=10
        )
        changed_files = [f.strip() for f in git_result.stdout.strip().split("\n") if f.strip()]
        git_ok = git_result.returncode == 0 and bool(changed_files)

        if git_ok and len(changed_files) <= 20:
            # Incremental: index only changed files
            last_result = None
            for f in changed_files:
                file_path = str(Path(project_dir) / f)
                result = await _execute_dcc_tool("cube_index_file", {"path": file_path}, project_dir)
                if result:
                    last_result = result
            print(f"[workflow-manager] DCC incremental reindex: {len(changed_files)} files in {project_dir}", file=sys.stderr)
            return last_result
        else:
            # Full reindex fallback
            result = await _execute_dcc_tool("cube_index_directory", {
                "path": project_dir,
                "patterns": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.css"],
            }, project_dir)
            if result:
                print(f"[workflow-manager] DCC full reindex: {project_dir}", file=sys.stderr)
            return result
    except Exception as e:
        print(f"[workflow-manager] DCC reindex failed (non-fatal): {e}", file=sys.stderr)
        return None


async def _run_dcc_reindex(project_dir: str) -> dict | None:
    """Backward-compatible alias for _run_dcc_reindex_incremental with no SHA."""
    return await _run_dcc_reindex_incremental(project_dir, since_sha=None)


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

    # Reindex project so analyses reflect current codebase state (incremental)
    await _run_dcc_reindex_incremental(project_dir)

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


async def _check_tension_gate(node, project_dir: str, state=None) -> dict | None:
    """Check tension gate for a node before allowing transition out.

    Returns None if no gate or gate allows passage.
    Returns dict with blocking details if tensions prevent traversal.

    Args:
        node: Current graph Node object.
        project_dir: Project directory path.
        state: GraphState object for persisted gate state (optional for backward compat).
    """
    if not node or not node.dcc_context:
        return None

    gate_config = node.dcc_context.get("tension_gate")
    if not gate_config or not gate_config.get("enabled", False):
        return None

    node_id = node.id

    # Use persisted state if provided, otherwise fall back to empty default
    if state is not None:
        if node_id not in state.tension_gate_state:
            state.tension_gate_state[node_id] = {"attempts": 0, "acknowledged": False}
        gate_state = state.tension_gate_state[node_id]
    else:
        # Fallback: ephemeral dict (backward compat when state not passed)
        gate_state = {"attempts": 0, "acknowledged": False}

    # Escape hatches
    if gate_state["acknowledged"]:
        return None
    max_retries = gate_config.get("max_retries", 5)
    if gate_state["attempts"] >= max_retries:
        return {"blocked": False, "auto_escaped": True, "attempts": gate_state["attempts"]}

    # Run DCC analysis
    min_severity = gate_config.get("min_severity", "medium")
    min_sev_level = _SEVERITY_ORDER.get(min_severity, 1)

    await _run_dcc_reindex_incremental(project_dir)
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
                _collect_gate_resolved(project_dir, node_id, gate_state["attempts"])
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to collect gate_resolved experience: {e}", file=sys.stderr)
                pass
        return None

    gate_state["attempts"] += 1

    # Experience memory: record gate blocked
    try:
        _collect_gate_blocked(project_dir, node_id, blocking, min_severity)
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


def _clear_tension_gate_state(state_or_project_dir, node_id: str | None = None) -> None:
    """Clear tension gate state for a project (optionally for a specific node).

    Args:
        state_or_project_dir: GraphState object (preferred) or project_dir string (legacy).
        node_id: Optional node ID to clear only that node's state.
    """
    from .graph_engine import GraphState
    if isinstance(state_or_project_dir, GraphState):
        state = state_or_project_dir
        if node_id:
            state.tension_gate_state.pop(node_id, None)
        else:
            state.tension_gate_state.clear()
    # Legacy string path: no-op since global dict no longer exists


def _get_tension_gate_info(node, project_dir: str, node_id: str | None, state=None) -> dict | None:
    """Get tension gate status info for graph_status().

    Args:
        node: Current graph Node object.
        project_dir: Project directory (unused, kept for signature compat).
        node_id: Current node ID.
        state: GraphState for persisted gate state.
    """
    if not node or not node.dcc_context:
        return None
    gate_config = node.dcc_context.get("tension_gate")
    if not gate_config or not gate_config.get("enabled", False):
        return None
    gate_state = None
    if state is not None and node_id:
        gate_state = state.tension_gate_state.get(node_id)
    return {
        "enabled": True,
        "min_severity": gate_config.get("min_severity", "medium"),
        "max_retries": gate_config.get("max_retries", 5),
        "attempts": gate_state["attempts"] if gate_state else 0,
        "acknowledged": gate_state["acknowledged"] if gate_state else False,
        "suggest_fixes": gate_config.get("suggest_fixes", False),
    }


def acknowledge_tension_gate(project_dir: str, node_id: str, state=None) -> dict:
    """Mark tension gate as acknowledged for a specific node.

    Args:
        project_dir: Project directory (kept for signature compat).
        node_id: Node ID to acknowledge.
        state: GraphState object for persisted gate state.
    """
    if state is not None:
        if node_id not in state.tension_gate_state:
            state.tension_gate_state[node_id] = {"attempts": 0, "acknowledged": False}
        state.tension_gate_state[node_id]["acknowledged"] = True
        return state.tension_gate_state[node_id]
    # Fallback: return a dummy state dict
    return {"attempts": 0, "acknowledged": True}


# ============================================================================
# Impact Preview (Mejora 2: Impact Simulation Pre-Refactor)
# ============================================================================

async def _run_impact_preview(node, project_dir: str, entry_sha: str | None = None) -> dict | None:
    """Run impact simulation preview when entering a node with impact_preview configured.

    Uses cube_simulate_wave on recently changed files to predict which areas
    of the codebase are at risk from upcoming changes.

    Args:
        node: Current graph Node object.
        project_dir: Project directory path.
        entry_sha: Git SHA when the previous node was entered. If provided,
                   uses git diff {entry_sha}..HEAD to find changed files instead
                   of the default HEAD~3 fallback.

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
        if entry_sha:
            diff_ref = f"{entry_sha}..HEAD"
        else:
            diff_ref = "HEAD~3"
        git_result = subprocess.run(
            ["git", "diff", "--name-only", diff_ref],
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


# ============================================================================
# Skills Bridge — Runtime Functions
# ============================================================================

async def _detect_project_languages(project_dir: str) -> list[str]:
    """Detect top-3 languages by file count from DCC indexed files."""
    try:
        raw = await _execute_dcc_tool("cube_list_code_points", {"limit": 200}, project_dir)
        if not raw:
            return []

        content = _extract_mcp_content(raw)
        if not content:
            return []

        # Extract file paths from the result — try common response shapes
        file_paths: list[str] = []
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    path = item.get("file", item.get("path", item.get("name", "")))
                    if path:
                        file_paths.append(str(path))
                elif isinstance(item, str):
                    file_paths.append(item)
        elif isinstance(content, dict):
            for key in ("files", "code_points", "items", "results"):
                items = content.get(key, [])
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict):
                            path = item.get("file", item.get("path", item.get("name", "")))
                            if path:
                                file_paths.append(str(path))
                        elif isinstance(item, str):
                            file_paths.append(item)
                    if file_paths:
                        break

        if not file_paths:
            return []

        # Count extensions and map to language names
        ext_counts: dict[str, int] = {}
        for fp in file_paths:
            ext = Path(fp).suffix.lower()
            lang = _EXT_LANGUAGE_MAP.get(ext)
            if lang:
                ext_counts[lang] = ext_counts.get(lang, 0) + 1

        if not ext_counts:
            return []

        # Return top-3 languages sorted by count
        sorted_langs = sorted(ext_counts.items(), key=lambda x: x[1], reverse=True)
        return [lang for lang, _ in sorted_langs[:3]]

    except Exception as e:
        print(f"[workflow-manager] Warning: _detect_project_languages failed: {e}", file=sys.stderr)
        return []


def _enrich_smells_with_skills(raw_results: dict, detected_languages: list[str]) -> dict:
    """Map detected smells to relevant skill sections for contextual recommendations."""
    recommendations: list[dict] = []
    seen_smell_types: set[str] = set()

    # Extract smell types from raw DCC results
    if "smells" in raw_results and raw_results["smells"]:
        content = _extract_mcp_content(raw_results["smells"])
        if isinstance(content, dict):
            # Try by_type first (summary_only format)
            by_type = content.get("by_type", {})
            if by_type:
                for smell_type in by_type:
                    seen_smell_types.add(smell_type)

            # Also scan full smells list if present
            smells_list = content.get("smells", [])
            for s in smells_list:
                smell_type = s.get("type", s.get("smell_type", ""))
                if smell_type:
                    seen_smell_types.add(smell_type)

    # Build recommendations from smell-to-skill mapping
    all_skills: list[str] = []
    for smell_type in seen_smell_types:
        mapping = _SMELL_SKILL_MAP.get(smell_type)
        if mapping:
            rec = {
                "smell_type": smell_type,
                "skills": list(mapping["skills"]),
                "section": mapping.get("section", ""),
            }
            recommendations.append(rec)
            all_skills.extend(mapping["skills"])

    # Add language-specific skills
    language_skills: list[str] = []
    for lang in detected_languages:
        skill_name = f"{lang}-patterns"
        if skill_name not in language_skills:
            language_skills.append(skill_name)

    # Deduplicate all_skills
    seen: set[str] = set()
    deduped_skills: list[str] = []
    for s in all_skills:
        if s not in seen:
            seen.add(s)
            deduped_skills.append(s)

    return {
        "recommendations": recommendations,
        "language_skills": language_skills,
        "all_skills": deduped_skills,
    }


def _select_skills_for_context(
    dcc_result: dict,
    node: object,
    detected_languages: list[str],
) -> list[dict]:
    """Select most relevant skill sections based on DCC results, node type, and languages."""
    selected: list[dict] = []

    # 1. Language-based skills
    for lang in detected_languages:
        skill_name = f"{lang}-patterns"
        selected.append({
            "skill": skill_name,
            "section": "",
            "reason": f"Primary project language: {lang}",
        })

    # 2. Node-keyword-based skills
    node_id = getattr(node, "id", "") or ""
    prompt_injection = getattr(node, "prompt_injection", "") or ""
    node_text = (node_id + " " + prompt_injection).lower()

    if any(kw in node_text for kw in ("review", "validate", "audit", "check")):
        selected.append({
            "skill": "dev-patterns",
            "section": "architecture.md",
            "reason": "Node context: review/validation phase",
        })

    if any(kw in node_text for kw in ("test", "verify", "qa", "spec")):
        selected.append({
            "skill": "qa-patterns",
            "section": "best-practices.md",
            "reason": "Node context: testing/verification phase",
        })

    if any(kw in node_text for kw in ("implement", "develop", "build", "create", "code")):
        selected.append({
            "skill": "dev-patterns",
            "section": "design-patterns.md",
            "reason": "Node context: implementation phase",
        })

    # 3. Smell-based skills from dcc_result enrichment
    for rec in dcc_result.get("recommendations", []):
        for skill_name in rec.get("skills", []):
            section = rec.get("section", "")
            # Avoid duplicating entries already added
            already = any(
                s["skill"] == skill_name and s["section"] == section
                for s in selected
            )
            if not already:
                selected.append({
                    "skill": skill_name,
                    "section": section,
                    "reason": f"Detected smell: {rec.get('smell_type', 'unknown')}",
                })

    # Deduplicate by (skill, section) and cap at 5
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for item in selected:
        key = (item["skill"], item.get("section", ""))
        if key not in seen:
            seen.add(key)
            deduped.append(item)
        if len(deduped) >= 5:
            break

    return deduped


def _record_skill_references(skill_recommendations: dict | None, project_dir: str) -> None:
    """Record which skills were referenced during DCC analysis for feedback tracking."""
    if not skill_recommendations:
        return

    try:
        project_store = _get_project_experience_store(project_dir)
        global_store = _get_experience_store()
        project_name = Path(project_dir).name
        recorded_any = False

        for rec in skill_recommendations.get("recommendations", []):
            for skill_name in rec.get("skills", []):
                entry = ExperienceEntry(
                    type="skill_referenced",
                    file_pattern=f"skill:{skill_name}",
                    keywords=[skill_name, rec.get("smell_type", "")],
                    domain="skills",
                    description=f"Skill {skill_name} referenced for {rec.get('smell_type', 'unknown')} smell",
                    severity="low",
                    project_origin=project_name,
                    scope="project",
                )
                project_store.record(entry)

                global_entry = ExperienceEntry(
                    type="skill_referenced",
                    file_pattern=f"skill:{skill_name}",
                    keywords=[skill_name, rec.get("smell_type", "")],
                    domain="skills",
                    description=f"Skill {skill_name} referenced for {rec.get('smell_type', 'unknown')} smell",
                    severity="low",
                    project_origin=project_name,
                    scope="global",
                )
                global_store.record(global_entry)
                recorded_any = True

        if recorded_any:
            try:
                project_store.save()
                global_store.save()
            except Exception as e:
                print(f"[workflow-manager] Skill references save failed (non-fatal): {e}", file=sys.stderr)

    except Exception as e:
        print(f"[workflow-manager] Warning: _record_skill_references failed: {e}", file=sys.stderr)


# ============================================================================
# Smart Smell Filtering
# ============================================================================

def _get_new_files(project_dir: str) -> set[str]:
    """Return set of file paths that are new (untracked or staged-new) in git.

    Combines:
    - Untracked files from ``git status --porcelain``
    - Files added since HEAD~1 from ``git diff --name-only HEAD~1``

    Handles edge cases: no HEAD~1 (initial commit), not a git repo.

    Returns:
        Set of absolute file paths that are considered "new".
    """
    new_files: set[str] = set()
    project_path = Path(project_dir)

    # 1. Untracked + newly staged files from git status --porcelain
    try:
        result = subprocess.run(
            ["git", "-C", project_dir, "status", "--porcelain"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if not line:
                    continue
                xy = line[:2]
                path_part = line[3:].strip()
                # XY codes where the file is new: ?? (untracked), A? (added in index)
                if xy[0] in ("?", "A") or xy[1] in ("?", "A"):
                    # Handle renamed format "old -> new"
                    if " -> " in path_part:
                        path_part = path_part.split(" -> ")[-1]
                    new_files.add(str(project_path / path_part))
    except Exception as e:
        print(f"[workflow-manager] Warning: git status failed in _get_new_files: {e}", file=sys.stderr)

    # 2. Files added in the last commit (HEAD vs HEAD~1)
    try:
        result = subprocess.run(
            ["git", "-C", project_dir, "diff", "--name-only", "--diff-filter=A", "HEAD~1"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                line = line.strip()
                if line:
                    new_files.add(str(project_path / line))
    except Exception as e:
        print(f"[workflow-manager] Warning: git diff HEAD~1 failed in _get_new_files: {e}", file=sys.stderr)

    return new_files


def _filter_actionable_smells(
    smells: list[dict],
    project_dir: str,
    baseline_smells: list[dict] | None = None,
    max_age_minutes: int = 30,
    filter_for_validate: bool = False,
) -> tuple[list[dict], int]:
    """Filter a raw smell list to remove noise during active development.

    Filter criteria (applied in order):
        a. ``orphan_file`` smells for files that are new in git (untracked or
           added since HEAD~1) — reason: "new_file"
        b. ``orphan_file`` smells for files whose mtime is less than
           ``max_age_minutes`` old — reason: "recent_file"
        c. Smells already present in ``baseline_smells`` (pre-existing
           degradation) — reason: "baseline_existing"

    When ``filter_for_validate`` is True, all filtering is skipped so that
    Validate/Review phases see the complete picture.

    Args:
        smells: Raw smell list (each item is a dict with at least "type",
                "file"/"source", and optionally "severity").
        project_dir: Project root directory (used for git commands).
        baseline_smells: Optional list of smells captured at workflow start.
                         Only smells NOT in this list are surfaced.
        max_age_minutes: How many minutes old a file must be to not be
                         suppressed by the recency filter.
        filter_for_validate: When True, skip all filtering (Validate phases).

    Returns:
        (filtered_smells, noise_filtered_count) where ``filtered_smells`` is
        the actionable subset and ``noise_filtered_count`` is how many were
        suppressed.
    """
    if filter_for_validate or not smells:
        return smells, 0

    try:
        new_files = _get_new_files(project_dir)
    except Exception as e:
        print(f"[workflow-manager] Warning: _get_new_files failed: {e}", file=sys.stderr)
        new_files = set()

    now_real = time.time()
    age_threshold_secs = max_age_minutes * 60

    # Build a baseline key set for quick lookup: (type, normalized_file)
    baseline_keys: set[tuple[str, str]] = set()
    if baseline_smells:
        for bs in baseline_smells:
            btype = bs.get("type", bs.get("smell_type", ""))
            bfile = bs.get("file", bs.get("source", ""))
            if btype and bfile:
                baseline_keys.add((btype, str(bfile)))

    filtered: list[dict] = []
    suppressed = 0

    for smell in smells:
        smell_type = smell.get("type", smell.get("smell_type", ""))
        smell_file = smell.get("file", smell.get("source", ""))

        # Filter (c): baseline-existing — applies to all smell types
        if baseline_keys:
            key = (smell_type, str(smell_file))
            if key in baseline_keys:
                suppressed += 1
                continue

        # Filters (a) and (b) only apply to orphan_file smells
        if smell_type == "orphan_file" and smell_file:
            # Resolve to absolute path for comparison
            smell_path = Path(smell_file)
            if not smell_path.is_absolute():
                smell_path = Path(project_dir) / smell_path
            abs_smell_file = str(smell_path)

            # (a) New file in git
            if abs_smell_file in new_files:
                suppressed += 1
                continue

            # (b) Recently created file (mtime < max_age_minutes)
            try:
                file_mtime = smell_path.stat().st_mtime
                if (now_real - file_mtime) < age_threshold_secs:
                    suppressed += 1
                    continue
            except OSError:
                pass  # File might not exist yet; don't suppress on error

        filtered.append(smell)

    return filtered, suppressed


# ============================================================================
# Mid-Phase DCC Check (3A)
# ============================================================================

async def _run_mid_phase_check(
    project_dir: str,
    changed_files: list[str],
    token_budget: int = 200,
    node_name: str | None = None,
    baseline_smells: list[dict] | None = None,
) -> dict | None:
    """Run lightweight DCC analysis on specific changed files between traversals.

    This provides Cursor-like continuous feedback without waiting for graph_traverse().
    Only indexes the specified files and runs smells analysis with a compact budget.

    Args:
        project_dir: Project directory path.
        changed_files: List of file paths that were recently modified.
        token_budget: Approximate token budget for the combined output.
        node_name: Current workflow node name. When it contains "validate" or
                   "review", smart filtering is skipped to show the full picture.
        baseline_smells: Optional list of smells captured at workflow start used
                         to suppress pre-existing entries from feedback.

    Returns:
        Dict with smells_summary, tensions_summary, files_checked, and
        noise_filtered, or None if DCC unavailable.
    """
    if not _is_dcc_available():
        return None

    # Determine whether this is a validate/review phase (skip filtering if so)
    node_lower = (node_name or "").lower()
    is_validate_phase = any(kw in node_lower for kw in ("validate", "review"))

    # Index only the specified files (max 10)
    files_to_check = changed_files[:10]
    files_checked = 0
    for file_path in files_to_check:
        result = await _execute_dcc_tool("cube_index_file", {"path": file_path}, project_dir)
        if result is not None:
            files_checked += 1

    # Run smells analysis — fetch full list so we can filter it before summarizing.
    # In validate phases we still use summary_only for compactness (no filtering anyway).
    noise_filtered = 0
    if is_validate_phase:
        raw_smells = await _execute_dcc_tool("cube_detect_smells", {"summary_only": True}, project_dir)
        smells_summary = _summarize_smells(raw_smells) or "No smells data"
    else:
        raw_smells_full = await _execute_dcc_tool("cube_detect_smells", {}, project_dir)
        raw_smells = raw_smells_full  # keep reference for summary fallback

        # Extract smell list for filtering
        smell_list: list[dict] = []
        try:
            content = _extract_mcp_content(raw_smells_full)
            if isinstance(content, dict):
                smell_list = content.get("smells", [])
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to extract smell list in mid-phase: {e}", file=sys.stderr)

        if smell_list:
            filtered_smells, noise_filtered = _filter_actionable_smells(
                smell_list, project_dir,
                baseline_smells=baseline_smells,
                filter_for_validate=False,
            )
            # Build a synthetic summary from the filtered list
            if not filtered_smells:
                smells_summary = "No actionable smells detected"
            else:
                by_severity: dict[str, int] = {}
                by_type: dict[str, int] = {}
                for s in filtered_smells:
                    sev = s.get("severity", "low")
                    by_severity[sev] = by_severity.get(sev, 0) + 1
                    stype = s.get("type", s.get("smell_type", "unknown"))
                    by_type[stype] = by_type.get(stype, 0) + 1
                sev_order = ["critical", "high", "medium", "low"]
                sev_parts = [f"{by_severity[s]} {s}" for s in sev_order if by_severity.get(s)]
                type_parts = [f"{t}: {c}" for t, c in sorted(by_type.items())]
                smells_summary = f"{len(filtered_smells)} smells ({', '.join(sev_parts)})"
                if type_parts:
                    smells_summary += f" — {', '.join(type_parts)}"
        else:
            smells_summary = _summarize_smells(raw_smells) or "No smells data"

    # Run tensions (limit to 5 for compact output)
    raw_tensions = await _execute_dcc_tool("cube_get_tensions", {"limit": 5}, project_dir)
    tensions_summary = _summarize_tensions(raw_tensions) or "No tensions data"

    # Truncate to token budget (1 token ~ 4 chars), split budget between smells and tensions
    half_budget_chars = max(50, (token_budget * 4) // 2)
    if len(smells_summary) > half_budget_chars:
        smells_summary = smells_summary[:half_budget_chars] + "..."
    if len(tensions_summary) > half_budget_chars:
        tensions_summary = tensions_summary[:half_budget_chars] + "..."

    return {
        "smells_summary": smells_summary,
        "tensions_summary": tensions_summary,
        "files_checked": files_checked,
        "noise_filtered": noise_filtered,
    }


# ============================================================================
# Pre-Transition DCC Check (3B)
# ============================================================================

_GRADE_ORDER = {"A": 0, "B": 1, "C": 2, "D": 3, "F": 4}


async def _run_pre_transition_check(
    node: "Node | None",
    project_dir: str,
    baseline_smells: list[dict] | None = None,
) -> dict | None:
    """Run DCC quality check before allowing a workflow transition.

    Similar to tension_gate but based on code smells and debt grade.
    Returns None if OK, or a blocking dict if critical issues found.

    Configured via node.dcc_context.pre_check:
        enabled: bool
        min_grade: str (A/B/C/D/F) — block if debt grade is worse than this
        max_critical_smells: int — block if more critical smells than this

    Smart filtering is applied to critical smells before the count check so
    that orphan smells on new/recent files do not cause false blocks.
    In validate/review nodes filtering is disabled to show the full picture.

    Args:
        node: Current graph Node object (the FROM node of the edge being traversed).
        project_dir: Project directory path.
        baseline_smells: Optional list of smells captured at workflow start used
                         to suppress pre-existing entries when counting criticals.

    Returns:
        None if transition is allowed, or a dict with blocking details.
        The dict always includes a ``noise_filtered`` key (int).
    """
    if not node or not node.dcc_context:
        return None

    pre_check = node.dcc_context.get("pre_check", {})
    if not pre_check.get("enabled", False):
        return None

    if not _is_dcc_available():
        return None

    min_grade = pre_check.get("min_grade", "D")
    max_critical_smells = pre_check.get("max_critical_smells", 10)

    # Determine whether this is a validate/review phase (skip filtering if so)
    node_id = getattr(node, "id", "") or ""
    node_lower = node_id.lower()
    is_validate_phase = any(kw in node_lower for kw in ("validate", "review"))

    # Get debt grade
    raw_debt = await _execute_dcc_tool("cube_get_debt", {}, project_dir)
    debt_grade = "?"
    if raw_debt:
        try:
            content = raw_debt
            if isinstance(raw_debt, dict) and "content" in raw_debt:
                for item in raw_debt["content"]:
                    if item.get("type") == "text":
                        content = json.loads(item["text"])
                        break
            if isinstance(content, dict):
                debt_grade = content.get("grade", "?")
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to parse debt grade: {e}", file=sys.stderr)

    # Get critical smells — fetch full list so we can apply smart filtering
    raw_smells = await _execute_dcc_tool(
        "cube_detect_smells",
        {"min_severity": "critical"},
        project_dir,
    )
    critical_smells_count = 0
    noise_filtered = 0
    if raw_smells:
        try:
            content = _extract_mcp_content(raw_smells)
            if isinstance(content, dict):
                smell_list: list[dict] = content.get("smells", [])
                if smell_list and not is_validate_phase:
                    # Apply smart filtering before counting
                    filtered_smells, noise_filtered = _filter_actionable_smells(
                        smell_list, project_dir,
                        baseline_smells=baseline_smells,
                        filter_for_validate=False,
                    )
                    critical_smells_count = len(filtered_smells)
                elif smell_list:
                    # Validate phase: count everything
                    critical_smells_count = len(smell_list)
                else:
                    # Fallback: use pre-aggregated by_severity if smells list absent
                    by_severity = content.get("by_severity", {})
                    critical_smells_count = by_severity.get("critical", content.get("total_smells", 0))
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to parse critical smells: {e}", file=sys.stderr)

    # If DCC tools both returned no data, skip blocking to avoid false positives
    if raw_debt is None and raw_smells is None:
        return None

    # Compare debt grade (block if worse than min_grade)
    # Unknown grade "?" is treated as a known grade only when data was returned
    current_grade_level = _GRADE_ORDER.get(debt_grade) if debt_grade != "?" else None
    if current_grade_level is None:
        # Could not determine grade — don't block on grade
        grade_blocked = False
    else:
        min_grade_level = _GRADE_ORDER.get(min_grade, 3)
        grade_blocked = current_grade_level > min_grade_level

    # Compare critical smells count (against filtered count)
    smells_blocked = critical_smells_count > max_critical_smells

    if not grade_blocked and not smells_blocked:
        return None

    # Build blocking reason
    reasons = []
    if grade_blocked:
        reasons.append(f"debt grade {debt_grade} is worse than required {min_grade}")
    if smells_blocked:
        reasons.append(f"{critical_smells_count} critical smells exceed limit of {max_critical_smells}")

    return {
        "blocked": True,
        "reason": "; ".join(reasons),
        "debt_grade": debt_grade,
        "critical_smells": critical_smells_count,
        "min_grade": min_grade,
        "max_critical_smells": max_critical_smells,
        "noise_filtered": noise_filtered,
    }
