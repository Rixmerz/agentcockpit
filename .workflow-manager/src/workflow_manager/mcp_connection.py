"""MCP Connection pool management.

Manages subprocess-based connections to external MCP servers
using the JSON-RPC stdio protocol.
"""

import asyncio
import json
import os
import sys
from typing import Optional

from .hub_config import load_mcp_configs


# MCP Connection Pool
_mcp_connections: dict[str, "McpConnection"] = {}
_request_counter = 0


class McpConnection:
    """Manages a connection to an MCP server via subprocess."""

    def __init__(self, name: str, command: str, args: list[str], env: Optional[dict] = None):
        self.name = name
        self.command = command
        self.args = args
        self.env = env or {}
        self.process: Optional[asyncio.subprocess.Process] = None
        self._lock = asyncio.Lock()
        self._initialized = False
        self._init_request_id = 0
        self._use_headers = False  # Most MCP servers use newline-delimited JSON, not Content-Length headers

    async def start(self):
        """Start the MCP subprocess."""
        if self.process and self.process.returncode is None:
            return  # Already running

        # Build environment
        full_env = os.environ.copy()
        full_env.update(self.env)

        # Start process with stdio for JSON-RPC
        self.process = await asyncio.create_subprocess_exec(
            self.command,
            *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=full_env
        )

        # Reset initialization flag when starting new process
        self._initialized = False

    async def _initialize(self):
        """Perform MCP protocol initialization handshake."""
        if self._initialized:
            return

        if not self.process or not self.process.stdin or not self.process.stdout:
            raise RuntimeError("Process not started")

        # Step 1: Send initialize request
        self._init_request_id += 1
        init_request = {
            "jsonrpc": "2.0",
            "id": self._init_request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "clientInfo": {
                    "name": "workflow-manager",
                    "version": "1.0.0"
                }
            }
        }

        await self._send_message(init_request)

        # Read messages until we get the initialize response (skip notifications)
        init_response = None
        for _ in range(10):  # Max 10 messages to find the response
            msg = await self._read_message(timeout=30.0)
            # Check if this is the response to our initialize request
            if msg.get("id") == self._init_request_id:
                init_response = msg
                break
            # Skip notifications (they don't have an id)

        if init_response is None:
            raise RuntimeError("No initialize response received")

        # Check for error in response
        if "error" in init_response:
            raise RuntimeError(f"Initialize failed: {init_response['error']}")

        # Step 2: Send initialized notification (no response expected, but some servers may send one)
        initialized_notification = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }

        await self._send_message(initialized_notification)

        # Small delay to let server process the notification
        await asyncio.sleep(0.1)

        self._initialized = True

    async def _send_message(self, message: dict):
        """Send a message using newline-delimited JSON (standard MCP stdio)."""
        if not self.process or not self.process.stdin:
            raise RuntimeError("Process not started")

        body = json.dumps(message).encode('utf-8')
        self.process.stdin.write(body + b'\n')
        await self.process.stdin.drain()

    async def _read_message(self, timeout: float = 120.0) -> dict:
        """Read a message using newline-delimited JSON (standard MCP stdio)."""
        if not self.process or not self.process.stdout:
            raise RuntimeError("Process not started")

        while True:
            line = await asyncio.wait_for(
                self.process.stdout.readline(),
                timeout=timeout
            )
            if not line:
                raise RuntimeError("Connection closed")

            line_str = line.decode('utf-8').strip()
            if not line_str:
                continue  # Skip empty lines

            try:
                return json.loads(line_str)
            except json.JSONDecodeError:
                # Skip non-JSON lines (like log messages)
                continue

    async def call_tool(self, tool_name: str, arguments: dict, request_id: int) -> dict:
        """Call a tool on this MCP server."""
        async with self._lock:
            if not self.process or self.process.returncode is not None:
                await self.start()

            if not self.process or not self.process.stdin or not self.process.stdout:
                return {"error": {"code": -1, "message": f"Failed to start MCP {self.name}"}}

            # Ensure MCP protocol initialization is done
            if not self._initialized:
                try:
                    await self._initialize()
                except Exception as e:
                    return {"error": {"code": -1, "message": f"MCP initialization failed for {self.name}: {str(e)}"}}

            # Send JSON-RPC request
            request = {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                }
            }

            # Visualization tools need more time (HTML generation over large codebases)
            _SLOW_TOOLS = {"cube_generate_timeline", "cube_generate_heatmap",
                           "cube_generate_architecture", "cube_generate_matrix",
                           "cube_export_html", "cube_get_temporal_features",
                           "cube_simulate_wave", "cube_get_deltas", "cube_detect_clones",
                           "cube_analyze_graph", "cube_cluster_files"}
            _timeout = 360.0 if tool_name in _SLOW_TOOLS else 120.0

            try:
                await self._send_message(request)
                response = await self._read_message(timeout=_timeout)
                return response
            except asyncio.TimeoutError:
                return {"error": {"code": -1, "message": f"Timeout waiting for response from {self.name} (limit: {int(_timeout)}s)"}}
            except json.JSONDecodeError as e:
                return {"error": {"code": -1, "message": f"Invalid JSON from {self.name}: {e}"}}
            except RuntimeError as e:
                return {"error": {"code": -1, "message": str(e)}}

    async def stop(self):
        """Stop the MCP subprocess."""
        if self.process and self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self.process.kill()


async def get_mcp_connection(mcp_name: str) -> Optional[McpConnection]:
    """Get or create an MCP connection."""
    global _mcp_connections

    if mcp_name in _mcp_connections:
        return _mcp_connections[mcp_name]

    # Load config for this MCP
    configs = load_mcp_configs()
    if mcp_name not in configs:
        return None

    config = configs[mcp_name]
    command = config.get("command", "")
    args = config.get("args", [])
    env = config.get("env", {})

    if not command:
        return None

    # Create connection
    conn = McpConnection(mcp_name, command, args, env)
    _mcp_connections[mcp_name] = conn

    return conn


async def close_all_connections() -> list[str]:
    """Close all active MCP connections. Returns list of closed names."""
    global _mcp_connections

    closed = []
    for name, conn in _mcp_connections.items():
        try:
            await conn.stop()
            closed.append(name)
        except Exception as e:
            print(f"[workflow-manager] Warning: failed to close MCP connection '{name}': {e}", file=sys.stderr)
            pass

    _mcp_connections.clear()
    return closed


def get_request_counter() -> int:
    """Get current request counter value."""
    return _request_counter


def increment_request_counter() -> int:
    """Increment and return the request counter."""
    global _request_counter
    _request_counter += 1
    return _request_counter
