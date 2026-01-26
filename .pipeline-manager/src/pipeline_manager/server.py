"""FastMCP server for Pipeline Manager.

Permite a Claude autogestionar el pipeline de flujo:
- Ver estado del pipeline
- Resetear/avanzar el pipeline
- Ver/modificar configuración
- Ver/modificar steps
- Sugerir flujos óptimos
- Ejecutar tools de otros MCPs via proxy (execute_mcp_tool)

Architecture (Centralized Hub - AgentCockpit):
- Pipelines: GLOBAL in {agentcockpit}/.claude/pipelines/
- States: CENTRALIZED in {agentcockpit}/.agentcockpit/states/{project_name}/
- Config: ~/.agentcockpit/config.json defines hub_dir
"""

import os
import json
import asyncio
import subprocess
import uuid
from difflib import SequenceMatcher
from pathlib import Path
from datetime import datetime
from typing import Optional, Any
from fastmcp import FastMCP

# Graph engine imports
from .graph_engine import (
    Graph, Node, Edge, EdgeCondition, GraphState, PathEntry,
    MaxVisitsExceeded, evaluate_transitions, take_transition, generate_mermaid
)
from .graph_parser import parse_graph_yaml, load_graph_from_file, GraphParseError
from .graph_state import (
    load_graph_state, save_graph_state, initialize_graph_state,
    reset_graph_state, get_graph_state_file, get_graph_file, get_node_visit_warning
)

# Create FastMCP server
mcp = FastMCP("pipeline-manager")

# ============================================================================
# AgentCockpit Hub Configuration (Centralized Architecture)
# ============================================================================

AGENTCOCKPIT_CONFIG_FILE = Path.home() / ".agentcockpit" / "config.json"
_hub_config: dict | None = None


def load_hub_config() -> dict:
    """Load AgentCockpit hub configuration from ~/.agentcockpit/config.json.

    Returns config with keys:
        - hub_dir: Absolute path to agentcockpit project
        - pipelines_dir: Relative path for pipelines (default: .claude/pipelines)
        - states_dir: Relative path for states (default: .agentcockpit/states)
    """
    global _hub_config

    if _hub_config is not None:
        return _hub_config

    if not AGENTCOCKPIT_CONFIG_FILE.exists():
        raise ValueError(
            f"AgentCockpit config not found at {AGENTCOCKPIT_CONFIG_FILE}. "
            "Create it with: {\"hub_dir\": \"/path/to/agentcockpit\"}"
        )

    try:
        _hub_config = json.loads(AGENTCOCKPIT_CONFIG_FILE.read_text())
    except Exception as e:
        raise ValueError(f"Error reading AgentCockpit config: {e}")

    if "hub_dir" not in _hub_config:
        raise ValueError("AgentCockpit config missing 'hub_dir' key")

    # Set defaults
    _hub_config.setdefault("pipelines_dir", ".claude/pipelines")
    _hub_config.setdefault("states_dir", ".agentcockpit/states")

    return _hub_config


def get_hub_dir() -> Path:
    """Get the AgentCockpit hub directory."""
    config = load_hub_config()
    return Path(config["hub_dir"])


def get_global_pipelines_dir() -> Path:
    """Get the GLOBAL pipelines directory (in AgentCockpit hub)."""
    config = load_hub_config()
    return Path(config["hub_dir"]) / config["pipelines_dir"]


def get_project_state_dir(project_dir: str) -> Path:
    """Get the centralized state directory for a specific project.

    States are stored in: {agentcockpit}/.agentcockpit/states/{project_name}/
    """
    config = load_hub_config()
    project_name = Path(project_dir).name
    return Path(config["hub_dir"]) / config["states_dir"] / project_name


# ============================================================================
# Session Management (Global dict - persists across MCP calls)
# ============================================================================

# Global session storage - persists within MCP server process
# Key: session_id, Value: {"project_dir": str, "created_at": str}
_session_store: dict[str, dict] = {}

# Default session for single-project use (most common case)
_default_session: dict = {"project_dir": None}


def get_or_create_session(session_id: str | None = None) -> str:
    """Get existing session ID or create a new one."""
    if session_id:
        return session_id
    return str(uuid.uuid4())


def get_session_project_dir(session_id: str | None) -> str | None:
    """Get project_dir for a specific session or default."""
    if session_id and session_id in _session_store:
        return _session_store[session_id].get("project_dir")
    # Fall back to default session
    return _default_session.get("project_dir")


def set_session_project_dir(session_id: str | None, project_dir: str):
    """Store project_dir for a specific session or default."""
    if session_id:
        if session_id not in _session_store:
            _session_store[session_id] = {"created_at": datetime.now().isoformat()}
        _session_store[session_id]["project_dir"] = project_dir
    # Always update default for convenience
    _default_session["project_dir"] = project_dir


def resolve_project_dir(project_dir: str | None, session_id: str | None = None) -> tuple[str, str]:
    """Resolve project_dir from parameter or session.

    Returns (project_dir, session_id).
    Priority: explicit parameter > session cache > default > error
    """
    sid = session_id or "default"

    if project_dir:
        set_session_project_dir(session_id, project_dir)
        return project_dir, sid

    # Try session-specific first, then default
    cached = get_session_project_dir(session_id)
    if cached:
        return cached, sid

    raise ValueError(
        "project_dir required on first call. "
        "Use set_session(project_dir) or pass project_dir explicitly."
    )


# ============================================================================
# Tool Categories for Semantic Search
# ============================================================================

TOOL_CATEGORIES = {
    "containers": {
        "patterns": ["container_", "docker_run", "docker_exec", "docker_start", "docker_stop"],
        "keywords": ["container", "docker", "run", "exec", "start", "stop", "restart"],
        "description": "Container lifecycle management"
    },
    "images": {
        "patterns": ["image_", "docker_pull", "docker_build", "docker_push"],
        "keywords": ["image", "pull", "build", "push", "registry"],
        "description": "Image management"
    },
    "chaos": {
        "patterns": ["fault_", "inject_", "chaos_", "scenario_"],
        "keywords": ["fault", "inject", "chaos", "failure", "stress", "cpu", "memory", "network"],
        "description": "Chaos engineering and fault injection"
    },
    "metrics": {
        "patterns": ["metric_", "baseline_", "capture_", "stats_", "monitor_"],
        "keywords": ["metric", "baseline", "capture", "stats", "monitor", "observe"],
        "description": "Metrics and observability"
    },
    "tunnels": {
        "patterns": ["tunnel_", "expose_", "port_forward", "ngrok"],
        "keywords": ["tunnel", "expose", "port", "forward", "public", "internet", "url"],
        "description": "Tunnels and service exposure"
    },
    "knowledge": {
        "patterns": ["kg_", "memory_", "pattern_", "workflow_", "context_"],
        "keywords": ["knowledge", "memory", "pattern", "workflow", "context", "learn"],
        "description": "Knowledge graph and memory"
    },
    "pipeline": {
        "patterns": ["pipeline_"],
        "keywords": ["pipeline", "step", "advance", "reset", "gate"],
        "description": "Pipeline flow control"
    },
    "thinking": {
        "patterns": ["sequential", "think", "reason"],
        "keywords": ["think", "reason", "analyze", "sequential", "step-by-step"],
        "description": "Reasoning and structured thinking"
    },
    "docs": {
        "patterns": ["get-library-docs", "resolve-library", "search_"],
        "keywords": ["docs", "documentation", "library", "api", "reference"],
        "description": "Documentation retrieval"
    }
}

# Stopwords to filter from queries (common words that add noise)
STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "and", "but", "if", "or",
    "because", "until", "while", "about", "against", "between", "into",
    "through", "during", "before", "after", "above", "below", "up", "down",
    "out", "off", "over", "under", "again", "further", "then", "once",
    "que", "de", "la", "el", "en", "un", "una", "los", "las", "por", "para",
    "con", "del", "al", "es", "son", "como", "más", "pero", "sus", "le",
    "ya", "o", "este", "sí", "porque", "esta", "entre", "cuando", "muy",
    "sin", "sobre", "también", "me", "hasta", "hay", "donde", "quien",
    "desde", "todo", "nos", "durante", "todos", "uno", "les", "ni", "contra",
    "otros", "ese", "eso", "ante", "ellos", "e", "esto", "mí", "antes",
    "algunos", "qué", "unos", "yo", "otro", "otras", "otra", "él", "tanto",
    "esa", "estos", "mucho", "quienes", "nada", "muchos", "cual", "poco",
    "ella", "estar", "estas", "algunas", "algo", "nosotros"
}

# ============================================================================
# Dynamic Weight Learning System (Global)
# ============================================================================

# Global path for learned weights (shared across all projects)
LEARNED_WEIGHTS_FILE = Path.home() / ".pipeline-manager" / "learned_weights.json"

# In-memory cache of learned weights
# Structure: {"mcp:tool_name": {"keyword": weight, ...}, ...}
_learned_weights: dict[str, dict[str, float]] = {}

# Tracking for last search (to correlate with tool selection)
_last_search_query: str | None = None
_last_search_results: list[dict] = []

# Weight learning parameters
WEIGHT_INCREMENT = 0.15  # How much to increase weight per selection
WEIGHT_MAX = 2.0  # Maximum weight cap
WEIGHT_DECAY = 0.01  # Decay per day for unused weights (future use)


def load_learned_weights() -> dict[str, dict[str, float]]:
    """Load learned weights from global file."""
    global _learned_weights

    if LEARNED_WEIGHTS_FILE.exists():
        try:
            data = json.loads(LEARNED_WEIGHTS_FILE.read_text())
            _learned_weights = data.get("weights", {})
            return _learned_weights
        except Exception:
            pass

    _learned_weights = {}
    return _learned_weights


def save_learned_weights():
    """Save learned weights to global file."""
    global _learned_weights

    # Ensure directory exists
    LEARNED_WEIGHTS_FILE.parent.mkdir(parents=True, exist_ok=True)

    data = {
        "weights": _learned_weights,
        "last_updated": datetime.now().isoformat(),
        "version": "1.0"
    }

    LEARNED_WEIGHTS_FILE.write_text(json.dumps(data, indent=2))


def extract_keywords(text: str) -> set[str]:
    """Extract meaningful keywords from text, filtering stopwords."""
    words = set(text.lower().replace("_", " ").replace("-", " ").split())
    return {w for w in words if len(w) > 2 and w not in STOPWORDS}


def record_tool_selection(query: str, mcp_name: str, tool_name: str):
    """Record that a tool was selected for a query, incrementing weights."""
    global _learned_weights

    # Load weights if not loaded
    if not _learned_weights:
        load_learned_weights()

    tool_key = f"{mcp_name}:{tool_name}"
    keywords = extract_keywords(query)

    if not keywords:
        return

    if tool_key not in _learned_weights:
        _learned_weights[tool_key] = {}

    for keyword in keywords:
        current = _learned_weights[tool_key].get(keyword, 0.0)
        # Increment with cap
        _learned_weights[tool_key][keyword] = min(current + WEIGHT_INCREMENT, WEIGHT_MAX)

    # Persist to disk
    save_learned_weights()


def get_learned_boost(query: str, mcp_name: str, tool_name: str) -> float:
    """Calculate learned boost for a tool given a query."""
    global _learned_weights

    # Load weights if not loaded
    if not _learned_weights:
        load_learned_weights()

    tool_key = f"{mcp_name}:{tool_name}"

    if tool_key not in _learned_weights:
        return 0.0

    keywords = extract_keywords(query)
    if not keywords:
        return 0.0

    tool_weights = _learned_weights[tool_key]

    # Sum weights for matching keywords
    total_boost = sum(tool_weights.get(kw, 0.0) for kw in keywords)

    # Normalize by number of query keywords
    return total_boost / len(keywords)


def set_last_search(query: str, results: list[dict]):
    """Track the last search for correlation with tool selection."""
    global _last_search_query, _last_search_results
    _last_search_query = query
    _last_search_results = results


def check_and_record_selection(mcp_name: str, tool_name: str):
    """Check if this tool was in the last search results and record selection."""
    global _last_search_query, _last_search_results

    if not _last_search_query or not _last_search_results:
        return

    # Check if this tool was in the search results
    for result in _last_search_results:
        if result.get("mcp") == mcp_name and result.get("tool") == tool_name:
            # Tool was in results! Record the selection
            record_tool_selection(_last_search_query, mcp_name, tool_name)
            break


# Tool index cache for semantic search
_tool_index: dict[str, list[dict]] = {}


def build_tool_index(mcp_name: str, tools: list[dict]) -> list[dict]:
    """Build searchable index of tools with extracted keywords."""
    indexed = []
    for tool in tools:
        name = tool.get("name", "")
        desc = tool.get("description", "")

        # Extract keywords from name (split on underscore, dash, camelCase)
        name_words = set(name.lower().replace("_", " ").replace("-", " ").split())

        # Extract meaningful words from description (>3 chars)
        desc_words = set(
            word.lower().strip(".,;:()[]{}")
            for word in desc.split()
            if len(word) > 3
        )

        # Detect category
        category = detect_tool_category(name, desc)

        indexed.append({
            "name": name,
            "description": desc[:150] if desc else "",  # Truncate for token efficiency
            "keywords": name_words | desc_words,
            "category": category
        })

    return indexed


def detect_tool_category(name: str, description: str) -> str:
    """Detect category for a tool based on name and description patterns."""
    name_lower = name.lower()
    desc_lower = description.lower() if description else ""

    for cat_name, cat_info in TOOL_CATEGORIES.items():
        # Check patterns in name
        for pattern in cat_info.get("patterns", []):
            if pattern in name_lower:
                return cat_name

        # Check keywords in name or description
        for keyword in cat_info.get("keywords", []):
            if keyword in name_lower or keyword in desc_lower:
                return cat_name

    return "other"


def semantic_search(query: str, mcp_filter: str | None = None, max_results: int = 10) -> list[dict]:
    """Search tools by objective/description using semantic similarity + learned weights."""
    # Extract keywords filtering stopwords
    query_words = extract_keywords(query)

    if not query_words:
        # Fallback to raw words if all were stopwords
        query_words = set(query.lower().split())

    results = []

    for mcp_name, tools in _tool_index.items():
        if mcp_filter and mcp_name != mcp_filter:
            continue

        for tool in tools:
            # Base score: keyword intersection + string similarity
            keyword_score = len(query_words & tool["keywords"]) / max(len(query_words), 1)
            name_score = SequenceMatcher(None, query.lower(), tool["name"].lower()).ratio()
            desc_score = SequenceMatcher(None, query.lower(), tool["description"].lower()).ratio()

            # Base weighted combination
            base_score = (keyword_score * 0.5) + (name_score * 0.3) + (desc_score * 0.2)

            # Apply learned boost from user selections
            learned_boost = get_learned_boost(query, mcp_name, tool["name"])

            # Final score = base + learned (learned can significantly boost)
            final_score = base_score + learned_boost

            if final_score > 0.15:  # Minimum threshold
                results.append({
                    "mcp": mcp_name,
                    "tool": tool["name"],
                    "description": tool["description"],
                    "category": tool.get("category", "other"),
                    "score": round(final_score, 2),
                    "learned_boost": round(learned_boost, 2) if learned_boost > 0 else None
                })

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    # Track this search for selection correlation
    final_results = results[:max_results]
    set_last_search(query, final_results)

    return final_results


def get_tools_by_category(mcp_name: str | None, category: str, limit: int = 20) -> list[dict]:
    """Get tools filtered by category."""
    results = []

    for mcp, tools in _tool_index.items():
        if mcp_name and mcp != mcp_name:
            continue

        for tool in tools:
            if tool.get("category") == category:
                results.append({
                    "mcp": mcp,
                    "name": tool["name"],
                    "description": tool["description"]
                })

                if len(results) >= limit:
                    return results

    return results


# ============================================================================
# Pipeline Directory Helpers
# ============================================================================

def get_pipeline_dir(project_dir: str) -> Path:
    """Get pipeline directory for a specific project.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)

    Returns:
        Path to {project_dir}/.claude/pipeline/

    Raises:
        ValueError: If project_dir is empty or None
    """
    if not project_dir:
        raise ValueError("project_dir is required. Pipeline manager only works per-project.")

    project_path = Path(project_dir)
    if not project_path.exists():
        raise ValueError(f"Project directory does not exist: {project_dir}")

    return project_path / ".claude" / "pipeline"


# DEPRECATED: get_state_file and get_steps_file removed - use graph_state.py instead

# MCP Configuration paths (order of priority)
AGENTCOCKPIT_MCP_CONFIG = Path.home() / ".agentcockpit" / "mcps.json"
CLAUDE_CODE_CONFIG = Path.home() / ".claude.json"

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
        import os
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
                    "name": "pipeline-manager",
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

            try:
                await self._send_message(request)
                response = await self._read_message(timeout=120.0)
                return response
            except asyncio.TimeoutError:
                return {"error": {"code": -1, "message": f"Timeout waiting for response from {self.name}"}}
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


def load_mcp_configs() -> dict[str, dict]:
    """Load MCP configurations.

    Priority:
    1. ~/.agentcockpit/mcps.json (centralized AgentCockpit config)
    2. ~/.claude.json (Claude Code config, fallback)

    The AgentCockpit config has a different structure with nested 'config' keys.
    """
    # Try AgentCockpit config first (centralized)
    try:
        if AGENTCOCKPIT_MCP_CONFIG.exists():
            data = json.loads(AGENTCOCKPIT_MCP_CONFIG.read_text())
            mcp_servers = data.get("mcpServers", {})
            # AgentCockpit format: {"name": {"name": ..., "config": {...}}}
            # We need to extract the config from each entry
            result = {}
            for name, entry in mcp_servers.items():
                if isinstance(entry, dict):
                    # Check if this is AgentCockpit format (has 'config' key)
                    if "config" in entry:
                        result[name] = entry["config"]
                    else:
                        # Fallback to treating entry as config directly
                        result[name] = entry
            if result:
                return result
    except Exception as e:
        pass

    # Fallback to Claude Code config
    try:
        if CLAUDE_CODE_CONFIG.exists():
            config = json.loads(CLAUDE_CODE_CONFIG.read_text())
            return config.get("mcpServers", {})
    except Exception:
        pass

    return {}


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


# DEPRECATED: load_state, save_state, load_steps, load_config removed
# Use graph_state.py and graph_parser.py instead


# === MCP Tools ===

@mcp.tool()
def set_session(project_dir: str, session_id: str | None = None) -> dict:
    """Establece el proyecto activo para la sesión actual.

    Llamar esta función una vez al inicio evita repetir project_dir
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
    pipeline_dir = get_pipeline_dir(project_dir)

    return {
        "success": True,
        "session_id": sid,
        "project_dir": project_dir,
        "pipeline_dir": str(pipeline_dir),
        "message": "Session established. project_dir no longer required in subsequent calls."
    }


# DEPRECATED: pipeline_status, pipeline_reset, pipeline_advance, pipeline_set_step, pipeline_set_config
# Use graph_status, graph_reset, graph_traverse, graph_set_node instead


def get_enforcer_config_file(project_dir: str) -> Path:
    """Get the enforcer config file path (CENTRALIZED in hub)."""
    return get_project_state_dir(project_dir) / "config.json"


def load_enforcer_config(project_dir: str) -> dict:
    """Load enforcer configuration from config.json."""
    config_file = get_enforcer_config_file(project_dir)
    if config_file.exists():
        try:
            return json.loads(config_file.read_text())
        except Exception:
            pass
    return {"enforcer_enabled": True}


def save_enforcer_config(project_dir: str, config: dict):
    """Save enforcer configuration to config.json."""
    config_file = get_enforcer_config_file(project_dir)
    config_file.parent.mkdir(parents=True, exist_ok=True)
    config["last_updated"] = datetime.now().isoformat()
    config_file.write_text(json.dumps(config, indent=2))


@mcp.tool()
def pipeline_set_enabled(enabled: bool, project_dir: str | None = None, session_id: str | None = None) -> dict:
    """Activa o desactiva el enforcer del pipeline.

    Cuando está desactivado, el hook aprueba todas las herramientas sin validar.
    Esto es útil para pausar temporalmente el control del pipeline.

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
            "message": f"Pipeline enforcer {'enabled' if enabled else 'disabled'}",
            "project_dir": resolved_dir
        }
    except Exception as e:
        return {
            "success": False,
            "session_id": sid,
            "message": f"Error setting pipeline enabled state: {str(e)}",
            "project_dir": resolved_dir
        }


def get_pipelines_library_dir(project_dir: str | None = None) -> Path:
    """Get the GLOBAL pipelines library directory from AgentCockpit hub.

    Pipelines are ALWAYS global (centralized in AgentCockpit).
    Returns {agentcockpit}/.claude/pipelines/

    Args:
        project_dir: Ignored - kept for backward compatibility
    """
    return get_global_pipelines_dir()


# DEPRECATED: pipeline_list_available, pipeline_activate, pipeline_create_step removed
# Use graph_list_available, graph_activate instead

# DEPRECATED: advance_to_next_step, check_and_advance_gate, pipeline_check_phrase removed
# Use graph_traverse, graph_check_tool, graph_check_phrase instead


@mcp.tool()
async def execute_mcp_tool(
    mcp_name: str,
    tool_name: str,
    arguments: dict[str, Any],
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Execute any available MCP tool through the graph pipeline proxy.

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
    global _request_counter

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
        except Exception:
            pass  # Fall back to allowing all MCPs

    # 2. Validate MCP is allowed in current node
    if "*" not in enabled_mcps and mcp_name not in enabled_mcps:
        return {
            "error": True,
            "session_id": sid,
            "message": f"❌ MCP '{mcp_name}' is not available in node '{current_node.id if current_node else 'unknown'}': {current_node.name if current_node else 'No node'}",
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
    _request_counter += 1
    try:
        result = await conn.call_tool(tool_name, arguments, _request_counter)
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
    """Busca tools por objetivo o descripción usando similitud semántica.

    Útil cuando no conoces el nombre exacto de una tool pero sabes qué quieres hacer.

    Args:
        query: Descripción del objetivo (ej: "exponer servicio a internet", "ver logs de container")
        max_results: Máximo de resultados (default 10)
        mcp_filter: Filtrar por MCP específico (opcional)

    Examples:
        search_tools(query="exponer servicio a internet") → tunnel_create
        search_tools(query="ver logs de container") → container_logs
        search_tools(query="inyectar falla de cpu") → fault_inject_cpu
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
    """Ver los pesos aprendidos por el sistema de búsqueda.

    Muestra qué tools han sido seleccionadas y para qué keywords,
    permitiendo entender cómo el sistema ha aprendido de tus selecciones.

    Args:
        tool_filter: Filtrar por nombre de tool (parcial)
        top_n: Número máximo de tools a mostrar (default 20)
    """
    global _learned_weights

    if not _learned_weights:
        load_learned_weights()

    if not _learned_weights:
        return {
            "message": "No learned weights yet. Use search_tools() and execute tools to train.",
            "weights": {},
            "total_tools": 0
        }

    # Filter and sort by total weight
    results = []
    for tool_key, keywords in _learned_weights.items():
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
        "total_tools": len(_learned_weights),
        "showing": len(results),
        "file": str(LEARNED_WEIGHTS_FILE)
    }


@mcp.tool()
def reset_learned_weights(confirm: bool = False) -> dict:
    """Resetea todos los pesos aprendidos.

    CUIDADO: Esto borra todo el aprendizaje acumulado.

    Args:
        confirm: Debe ser True para confirmar el reset
    """
    global _learned_weights

    if not confirm:
        return {
            "success": False,
            "message": "Set confirm=True to reset all learned weights",
            "current_tools": len(_learned_weights)
        }

    _learned_weights = {}
    save_learned_weights()

    return {
        "success": True,
        "message": "All learned weights have been reset",
        "file": str(LEARNED_WEIGHTS_FILE)
    }


@mcp.tool()
async def refresh_tool_index(mcp_name: str | None = None) -> dict:
    """Actualiza el índice de tools para búsqueda semántica.

    Conecta a los MCPs y obtiene su lista de tools para indexar.
    Ejecutar después de agregar nuevos MCPs o cuando el índice esté vacío.

    Args:
        mcp_name: MCP específico a indexar (opcional, default: todos)
    """
    global _tool_index

    configs = load_mcp_configs()
    indexed_count = 0
    errors = []

    mcps_to_index = [mcp_name] if mcp_name else list(configs.keys())

    for name in mcps_to_index:
        if name not in configs:
            errors.append(f"MCP '{name}' not found in config")
            continue

        try:
            conn = await get_mcp_connection(name)
            if not conn:
                errors.append(f"Could not connect to {name}")
                continue

            # Get tools list via MCP protocol
            global _request_counter
            _request_counter += 1

            # Send tools/list request
            if not conn.process or conn.process.returncode is not None:
                await conn.start()

            if not conn._initialized:
                await conn._initialize()

            request = {
                "jsonrpc": "2.0",
                "id": _request_counter,
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
            _tool_index[name] = indexed
            indexed_count += len(indexed)

        except Exception as e:
            errors.append(f"{name}: {str(e)}")

    return {
        "success": len(errors) == 0,
        "indexed_mcps": list(_tool_index.keys()),
        "total_tools": indexed_count,
        "errors": errors if errors else None
    }


@mcp.tool()
async def close_mcp_connections() -> dict:
    """Close all active MCP connections.

    Use this to clean up resources when done with MCP tools.
    Connections will be re-established on next use.
    """
    global _mcp_connections

    closed = []
    for name, conn in _mcp_connections.items():
        try:
            await conn.stop()
            closed.append(name)
        except Exception:
            pass

    _mcp_connections.clear()

    return {
        "success": True,
        "closed": closed,
        "message": f"Closed {len(closed)} MCP connections"
    }


# ============================================================================
# Graph Pipeline Functions (v2.0 - Directed Graph Engine)
# ============================================================================

def _load_active_graph(project_dir: str) -> tuple[Graph, GraphState]:
    """Load active graph and state for a project.

    Returns:
        Tuple of (Graph, GraphState)

    Raises:
        ValueError: If no graph is configured
    """
    graph_file = get_graph_file(project_dir)
    if not graph_file.exists():
        raise ValueError(f"No graph.yaml found at {graph_file}")

    graph = load_graph_from_file(graph_file)
    state = load_graph_state(project_dir)

    # Initialize state if empty
    if not state.current_nodes:
        graph_name = graph.metadata.get('name', 'unnamed')
        state = initialize_graph_state(project_dir, graph, graph_name)

    return graph, state


@mcp.tool()
def graph_status(project_dir: str | None = None, session_id: str | None = None) -> dict:
    """Get current graph pipeline status: current node, available edges, visits.

    Returns the current node, outgoing edges sorted by priority,
    and visit counts for loop protection monitoring.

    Args:
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, state = _load_active_graph(resolved_dir)
    except ValueError as e:
        return {
            "error": True,
            "session_id": sid,
            "message": str(e),
            "hint": "Create a graph.yaml file or use graph_activate() to load one",
            "project_dir": resolved_dir
        }
    except GraphParseError as e:
        return {
            "error": True,
            "session_id": sid,
            "message": f"Graph parse error: {e}",
            "project_dir": resolved_dir
        }

    current_node_id = state.get_current_node()
    current_node = graph.nodes.get(current_node_id) if current_node_id else None

    # Get outgoing edges
    outgoing_edges = graph.get_outgoing_edges(current_node_id) if current_node_id else []
    edges_info = []
    for edge in outgoing_edges:
        edge_info = {
            "id": edge.id,
            "to": edge.to_node,
            "to_name": graph.nodes[edge.to_node].name if edge.to_node in graph.nodes else edge.to_node,
            "condition_type": edge.condition.type,
            "priority": edge.priority
        }
        if edge.condition.tool:
            edge_info["condition_tool"] = edge.condition.tool
        if edge.condition.phrases:
            edge_info["condition_phrases"] = edge.condition.phrases
        edges_info.append(edge_info)

    # Check for visit warnings
    warnings = []
    if current_node:
        warning = get_node_visit_warning(state, current_node_id, current_node.max_visits)
        if warning:
            warnings.append(warning)

    # Get enforcer config
    enforcer_config = load_enforcer_config(resolved_dir)

    return {
        "session_id": sid,
        "graph_name": state.active_graph or graph.metadata.get('name', 'unnamed'),
        "current_node": {
            "id": current_node_id,
            "name": current_node.name if current_node else None,
            "mcps_enabled": current_node.mcps_enabled if current_node else [],
            "tools_blocked": current_node.tools_blocked if current_node else [],
            "is_end": current_node.is_end if current_node else False,
            "visits": state.get_visit_count(current_node_id) if current_node_id else 0,
            "max_visits": current_node.max_visits if current_node else 10
        },
        "available_edges": edges_info,
        "total_transitions": state.total_transitions,
        "warnings": warnings if warnings else None,
        "enabled": enforcer_config.get("enforcer_enabled", True),
        "prompt_injection": current_node.prompt_injection if current_node else None,
        "last_activity": state.last_activity,
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_traverse(
    edge_id: str,
    reason: str = "Manual traverse",
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Traverse a specific edge to move to next node.

    Use this to explicitly move through the graph. Check graph_status()
    first to see available edges.

    Args:
        edge_id: ID of the edge to traverse
        reason: Human-readable reason for this transition
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, state = _load_active_graph(resolved_dir)
    except (ValueError, GraphParseError) as e:
        return {
            "error": True,
            "session_id": sid,
            "message": str(e),
            "project_dir": resolved_dir
        }

    # Find the edge
    edge = None
    for e in graph.edges:
        if e.id == edge_id:
            edge = e
            break

    if not edge:
        return {
            "error": True,
            "session_id": sid,
            "message": f"Edge '{edge_id}' not found",
            "available_edges": [e.id for e in graph.get_outgoing_edges(state.get_current_node())],
            "project_dir": resolved_dir
        }

    # Verify edge starts from current node
    current_node_id = state.get_current_node()
    if edge.from_node != current_node_id:
        return {
            "error": True,
            "session_id": sid,
            "message": f"Edge '{edge_id}' does not start from current node '{current_node_id}'",
            "edge_from": edge.from_node,
            "project_dir": resolved_dir
        }

    # Execute transition
    try:
        state = take_transition(graph, state, edge, reason)
        save_graph_state(resolved_dir, state)
    except MaxVisitsExceeded as e:
        # Get alternative edges
        other_edges = [
            ed for ed in graph.get_outgoing_edges(current_node_id)
            if ed.to_node != edge.to_node
        ]
        return {
            "error": True,
            "session_id": sid,
            "message": str(e),
            "blocked_node": e.node_id,
            "visits": e.current_visits,
            "max_visits": e.max_visits,
            "alternative_edges": [ed.id for ed in other_edges],
            "hint": "Use graph_override_max_visits() if you need to exceed the limit",
            "project_dir": resolved_dir
        }

    # Get new node info
    new_node = graph.nodes.get(state.get_current_node())

    return {
        "success": True,
        "session_id": sid,
        "traversed_edge": edge_id,
        "from_node": edge.from_node,
        "to_node": edge.to_node,
        "new_node": {
            "id": new_node.id if new_node else edge.to_node,
            "name": new_node.name if new_node else None,
            "mcps_enabled": new_node.mcps_enabled if new_node else [],
            "is_end": new_node.is_end if new_node else False,
            "visits": state.get_visit_count(edge.to_node)
        },
        "total_transitions": state.total_transitions,
        "prompt_injection": new_node.prompt_injection if new_node else None,
        "reason": reason,
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_check_tool(
    mcp_name: str,
    tool_name: str,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Check if a tool call would trigger any edge transitions.

    Use this BEFORE executing a tool to see if it would cause a transition.
    Does NOT execute the transition - use graph_traverse() for that.

    Args:
        mcp_name: Name of the MCP server
        tool_name: Name of the tool
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, state = _load_active_graph(resolved_dir)
    except (ValueError, GraphParseError) as e:
        return {
            "matched": False,
            "session_id": sid,
            "message": str(e),
            "project_dir": resolved_dir
        }

    # Evaluate transitions
    trigger_value = {'mcp': mcp_name, 'tool': tool_name}
    matching_edges = evaluate_transitions(graph, state, 'tool', trigger_value)

    if not matching_edges:
        return {
            "matched": False,
            "session_id": sid,
            "message": f"Tool '{mcp_name}.{tool_name}' does not trigger any transitions",
            "current_node": state.get_current_node(),
            "project_dir": resolved_dir
        }

    edges_info = []
    for edge in matching_edges:
        edges_info.append({
            "id": edge.id,
            "to": edge.to_node,
            "to_name": graph.nodes[edge.to_node].name if edge.to_node in graph.nodes else edge.to_node,
            "priority": edge.priority
        })

    return {
        "matched": True,
        "session_id": sid,
        "tool": f"{mcp_name}.{tool_name}",
        "matching_edges": edges_info,
        "recommended_edge": matching_edges[0].id if matching_edges else None,
        "hint": "Use graph_traverse(edge_id) to execute the transition",
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_check_phrase(
    text: str,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Check if text contains phrases that would trigger edge transitions.

    Use this to indicate conditions through phrases (e.g., "trivial", "no docs needed").
    Does NOT execute the transition - use graph_traverse() for that.

    Args:
        text: Text to check against edge phrases
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, state = _load_active_graph(resolved_dir)
    except (ValueError, GraphParseError) as e:
        return {
            "matched": False,
            "session_id": sid,
            "message": str(e),
            "project_dir": resolved_dir
        }

    # Evaluate transitions
    trigger_value = {'text': text}
    matching_edges = evaluate_transitions(graph, state, 'phrase', trigger_value)

    if not matching_edges:
        # Get available phrases from current node's edges
        current_edges = graph.get_outgoing_edges(state.get_current_node())
        all_phrases = []
        for edge in current_edges:
            if edge.condition.phrases:
                all_phrases.extend(edge.condition.phrases)

        return {
            "matched": False,
            "session_id": sid,
            "message": "No matching phrases found",
            "current_node": state.get_current_node(),
            "available_phrases": all_phrases if all_phrases else None,
            "project_dir": resolved_dir
        }

    # Find which phrase matched
    matched_phrase = None
    for edge in matching_edges:
        _, phrase = edge.condition.matches_phrase(text)
        if phrase:
            matched_phrase = phrase
            break

    edges_info = []
    for edge in matching_edges:
        edges_info.append({
            "id": edge.id,
            "to": edge.to_node,
            "to_name": graph.nodes[edge.to_node].name if edge.to_node in graph.nodes else edge.to_node,
            "priority": edge.priority
        })

    return {
        "matched": True,
        "session_id": sid,
        "matched_phrase": matched_phrase,
        "matching_edges": edges_info,
        "recommended_edge": matching_edges[0].id if matching_edges else None,
        "hint": "Use graph_traverse(edge_id) to execute the transition",
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_reset(project_dir: str | None = None, session_id: str | None = None) -> dict:
    """Reset graph to start node.

    Clears all visit counts and execution history.

    Args:
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, _ = _load_active_graph(resolved_dir)
    except (ValueError, GraphParseError) as e:
        return {
            "error": True,
            "session_id": sid,
            "message": str(e),
            "project_dir": resolved_dir
        }

    state = reset_graph_state(resolved_dir, graph)
    start_node = graph.get_start_node()

    return {
        "success": True,
        "session_id": sid,
        "message": "Graph reset to start node",
        "current_node": {
            "id": start_node.id if start_node else None,
            "name": start_node.name if start_node else None
        },
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_set_node(
    node_id: str,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Jump to a specific node (admin function).

    Use with caution - bypasses normal transition logic.

    Args:
        node_id: ID of the node to jump to
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, state = _load_active_graph(resolved_dir)
    except (ValueError, GraphParseError) as e:
        return {
            "error": True,
            "session_id": sid,
            "message": str(e),
            "project_dir": resolved_dir
        }

    if node_id not in graph.nodes:
        return {
            "error": True,
            "session_id": sid,
            "message": f"Node '{node_id}' not found",
            "available_nodes": list(graph.nodes.keys()),
            "project_dir": resolved_dir
        }

    # Record the jump
    state.record_transition(
        from_node=state.get_current_node(),
        to_node=node_id,
        edge_id=None,
        reason=f"Admin jump to {node_id}"
    )
    save_graph_state(resolved_dir, state)

    node = graph.nodes[node_id]
    return {
        "success": True,
        "session_id": sid,
        "message": f"Jumped to node '{node_id}'",
        "current_node": {
            "id": node.id,
            "name": node.name,
            "mcps_enabled": node.mcps_enabled,
            "is_end": node.is_end,
            "visits": state.get_visit_count(node_id)
        },
        "prompt_injection": node.prompt_injection,
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_visualize(project_dir: str | None = None, session_id: str | None = None) -> dict:
    """Generate Mermaid diagram of the graph.

    Returns a Mermaid flowchart that can be rendered in markdown.
    Current node is highlighted in green.

    Args:
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, state = _load_active_graph(resolved_dir)
    except (ValueError, GraphParseError) as e:
        return {
            "error": True,
            "session_id": sid,
            "message": str(e),
            "project_dir": resolved_dir
        }

    mermaid = generate_mermaid(graph, state)

    return {
        "success": True,
        "session_id": sid,
        "graph_name": state.active_graph or graph.metadata.get('name', 'unnamed'),
        "mermaid": mermaid,
        "hint": "Render this in a markdown code block with ```mermaid",
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_validate(project_dir: str | None = None, session_id: str | None = None) -> dict:
    """Validate the current graph structure.

    Checks for orphan nodes, missing references, and other structural issues.

    Args:
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    graph_file = get_graph_file(resolved_dir)
    if not graph_file.exists():
        return {
            "valid": False,
            "session_id": sid,
            "message": "No graph.yaml found",
            "project_dir": resolved_dir
        }

    try:
        graph = load_graph_from_file(graph_file)
    except GraphParseError as e:
        return {
            "valid": False,
            "session_id": sid,
            "errors": [str(e)],
            "project_dir": resolved_dir
        }

    errors = graph.validate()

    return {
        "valid": len(errors) == 0,
        "session_id": sid,
        "graph_name": graph.metadata.get('name', 'unnamed'),
        "node_count": len(graph.nodes),
        "edge_count": len(graph.edges),
        "errors": errors if errors else None,
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_override_max_visits(
    node_id: str,
    new_max: int,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Override max_visits for a specific node (escape hatch for loops).

    Use this when you need to exceed a node's visit limit for legitimate reasons.
    The override only affects the in-memory graph state for this session.

    Args:
        node_id: ID of the node to override
        new_max: New maximum visits (must be > current visits)
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    try:
        graph, state = _load_active_graph(resolved_dir)
    except (ValueError, GraphParseError) as e:
        return {
            "error": True,
            "session_id": sid,
            "message": str(e),
            "project_dir": resolved_dir
        }

    if node_id not in graph.nodes:
        return {
            "error": True,
            "session_id": sid,
            "message": f"Node '{node_id}' not found",
            "project_dir": resolved_dir
        }

    current_visits = state.get_visit_count(node_id)
    if new_max <= current_visits:
        return {
            "error": True,
            "session_id": sid,
            "message": f"new_max ({new_max}) must be greater than current visits ({current_visits})",
            "project_dir": resolved_dir
        }

    # Update the node's max_visits (in-memory only - doesn't persist to YAML)
    graph.nodes[node_id].max_visits = new_max

    return {
        "success": True,
        "session_id": sid,
        "message": f"Node '{node_id}' max_visits updated to {new_max}",
        "node_id": node_id,
        "current_visits": current_visits,
        "new_max_visits": new_max,
        "warning": "This override is in-memory only and will reset when graph is reloaded",
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_list_available(project_dir: str | None = None, session_id: str | None = None) -> dict:
    """List all available graphs in the project's pipelines library.

    Args:
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)
    pipelines_dir = get_pipelines_library_dir(resolved_dir)

    if not pipelines_dir.exists():
        return {
            "success": False,
            "session_id": sid,
            "message": f"Pipelines directory not found: {pipelines_dir}",
            "graphs": [],
            "project_dir": resolved_dir
        }

    graphs = []

    # Look for graph.yaml files (v2 format)
    for yaml_file in pipelines_dir.glob("*-graph.yaml"):
        graph_name = yaml_file.stem
        try:
            content = yaml_file.read_text()
            name = graph_name
            description = ""
            version = ""
            for line in content.split('\n'):
                stripped = line.strip()
                if stripped.startswith('name:'):
                    name = stripped.split(':', 1)[1].strip().strip('"').strip("'")
                elif stripped.startswith('description:'):
                    description = stripped.split(':', 1)[1].strip().strip('"').strip("'")
                elif stripped.startswith('version:'):
                    version = stripped.split(':', 1)[1].strip().strip('"').strip("'")
            graphs.append({
                "id": graph_name,
                "name": name,
                "description": description,
                "version": version,
                "file": str(yaml_file),
                "type": "graph"
            })
        except Exception:
            graphs.append({
                "id": graph_name,
                "name": graph_name,
                "file": str(yaml_file),
                "type": "graph"
            })

    return {
        "success": True,
        "session_id": sid,
        "graphs": graphs,
        "total": len(graphs),
        "project_dir": resolved_dir
    }


@mcp.tool()
def graph_activate(
    graph_name: str,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Activate a graph from the pipelines library.

    Copies the graph YAML to graph.yaml and initializes state.

    Args:
        graph_name: Name of the graph file (without -graph.yaml extension)
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)
    pipelines_dir = get_pipelines_library_dir(resolved_dir)

    # Try both naming conventions
    graph_file = pipelines_dir / f"{graph_name}-graph.yaml"
    if not graph_file.exists():
        graph_file = pipelines_dir / f"{graph_name}.yaml"

    if not graph_file.exists():
        available = [f.stem for f in pipelines_dir.glob("*-graph.yaml")] if pipelines_dir.exists() else []
        return {
            "success": False,
            "session_id": sid,
            "message": f"Graph '{graph_name}' not found",
            "available_graphs": available,
            "project_dir": resolved_dir
        }

    # Parse to validate
    try:
        graph = load_graph_from_file(graph_file)
    except GraphParseError as e:
        return {
            "success": False,
            "session_id": sid,
            "message": f"Invalid graph: {e}",
            "project_dir": resolved_dir
        }

    # Copy to active graph.yaml
    target_file = get_graph_file(resolved_dir)
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(graph_file.read_text())

    # Initialize state
    state = initialize_graph_state(resolved_dir, graph, graph_name)
    start_node = graph.get_start_node()

    return {
        "success": True,
        "session_id": sid,
        "message": f"Graph '{graph_name}' activated",
        "graph_name": graph.metadata.get('name', graph_name),
        "node_count": len(graph.nodes),
        "edge_count": len(graph.edges),
        "current_node": {
            "id": start_node.id if start_node else None,
            "name": start_node.name if start_node else None
        },
        "prompt_injection": start_node.prompt_injection if start_node else None,
        "project_dir": resolved_dir
    }
