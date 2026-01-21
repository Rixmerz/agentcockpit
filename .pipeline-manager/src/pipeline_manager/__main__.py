"""Entry point for pipeline-manager MCP."""

import sys


def main() -> int:
    """Run the Pipeline Manager MCP server."""
    from pipeline_manager.server import mcp

    mcp.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
