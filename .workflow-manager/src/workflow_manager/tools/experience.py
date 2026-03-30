"""Experience memory tools: experience_query, experience_record,
experience_list, experience_stats.
"""

from pathlib import Path

from ..session import resolve_project_dir
from ..experience_memory import (
    ExperienceEntry, merge_stores,
    generalize_path, extract_file_keywords, guess_domain,
    compute_relevance, GLOBAL_MEMORY_FILE, PROJECT_MEMORIES_DIR,
    derive_implementation_checklist, format_checklist_for_prompt,
)
from ..dcc_integration import (
    get_experience_store, get_project_experience_store,
)


def register_experience_tools(mcp):

    @mcp.tool()
    def experience_query(
        file_path: str,
        top_n: int = 5,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # readOnlyHint: True
        """Query experience memory for relevant memories about a file.

        Returns past experiences (tensions, smells, gate blocks) that are
        relevant to the given file path, ranked by relevance score.

        Args:
            file_path: Path to the file to query about (relative or absolute)
            top_n: Maximum number of results to return (default 5)
            project_dir: Project directory (optional after set_session)
            session_id: Optional session ID
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        project_name = Path(resolved_dir).name

        global_store = get_experience_store()
        project_store = get_project_experience_store(resolved_dir)

        # Merge both stores for unified query
        merged = merge_stores(global_store, project_store)

        # Score and rank
        scored = []
        for entry in merged:
            score = compute_relevance(entry, file_path)
            if score > 0.05:
                scored.append((entry, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        top = scored[:top_n]

        return {
            "file_path": file_path,
            "matches": len(top),
            "total_memories": len(merged),
            "results": [
                {
                    "score": round(score, 3),
                    "type": entry.type,
                    "file_pattern": entry.file_pattern,
                    "domain": entry.domain,
                    "description": entry.description,
                    "severity": entry.severity,
                    "confidence": round(entry.confidence, 3),
                    "occurrences": entry.occurrences,
                    "resolution": entry.resolution or None,
                    "scope": entry.scope,
                    "last_seen": entry.last_seen,
                }
                for entry, score in top
            ],
            "session_id": sid,
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def experience_record(
        type: str,
        file_path: str,
        description: str,
        severity: str = "medium",
        resolution: str = "",
        scope: str = "project",
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: False (adds data, does not delete)
        """Manually record an experience memory.

        Use this to capture insights about code patterns, issues found,
        or resolutions that should be remembered for future reference.

        Args:
            type: Experience type (tension_caused|tension_resolved|smell_introduced|
                  smell_fixed|gate_blocked|gate_resolved|impact_high)
            file_path: File path this experience relates to
            description: Human-readable description of the experience
            severity: low|medium|high|critical (default medium)
            resolution: How the issue was resolved (if applicable)
            scope: "global" (cross-project) or "project" (default project)
            project_dir: Project directory (optional after set_session)
            session_id: Optional session ID
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        project_name = Path(resolved_dir).name

        from ..experience_memory import VALID_TYPES, VALID_SEVERITIES, VALID_SCOPES

        if type not in VALID_TYPES:
            return {
                "error": True,
                "message": f"Invalid type '{type}'. Valid: {', '.join(sorted(VALID_TYPES))}",
            }
        if severity not in VALID_SEVERITIES:
            return {
                "error": True,
                "message": f"Invalid severity '{severity}'. Valid: {', '.join(sorted(VALID_SEVERITIES))}",
            }
        if scope not in VALID_SCOPES:
            return {
                "error": True,
                "message": f"Invalid scope '{scope}'. Valid: {', '.join(sorted(VALID_SCOPES))}",
            }

        entry = ExperienceEntry(
            type=type,
            file_pattern=generalize_path(file_path),
            keywords=extract_file_keywords(file_path),
            domain=guess_domain(file_path),
            description=description,
            severity=severity,
            project_origin=project_name,
            resolution=resolution,
            scope=scope,
        )

        if scope == "project":
            store = get_project_experience_store(resolved_dir)
        else:
            store = get_experience_store()

        recorded = store.record(entry)
        store.save()

        return {
            "success": True,
            "id": recorded.id,
            "type": recorded.type,
            "file_pattern": recorded.file_pattern,
            "domain": recorded.domain,
            "confidence": round(recorded.confidence, 3),
            "occurrences": recorded.occurrences,
            "scope": recorded.scope,
            "is_new": recorded.occurrences == 1,
            "session_id": sid,
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def experience_list(
        type_filter: str | None = None,
        scope_filter: str | None = None,
        min_confidence: float = 0.0,
        limit: int = 20,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # readOnlyHint: True
        """List experience memories with optional filters.

        Args:
            type_filter: Filter by type (e.g. "tension_caused", "smell_introduced")
            scope_filter: Filter by scope ("global" or "project")
            min_confidence: Minimum confidence threshold (0.0-1.0)
            limit: Maximum entries to return (default 20)
            project_dir: Project directory (optional after set_session)
            session_id: Optional session ID
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        global_store = get_experience_store()
        project_store = get_project_experience_store(resolved_dir)
        merged = merge_stores(global_store, project_store)

        # Apply filters
        filtered = merged
        if type_filter:
            filtered = [e for e in filtered if e.type == type_filter]
        if scope_filter:
            filtered = [e for e in filtered if e.scope == scope_filter]
        if min_confidence > 0.0:
            filtered = [e for e in filtered if e.confidence >= min_confidence]

        # Sort by confidence desc, then recency
        filtered.sort(key=lambda e: (e.confidence, e.last_seen or ""), reverse=True)
        entries = filtered[:limit]

        return {
            "total_matching": len(filtered),
            "showing": len(entries),
            "entries": [
                {
                    "id": e.id,
                    "type": e.type,
                    "file_pattern": e.file_pattern,
                    "domain": e.domain,
                    "description": e.description[:200],
                    "severity": e.severity,
                    "confidence": round(e.confidence, 3),
                    "occurrences": e.occurrences,
                    "scope": e.scope,
                    "resolution": e.resolution[:100] if e.resolution else None,
                    "last_seen": e.last_seen,
                }
                for e in entries
            ],
            "session_id": sid,
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def experience_stats(
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # readOnlyHint: True
        """Get statistics about experience memory.

        Shows counts by type, scope, severity, and confidence distribution.

        Args:
            project_dir: Project directory (optional after set_session)
            session_id: Optional session ID
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        global_store = get_experience_store()
        project_store = get_project_experience_store(resolved_dir)

        global_stats = global_store.stats()
        project_stats = project_store.stats()

        return {
            "global": global_stats,
            "project": project_stats,
            "combined_total": global_stats["total"] + project_stats["total"],
            "storage": {
                "global_file": str(GLOBAL_MEMORY_FILE),
                "project_file": str(PROJECT_MEMORIES_DIR / Path(resolved_dir).name / "experience_memory.json"),
            },
            "session_id": sid,
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def experience_derive_checklist(
        project_dir: str | None = None,
        task_type: str = "bounded_context",
        session_id: str | None = None,
    ) -> dict:
        # readOnlyHint: True
        """Derive an implementation checklist from experience memory.

        Analyzes past implementations to produce a checklist of files and patterns
        needed for a given task type. Most useful before starting a new bounded
        context, feature, or migration.

        The checklist is derived by scanning all experience entries (global +
        project-specific) for recurring file patterns that match the requested
        task type.  Each pattern must appear at least twice to be included.

        Args:
            project_dir: Project directory (optional after set_session)
            task_type: One of: bounded_context, feature, migration, api_endpoint
            session_id: Optional session ID

        Returns a dict with:
            - task_type: echoed back
            - derived_from: number of experience entries analyzed
            - checklist: list of {pattern, description, occurrences, examples}
            - notes: short convention hints from high-confidence entries
            - prompt_text: markdown-formatted version, ready for prompt injection
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        valid_task_types = {"bounded_context", "feature", "migration", "api_endpoint"}
        if task_type not in valid_task_types:
            return {
                "error": True,
                "message": (
                    f"Invalid task_type '{task_type}'. "
                    f"Valid options: {', '.join(sorted(valid_task_types))}"
                ),
                "session_id": sid,
                "project_dir": resolved_dir,
            }

        result = derive_implementation_checklist(
            project_dir=resolved_dir,
            task_type=task_type,
        )

        result["prompt_text"] = format_checklist_for_prompt(result)
        result["session_id"] = sid
        result["project_dir"] = resolved_dir

        return result
