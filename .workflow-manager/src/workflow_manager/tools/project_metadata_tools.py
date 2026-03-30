"""Project metadata tools: project_metadata_get, project_metadata_refresh.

These tools auto-discover and cache project metadata (migrations, ID patterns,
bounded contexts, tech stack, directory structure) so agents don't waste
context reading files to discover basic project state.
"""

from ..session import resolve_project_dir
from ..graph_state import _get_centralized_state_dir
from ..project_metadata import ProjectMetadata

_VALID_SECTIONS = frozenset(
    {"migration_number", "id_patterns", "bounded_contexts", "tech_stack", "project_structure"}
)


def register_project_metadata_tools(mcp):

    @mcp.tool()
    def project_metadata_get(
        project_dir: str | None = None,
        section: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        # readOnlyHint: True
        """Return auto-discovered project metadata (cached or freshly discovered).

        Provides structured information about the project so agents don't need
        to scan the filesystem for common facts:

        - migration_number: Highest migration number and next number to use
        - id_patterns: How IDs are typed in domain/model files
        - bounded_contexts: Existing modules/domains found in the project
        - tech_stack: Languages, frameworks, and test patterns
        - project_structure: Top-level directories and known entry points

        The result is cached for 1 hour in the centralized state directory.
        Call project_metadata_refresh() to force re-discovery.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            section: Return only one section — one of: migration_number, id_patterns,
                     bounded_contexts, tech_stack, project_structure.
                     If omitted, all sections are returned.
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        if section is not None and section not in _VALID_SECTIONS:
            return {
                "error": True,
                "message": f"Unknown section '{section}'. Valid sections: {sorted(_VALID_SECTIONS)}",
                "session_id": sid,
                "project_dir": resolved_dir,
            }

        state_dir = str(_get_centralized_state_dir(resolved_dir))

        metadata = ProjectMetadata.load(resolved_dir, state_dir)
        cache_hit = metadata is not None

        if metadata is None:
            metadata = ProjectMetadata(resolved_dir)
            try:
                metadata.discover_all()
                metadata.save(state_dir)
            except Exception as e:
                return {
                    "error": True,
                    "message": f"Discovery failed: {e}",
                    "session_id": sid,
                    "project_dir": resolved_dir,
                }

        data = metadata.get(section)
        discovered_at = metadata.get().get("_discovered_at")

        return {
            "success": True,
            "cache_hit": cache_hit,
            "discovered_at": discovered_at,
            "section": section,
            "data": data,
            "session_id": sid,
            "project_dir": resolved_dir,
        }

    @mcp.tool()
    def project_metadata_refresh(
        project_dir: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        # destructiveHint: False (overwrites only the metadata cache)
        """Force re-discovery of project metadata, ignoring the cache.

        Use this when the project structure has changed significantly
        (new bounded context added, migration applied, dependencies changed)
        and the cached metadata is stale.

        Args:
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        state_dir = str(_get_centralized_state_dir(resolved_dir))

        metadata = ProjectMetadata(resolved_dir)
        try:
            result = metadata.discover_all()
            metadata.save(state_dir)
        except Exception as e:
            return {
                "error": True,
                "message": f"Refresh failed: {e}",
                "session_id": sid,
                "project_dir": resolved_dir,
            }

        discovered_at = result.get("_discovered_at")

        # Compact summary of what was found
        summary: dict = {}
        mig = result.get("migration_number", {})
        if mig.get("last_number"):
            summary["last_migration"] = mig["last_number"]
            summary["next_migration"] = mig["next_number"]

        bc = result.get("bounded_contexts", {})
        if bc.get("count"):
            summary["bounded_contexts"] = bc["count"]

        ts = result.get("tech_stack", {})
        if ts.get("languages"):
            summary["languages"] = ts["languages"]

        return {
            "success": True,
            "discovered_at": discovered_at,
            "summary": summary,
            "data": result,
            "session_id": sid,
            "project_dir": resolved_dir,
        }
