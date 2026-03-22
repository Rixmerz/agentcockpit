"""FastMCP server for Workflow Manager.

Permite a Claude autogestionar el workflow de flujo:
- Ver estado del workflow
- Resetear/avanzar el workflow
- Ver/modificar configuracion
- Ejecutar tools de otros MCPs via proxy (execute_mcp_tool)
- Buscar tools por objetivo (search_tools)
- Gestionar grafos de workflow (graph_*)
- Registrar y consultar experiencias (experience_*)
- Desplegar agentes a proyectos (deploy_project_agents)

Architecture (Centralized Hub - AgentCockpit):
- Workflows: GLOBAL in {agentcockpit}/.claude/workflows/
- States: CENTRALIZED in {agentcockpit}/.agentcockpit/states/{project_name}/
- Config: ~/.agentcockpit/config.json defines hub_dir

Module structure:
- session.py         : Session management, project_dir resolution
- hub_config.py      : Hub paths, MCP configs, enforcer config
- tool_index.py      : Tool indexing, learned weights, semantic search
- mcp_connection.py  : McpConnection class, connection pool
- dcc_integration.py : DCC analysis, tension gates, experience collection
- tools/             : Tool registration modules (one per domain)
"""

import asyncio
import sys
from contextlib import asynccontextmanager

from fastmcp import FastMCP

from .tools import register_all_tools
from .tools.proxy import _do_refresh_tool_index


# Lifespan: auto-index tools on startup (non-blocking)
async def _auto_index_background():
    """Background task: index MCP tools without blocking server startup."""
    try:
        result = await asyncio.wait_for(_do_refresh_tool_index(), timeout=30.0)
        total = result.get("total_tools", 0)
        mcps = len(result.get("indexed_mcps", []))
        errors = result.get("errors") or []
        print(f"[workflow-manager] Auto-indexed {total} tools from {mcps} MCPs", file=sys.stderr)
        for err in errors:
            print(f"[workflow-manager] Index warning: {err}", file=sys.stderr)
    except asyncio.TimeoutError:
        print("[workflow-manager] Auto-index timed out after 30s (non-fatal)", file=sys.stderr)
    except Exception as e:
        print(f"[workflow-manager] Auto-index failed (non-fatal): {e}", file=sys.stderr)


@asynccontextmanager
async def _server_lifespan(server):
    """Server lifespan: launch auto-index in background (non-blocking)."""
    task = asyncio.create_task(_auto_index_background())
    yield {}
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# Create FastMCP server with lifespan
mcp = FastMCP("workflow-manager", lifespan=_server_lifespan)

# Register all tools from sub-modules
register_all_tools(mcp)
