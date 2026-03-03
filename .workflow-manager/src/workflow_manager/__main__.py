"""Entry point for workflow-manager MCP."""

import sys


def main() -> int:
    """Run the Workflow Manager MCP server."""
    from workflow_manager.server import mcp

    mcp.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
