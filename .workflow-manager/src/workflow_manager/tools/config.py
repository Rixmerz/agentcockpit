"""Config tools: set_session, workflow_set_enabled, workflow_set_dcc_injection."""

from ..session import get_or_create_session, set_session_project_dir, resolve_project_dir
from ..hub_config import (
    get_workflow_dir, load_enforcer_config, save_enforcer_config,
)
from ..dcc_integration import _is_dcc_available


def register_config_tools(mcp):

    @mcp.tool()
    def set_session(project_dir: str, session_id: str | None = None) -> dict:
        # readOnlyHint: True
        """Establece el proyecto activo para la sesion actual.

        Llamar esta funcion una vez al inicio evita repetir project_dir
        en cada llamada subsiguiente.

        Args:
            project_dir: Absolute path to the project directory (REQUIRED first time)
            session_id: Optional session ID for parallel session isolation

        Returns:
            session_id to use in subsequent calls (optional but recommended for parallel use)

        Example:
            # First call: set project
            set_session(project_dir="/path/to/project")

            # Subsequent calls: no project_dir needed
            graph_status()
            graph_traverse(edge_id)
        """
        sid = get_or_create_session(session_id)
        set_session_project_dir(sid, project_dir)

        # Validate project exists
        workflow_dir = get_workflow_dir(project_dir)

        return {
            "success": True,
            "session_id": sid,
            "project_dir": project_dir,
            "workflow_dir": str(workflow_dir),
            "message": "Session established. project_dir no longer required in subsequent calls."
        }

    @mcp.tool()
    def workflow_set_enabled(enabled: bool, project_dir: str | None = None, session_id: str | None = None) -> dict:
        # destructiveHint: True (changes enforcer behavior)
        """Activa o desactiva el enforcer del workflow.

        Cuando esta desactivado, el hook aprueba todas las herramientas sin validar.
        Esto es util para pausar temporalmente el control del workflow.

        Args:
            enabled: True para activar el enforcer, False para desactivarlo
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        try:
            config = load_enforcer_config(resolved_dir)
            config["enforcer_enabled"] = enabled
            save_enforcer_config(resolved_dir, config)

            return {
                "success": True,
                "session_id": sid,
                "enabled": enabled,
                "message": f"Workflow enforcer {'enabled' if enabled else 'disabled'}",
                "project_dir": resolved_dir
            }
        except Exception as e:
            return {
                "success": False,
                "session_id": sid,
                "message": f"Error setting workflow enabled state: {str(e)}",
                "project_dir": resolved_dir
            }

    @mcp.tool()
    def workflow_set_dcc_injection(
        enabled: bool,
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: False
        """Enable or disable DCC analysis injection on workflow transitions.

        When enabled and DeltaCodeCube MCP is installed, every graph_traverse()
        will automatically include code quality analysis (stats, smells) in
        the response. Individual nodes can override or opt-out via dcc_context.

        Args:
            enabled: True to enable DCC injection, False to disable it
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)
        config = load_enforcer_config(resolved_dir)
        config["dcc_injection_enabled"] = enabled
        save_enforcer_config(resolved_dir, config)

        return {
            "success": True,
            "session_id": sid,
            "dcc_injection_enabled": enabled,
            "dcc_available": _is_dcc_available(),
            "project_dir": resolved_dir
        }
