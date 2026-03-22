"""Tool registration for workflow-manager MCP server.

Each sub-module registers its tools via a register_*_tools(mcp) function.
"""

from .config import register_config_tools
from .graph_core import register_graph_core_tools
from .graph_management import register_graph_management_tools
from .graph_builder import register_graph_builder_tools
from .proxy import register_proxy_tools
from .deployment import register_deployment_tools
from .experience import register_experience_tools


def register_all_tools(mcp):
    """Register all tool modules with the FastMCP instance."""
    register_config_tools(mcp)
    register_graph_core_tools(mcp)
    register_graph_management_tools(mcp)
    register_graph_builder_tools(mcp)
    register_proxy_tools(mcp)
    register_deployment_tools(mcp)
    register_experience_tools(mcp)
