"""Proxy tools: execute_mcp_tool, search_tools, refresh_tool_index,
close_mcp_connections, get/reset_learned_weights.
"""

import sys
from typing import Any

from ..session import resolve_project_dir
from ..hub_config import load_mcp_configs
from ..mcp_connection import (
    get_mcp_connection, close_all_connections,
    increment_request_counter,
)
from ..tool_index import (
    semantic_search, check_and_record_selection,
    build_tool_index, set_tool_index_entry,
    get_learned_weights_data, reset_all_learned_weights,
    load_learned_weights, save_learned_weights,
    LEARNED_WEIGHTS_FILE,
)
from ..graph_engine import evaluate_transitions
from ..graph_parser import load_graph_from_file
from ..graph_state import load_graph_state, initialize_graph_state, get_graph_file


def register_proxy_tools(mcp):

    @mcp.tool()
    async def execute_mcp_tool(
        mcp_name: str,
        tool_name: str,
        arguments: dict[str, Any],
        project_dir: str | None = None,
        session_id: str | None = None
    ) -> dict:
        # destructiveHint: True (executes arbitrary tools on external MCPs)
        """Execute any available MCP tool through the graph workflow proxy.

        This is the universal gateway for calling MCP tools. The available
        tools depend on the current graph node. Use graph_status to see
        which MCPs are enabled for the current node.

        The tool spawns MCP servers on-demand and maintains a connection pool
        for efficient reuse. MCP configurations are read from ~/.claude.json.

        After execution, reports any available transitions that this tool
        triggers (but does NOT auto-advance - use graph_traverse for that).

        Args:
            mcp_name: Name of the MCP server (e.g., "Context7", "sequential-thinking")
            tool_name: Name of the tool to execute (e.g., "get-library-docs", "sequentialthinking")
            arguments: Tool arguments as a dictionary matching the tool's schema
            project_dir: Absolute path to the project directory (optional after set_session)
            session_id: Optional session ID for parallel session isolation

        Returns:
            The tool execution result, plus any available graph transitions

        Example:
            # First set session (once)
            set_session(project_dir="/path/to/project")

            # Then execute tools without project_dir
            execute_mcp_tool(
                mcp_name="Context7",
                tool_name="get-library-docs",
                arguments={"context7CompatibleLibraryID": "/vercel/next.js", "topic": "routing"}
            )
        """
        resolved_dir, sid = resolve_project_dir(project_dir, session_id)

        # Record tool selection for weight learning (if this tool was in recent search)
        check_and_record_selection(mcp_name, tool_name)

        # 1. Load graph state (if graph exists)
        graph_file = get_graph_file(resolved_dir)
        current_node = None
        enabled_mcps = ["*"]
        graph = None
        graph_state = None

        if graph_file.exists():
            try:
                graph = load_graph_from_file(graph_file)
                graph_state = load_graph_state(resolved_dir)

                # Initialize state if empty
                if not graph_state.current_nodes:
                    graph_state = initialize_graph_state(
                        resolved_dir, graph, graph.metadata.get('name', 'unnamed')
                    )

                current_node_id = graph_state.get_current_node()
                current_node = graph.nodes.get(current_node_id)
                if current_node:
                    enabled_mcps = current_node.mcps_enabled
            except Exception as e:
                print(f"[workflow-manager] Warning: failed to get enabled MCPs for node: {e}", file=sys.stderr)
                pass  # Fall back to allowing all MCPs

        # 2. Validate MCP is allowed in current node
        if "*" not in enabled_mcps and mcp_name not in enabled_mcps:
            return {
                "error": True,
                "session_id": sid,
                "message": f"MCP '{mcp_name}' is not available in node '{current_node.id if current_node else 'unknown'}': {current_node.name if current_node else 'No node'}",
                "available_mcps": enabled_mcps,
                "hint": "Use graph_status() to see available MCPs for current node"
            }

        # 3. Get or create MCP connection
        conn = await get_mcp_connection(mcp_name)
        if not conn:
            # Check if MCP exists in config
            configs = load_mcp_configs()
            if mcp_name not in configs:
                return {
                    "error": True,
                    "message": f"MCP '{mcp_name}' not found in ~/.claude.json",
                    "available_mcps": list(configs.keys()),
                    "hint": "Add the MCP configuration to ~/.claude.json first"
                }
            return {
                "error": True,
                "message": f"Failed to create connection to MCP '{mcp_name}'",
                "hint": "Check the MCP command configuration in ~/.claude.json"
            }

        # 4. Execute the tool
        request_id = increment_request_counter()
        try:
            result = await conn.call_tool(tool_name, arguments, request_id)
        except Exception as e:
            return {
                "error": True,
                "message": f"Error executing tool on {mcp_name}: {str(e)}"
            }

        # 5. Check for available graph transitions (but don't auto-advance)
        available_transitions = None
        if graph and graph_state:
            trigger_value = {'mcp': mcp_name, 'tool': tool_name}
            matching_edges = evaluate_transitions(graph, graph_state, 'tool', trigger_value)
            if matching_edges:
                available_transitions = {
                    "triggered_by": f"{mcp_name}.{tool_name}",
                    "available_edges": [
                        {
                            "id": e.id,
                            "to": e.to_node,
                            "to_name": graph.nodes[e.to_node].name if e.to_node in graph.nodes else e.to_node
                        }
                        for e in matching_edges
                    ],
                    "hint": "Use graph_traverse(edge_id) to advance"
                }

        # 6. Return result
        if "error" in result:
            error_info = result.get("error", {})
            if isinstance(error_info, dict):
                return {
                    "error": True,
                    "message": error_info.get("message", str(error_info))
                }
            return {
                "error": True,
                "message": str(error_info)
            }

        tool_result = result.get("result", result)

        # Include available transitions if any
        if available_transitions:
            if isinstance(tool_result, dict):
                tool_result["_graph_transitions_available"] = available_transitions
            else:
                tool_result = {
                    "result": tool_result,
                    "_graph_transitions_available": available_transitions
                }

        return tool_result

    @mcp.tool()
    def search_tools(
        query: str,
        max_results: int = 10,
        mcp_filter: str | None = None
    ) -> dict:
        # readOnlyHint: True
        """Busca tools por objetivo o descripcion usando similitud semantica.

        Util cuando no conoces el nombre exacto de una tool pero sabes que quieres hacer.

        Args:
            query: Descripcion del objetivo (ej: "exponer servicio a internet", "ver logs de container")
            max_results: Maximo de resultados (default 10)
            mcp_filter: Filtrar por MCP especifico (opcional)

        Examples:
            search_tools(query="exponer servicio a internet") -> tunnel_create
            search_tools(query="ver logs de container") -> container_logs
            search_tools(query="inyectar falla de cpu") -> fault_inject_cpu
        """
        results = semantic_search(query, mcp_filter, max_results)
        return {
            "query": query,
            "results": results,
            "count": len(results),
            "hint": "Use execute_mcp_tool(mcp_name, tool_name, arguments) to call a tool. Selecting a tool will improve future search rankings."
        }

    @mcp.tool()
    def get_learned_weights(
        tool_filter: str | None = None,
        top_n: int = 20
    ) -> dict:
        # readOnlyHint: True
        """Ver los pesos aprendidos por el sistema de busqueda.

        Muestra que tools han sido seleccionadas y para que keywords,
        permitiendo entender como el sistema ha aprendido de tus selecciones.

        Args:
            tool_filter: Filtrar por nombre de tool (parcial)
            top_n: Numero maximo de tools a mostrar (default 20)
        """
        weights_data = get_learned_weights_data()

        if not weights_data:
            return {
                "message": "No learned weights yet. Use search_tools() and execute tools to train.",
                "weights": {},
                "total_tools": 0
            }

        # Filter and sort by total weight
        results = []
        for tool_key, keywords in weights_data.items():
            if tool_filter and tool_filter.lower() not in tool_key.lower():
                continue

            total_weight = sum(keywords.values())
            top_keywords = sorted(keywords.items(), key=lambda x: x[1], reverse=True)[:5]

            results.append({
                "tool": tool_key,
                "total_weight": round(total_weight, 2),
                "top_keywords": {k: round(v, 2) for k, v in top_keywords}
            })

        # Sort by total weight
        results.sort(key=lambda x: x["total_weight"], reverse=True)
        results = results[:top_n]

        return {
            "weights": results,
            "total_tools": len(weights_data),
            "showing": len(results),
            "file": str(LEARNED_WEIGHTS_FILE)
        }

    @mcp.tool()
    def reset_learned_weights(confirm: bool = False) -> dict:
        # destructiveHint: True (deletes all learned data)
        """Resetea todos los pesos aprendidos.

        CUIDADO: Esto borra todo el aprendizaje acumulado.

        Args:
            confirm: Debe ser True para confirmar el reset
        """
        weights_data = get_learned_weights_data()

        if not confirm:
            return {
                "success": False,
                "message": "Set confirm=True to reset all learned weights",
                "current_tools": len(weights_data)
            }

        reset_all_learned_weights()

        return {
            "success": True,
            "message": "All learned weights have been reset",
            "file": str(LEARNED_WEIGHTS_FILE)
        }

    @mcp.tool()
    async def refresh_tool_index(mcp_name: str | None = None) -> dict:
        # readOnlyHint: True (indexes tools but doesn't modify them)
        """Actualiza el indice de tools para busqueda semantica.

        Conecta a los MCPs y obtiene su lista de tools para indexar.
        Usar para reindexar despues de agregar nuevos MCPs.
        El indice se carga automaticamente al iniciar el servidor.

        Args:
            mcp_name: MCP especifico a reindexar (opcional, default: todos)
        """
        return await _do_refresh_tool_index(mcp_name)

    @mcp.tool()
    async def close_mcp_connections() -> dict:
        # destructiveHint: True (closes active connections)
        """Close all active MCP connections.

        Use this to clean up resources when done with MCP tools.
        Connections will be re-established on next use.
        """
        closed = await close_all_connections()

        return {
            "success": True,
            "closed": closed,
            "message": f"Closed {len(closed)} MCP connections"
        }


async def _do_refresh_tool_index(mcp_name: str | None = None) -> dict:
    """Core indexing logic. Called from lifespan (auto) and refresh_tool_index (manual)."""
    configs = load_mcp_configs()
    indexed_count = 0
    errors = []

    mcps_to_index = [mcp_name] if mcp_name else list(configs.keys())

    for name in mcps_to_index:
        # Skip self to avoid recursive deadlock
        if name == "workflow-manager":
            continue
        if name not in configs:
            errors.append(f"MCP '{name}' not found in config")
            continue

        try:
            conn = await get_mcp_connection(name)
            if not conn:
                errors.append(f"Could not connect to {name}")
                continue

            # Get tools list via MCP protocol
            request_id = increment_request_counter()

            # Send tools/list request
            if not conn.process or conn.process.returncode is not None:
                await conn.start()

            if not conn._initialized:
                await conn._initialize()

            request = {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/list",
                "params": {}
            }

            await conn._send_message(request)
            response = await conn._read_message(timeout=30.0)

            if "error" in response:
                errors.append(f"{name}: {response['error']}")
                continue

            tools = response.get("result", {}).get("tools", [])
            indexed = build_tool_index(name, tools)
            set_tool_index_entry(name, indexed)
            indexed_count += len(indexed)

        except Exception as e:
            errors.append(f"{name}: {str(e)}")

    from ..tool_index import get_tool_index
    return {
        "success": len(errors) == 0,
        "indexed_mcps": list(get_tool_index().keys()),
        "total_tools": indexed_count,
        "errors": errors if errors else None
    }
