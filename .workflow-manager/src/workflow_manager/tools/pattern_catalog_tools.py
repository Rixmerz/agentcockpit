"""Pattern catalog tools: pattern_catalog_get, pattern_catalog_generate.

These tools extract and cache condensed code patterns from a project
so agents don't waste context reading full reference files to understand
project conventions.
"""

from ..session import resolve_project_dir
from ..graph_state import _get_centralized_state_dir
from ..pattern_catalog import PatternCatalog

_VALID_PATTERN_TYPES = frozenset({
    "repository",
    "handler",
    "domain_entity",
    "migration",
    "test_unit",
    "frontend_page",
    "frontend_hook",
    "frontend_service",
})


def register_pattern_catalog_tools(mcp):

    @mcp.tool()
    def pattern_catalog_get(
        project_dir: str | None = None,
        pattern_type: str | None = None,
        as_prompt: bool = False,
        session_id: str | None = None,
    ) -> dict:
        # readOnlyHint: True
        """Return cached or freshly generated project code patterns.

        Provides condensed code snippets that show how the project implements
        common patterns — so agents can match conventions without reading full files.

        Available pattern types:
        - repository: Data access layer (DB queries, ORM calls)
        - handler: HTTP handlers or API controllers
        - domain_entity: Domain models, aggregates, value objects
        - migration: Latest migration file as a template
        - test_unit: Unit test structure and assertion style
        - frontend_page: Frontend page/view component
        - frontend_hook: Custom React hook
        - frontend_service: Frontend service / API client layer

        The cache is valid for 2 hours. Use pattern_catalog_generate() to force refresh.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            pattern_type: Return only one pattern type. If omitted, all discovered patterns
                          are returned.
            as_prompt: If True, return patterns formatted as a prompt injection string
                       (markdown with code blocks) instead of structured JSON.
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        if pattern_type is not None and pattern_type not in _VALID_PATTERN_TYPES:
            return {
                "error": True,
                "message": (
                    f"Unknown pattern_type '{pattern_type}'. "
                    f"Valid types: {sorted(_VALID_PATTERN_TYPES)}"
                ),
                "session_id": sid,
                "project_dir": resolved_dir,
            }

        state_dir = str(_get_centralized_state_dir(resolved_dir))

        catalog = PatternCatalog.load(resolved_dir, state_dir)
        cache_hit = catalog is not None

        if catalog is None:
            catalog = PatternCatalog(resolved_dir)
            try:
                catalog.discover_all()
                catalog.save(state_dir)
            except Exception as e:
                return {
                    "error": True,
                    "message": f"Pattern discovery failed: {e}",
                    "session_id": sid,
                    "project_dir": resolved_dir,
                }

        discovered_at = catalog.discovered_at
        available_types = list(catalog.patterns.keys())

        if as_prompt:
            names = [pattern_type] if pattern_type else None
            prompt_text = catalog.to_prompt_injection(names)
            return {
                "success": True,
                "cache_hit": cache_hit,
                "discovered_at": discovered_at,
                "pattern_type": pattern_type,
                "available_types": available_types,
                "prompt": prompt_text,
                "session_id": sid,
                "project_dir": resolved_dir,
            }

        data = catalog.patterns.get(pattern_type) if pattern_type else catalog.patterns
        return {
            "success": True,
            "cache_hit": cache_hit,
            "discovered_at": discovered_at,
            "pattern_type": pattern_type,
            "available_types": available_types,
            "data": data,
            "session_id": sid,
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def pattern_catalog_generate(
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        # destructiveHint: False (overwrites only the patterns cache)
        """Force regeneration of the project pattern catalog, ignoring the cache.

        Use this when the project structure has changed significantly
        (new layers added, framework changed, major refactor done)
        and the cached patterns are stale.

        Returns a summary of which pattern types were discovered.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        state_dir = str(_get_centralized_state_dir(resolved_dir))

        catalog = PatternCatalog(resolved_dir)
        try:
            result = catalog.discover_all()
            catalog.save(state_dir)
        except Exception as e:
            return {
                "error": True,
                "message": f"Pattern generation failed: {e}",
                "session_id": sid,
                "project_dir": resolved_dir,
            }

        discovered_at = catalog.discovered_at
        found_types = list(result.keys())
        missing_types = sorted(_VALID_PATTERN_TYPES - set(found_types))

        # Build compact summary: type -> source_file
        summary: dict[str, str] = {}
        for pt in found_types:
            entry = result.get(pt, {})
            if isinstance(entry, dict):
                summary[pt] = entry.get("source_file", "?")

        return {
            "success": True,
            "discovered_at": discovered_at,
            "found_types": found_types,
            "missing_types": missing_types,
            "summary": summary,
            "session_id": sid,
            "project_dir": resolved_dir,
        }
