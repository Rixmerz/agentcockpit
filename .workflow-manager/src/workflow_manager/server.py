"""FastMCP server for Workflow Manager.

Permite a Claude autogestionar el workflow de flujo:
- Ver estado del workflow
- Resetear/avanzar el workflow
- Ver/modificar configuración
- Ver/modificar steps
- Sugerir flujos óptimos
- Ejecutar tools de otros MCPs via proxy (execute_mcp_tool)

Architecture (Centralized Hub - AgentCockpit):
- Workflows: GLOBAL in {agentcockpit}/.claude/workflows/
- States: CENTRALIZED in {agentcockpit}/.agentcockpit/states/{project_name}/
- Config: ~/.agentcockpit/config.json defines hub_dir
"""

import os
import sys
import json
import asyncio
import subprocess
import uuid
from contextlib import asynccontextmanager
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
from .experience_memory import (
    ExperienceMemoryStore, ExperienceEntry, merge_stores,
    generalize_path, extract_file_keywords, guess_domain, update_confidence,
    compute_relevance, GLOBAL_MEMORY_FILE, PROJECT_MEMORIES_DIR,
)


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

# ============================================================================
# AgentCockpit Hub Configuration (Centralized Architecture)
# ============================================================================

AGENTCOCKPIT_CONFIG_FILE = Path.home() / ".agentcockpit" / "config.json"
_hub_config: dict | None = None


def load_hub_config() -> dict:
    """Load AgentCockpit hub configuration from ~/.agentcockpit/config.json.

    Returns config with keys:
        - hub_dir: Absolute path to agentcockpit project
        - workflows_dir: Relative path for workflows (default: .claude/workflows)
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
    _hub_config.setdefault("workflows_dir", ".claude/workflows")
    _hub_config.setdefault("states_dir", ".agentcockpit/states")

    return _hub_config


def get_hub_dir() -> Path:
    """Get the AgentCockpit hub directory."""
    config = load_hub_config()
    return Path(config["hub_dir"])


def get_global_workflows_dir() -> Path:
    """Get the GLOBAL workflows directory (in AgentCockpit hub)."""
    config = load_hub_config()
    return Path(config["hub_dir"]) / config["workflows_dir"]


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
    "workflow": {
        "patterns": ["workflow_"],
        "keywords": ["workflow", "step", "advance", "reset", "gate"],
        "description": "Workflow flow control"
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
LEARNED_WEIGHTS_FILE = Path.home() / ".workflow-manager" / "learned_weights.json"

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
# Workflow Directory Helpers
# ============================================================================

def get_workflow_dir(project_dir: str) -> Path:
    """Get workflow directory for a specific project.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)

    Returns:
        Path to {project_dir}/.claude/workflow/

    Raises:
        ValueError: If project_dir is empty or None
    """
    if not project_dir:
        raise ValueError("project_dir is required. Workflow manager only works per-project.")

    project_path = Path(project_dir)
    if not project_path.exists():
        raise ValueError(f"Project directory does not exist: {project_dir}")

    return project_path / ".claude" / "workflow"


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
    workflow_dir = get_workflow_dir(project_dir)

    return {
        "success": True,
        "session_id": sid,
        "project_dir": project_dir,
        "workflow_dir": str(workflow_dir),
        "message": "Session established. project_dir no longer required in subsequent calls."
    }


# DEPRECATED: workflow_status, workflow_reset, workflow_advance, workflow_set_step, workflow_set_config
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
def workflow_set_enabled(enabled: bool, project_dir: str | None = None, session_id: str | None = None) -> dict:
    """Activa o desactiva el enforcer del workflow.

    Cuando está desactivado, el hook aprueba todas las herramientas sin validar.
    Esto es útil para pausar temporalmente el control del workflow.

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


def get_workflows_library_dir(project_dir: str | None = None) -> Path:
    """Get the GLOBAL workflows library directory from AgentCockpit hub.

    Workflows are ALWAYS global (centralized in AgentCockpit).
    Returns {agentcockpit}/.claude/workflows/

    Args:
        project_dir: Ignored - kept for backward compatibility
    """
    return get_global_workflows_dir()


# DEPRECATED: workflow_list_available, workflow_activate, workflow_create_step removed
# Use graph_list_available, graph_activate instead

# DEPRECATED: advance_to_next_step, check_and_advance_gate, workflow_check_phrase removed
# Use graph_traverse, graph_check_tool, graph_check_phrase instead


@mcp.tool()
async def execute_mcp_tool(
    mcp_name: str,
    tool_name: str,
    arguments: dict[str, Any],
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
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


async def _do_refresh_tool_index(mcp_name: str | None = None) -> dict:
    """Core indexing logic. Called from lifespan (auto) and refresh_tool_index (manual)."""
    global _tool_index, _request_counter

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
async def refresh_tool_index(mcp_name: str | None = None) -> dict:
    """Actualiza el índice de tools para búsqueda semántica.

    Conecta a los MCPs y obtiene su lista de tools para indexar.
    Usar para reindexar después de agregar nuevos MCPs.
    El índice se carga automáticamente al iniciar el servidor.

    Args:
        mcp_name: MCP específico a reindexar (opcional, default: todos)
    """
    return await _do_refresh_tool_index(mcp_name)


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
# Graph Workflow Functions (v2.0 - Directed Graph Engine)
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


# ============================================================================
# DCC Context Analysis (Dynamic Workflow Injection)
# ============================================================================

async def _execute_dcc_tool(tool_name: str, args: dict, project_dir: str) -> dict | None:
    """Execute a DeltaCodeCube tool via the MCP connection pool.

    Reuses the same McpConnection infrastructure as execute_mcp_tool().

    Returns:
        Tool result dict, or None on failure.
    """
    global _request_counter

    conn = await get_mcp_connection("deltacodecube")
    if not conn:
        return None

    _request_counter += 1
    try:
        response = await conn.call_tool(tool_name, args, _request_counter)
        if "error" in response:
            return None
        return response.get("result", response)
    except Exception as e:
        print(f"[DCC Context] Error calling {tool_name}: {e}", file=sys.stderr)
        return None


def _summarize_stats(result: dict | None) -> str | None:
    """Summarize cube_get_stats result into a concise string."""
    if not result:
        return None
    try:
        # Handle content array from MCP response
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    import json as _json
                    content = _json.loads(item["text"])
                    break

        if isinstance(content, dict):
            total = content.get("total_files", content.get("totalFiles", "?"))
            grade = content.get("grade", "?")
            score = content.get("codebase_score", content.get("score", "?"))
            return f"Files: {total}, Grade: {grade}, Score: {score}/100"
    except Exception:
        pass
    return str(result)[:200]


def _summarize_smells(result: dict | None) -> str | None:
    """Summarize cube_detect_smells result (works with summary_only format)."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    import json as _json
                    content = _json.loads(item["text"])
                    break

        if isinstance(content, dict):
            total = content.get("total_smells", 0)
            if total == 0:
                return "No smells detected"

            # Use pre-aggregated by_severity / by_type (works with summary_only)
            by_severity = content.get("by_severity", {})
            by_type = content.get("by_type", {})

            sev_order = ["critical", "high", "medium", "low"]
            sev_parts = [f"{by_severity[s]} {s}" for s in sev_order if by_severity.get(s)]
            type_parts = [f"{t}: {c}" for t, c in sorted(by_type.items())]

            summary = f"{total} smells ({', '.join(sev_parts)})"
            if type_parts:
                summary += f" — {', '.join(type_parts)}"
            summary += ". Use cube_detect_smells(smell_type=...) for details"
            return summary
    except Exception:
        pass
    return str(result)[:200]


def _summarize_tensions(result: dict | None) -> str | None:
    """Summarize cube_get_tensions result."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    import json as _json
                    content = _json.loads(item["text"])
                    break

        if isinstance(content, dict):
            tensions = content.get("tensions", [])
            total = len(tensions)
            if total == 0:
                return "No tensions detected"
            types = {}
            for t in tensions:
                tt = t.get("type", "unknown")
                types[tt] = types.get(tt, 0) + 1
            parts = [f"{c} {t}" for t, c in sorted(types.items())]
            return f"{total} tensions ({', '.join(parts)})"
    except Exception:
        pass
    return str(result)[:200]


def _summarize_debt(result: dict | None) -> str | None:
    """Summarize cube_get_debt result."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    import json as _json
                    content = _json.loads(item["text"])
                    break

        if isinstance(content, dict):
            grade = content.get("grade", "?")
            score = content.get("codebase_score", content.get("score", "?"))
            hotspots = content.get("all_files", [])
            n_hotspots = len([f for f in hotspots if isinstance(f, dict) and f.get("score", 0) > 60])
            return f"Grade: {grade}, Score: {score}/100, Hotspots: {n_hotspots} files"
    except Exception:
        pass
    return str(result)[:200]


_DCC_SUMMARIZERS = {
    "stats": ("cube_get_stats", {}, _summarize_stats),
    "smells": ("cube_detect_smells", {"summary_only": True}, _summarize_smells),
    "tensions": ("cube_get_tensions", {"limit": 10}, _summarize_tensions),
    "debt": ("cube_get_debt", {}, _summarize_debt),
}


# ============================================================================
# Tension Gate State (Mejora 1: Tension Resolution Loop)
# ============================================================================

_SEVERITY_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
# Key: (project_dir, node_id) → {"attempts": int, "acknowledged": bool}
_tension_gate_state: dict[tuple[str, str], dict] = {}


# ============================================================================
# Experience Memory System (Mejora 3: Experiential Learning)
# ============================================================================

_experience_store: ExperienceMemoryStore | None = None


def _get_experience_store() -> ExperienceMemoryStore:
    """Lazy-load the global experience memory store."""
    global _experience_store
    if _experience_store is None:
        _experience_store = ExperienceMemoryStore()
        _experience_store.load("global")
    return _experience_store


def _get_project_experience_store(project_dir: str) -> ExperienceMemoryStore:
    """Load project-scoped experience store."""
    project_name = Path(project_dir).name
    store = ExperienceMemoryStore()
    store.load("project", project_name)
    return store


def _extract_mcp_content(result: dict | None) -> dict | list | None:
    """Unwrap MCP content array to get the parsed JSON payload."""
    if not result:
        return None
    try:
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    return json.loads(item["text"])
        return result
    except Exception:
        return result


def _collect_experiences_from_dcc(raw_results: dict, project_dir: str) -> None:
    """Extract experiences from DCC analysis raw results and record them.

    raw_results: {analysis_name: raw_mcp_response}
    """
    global_store = _get_experience_store()
    project_name = Path(project_dir).name
    project_store = _get_project_experience_store(project_dir)

    now = datetime.now().isoformat()
    recorded_any = False

    # Extract tensions
    if "tensions" in raw_results and raw_results["tensions"]:
        content = _extract_mcp_content(raw_results["tensions"])
        tensions = []
        if isinstance(content, dict):
            tensions = content.get("tensions", [])
        elif isinstance(content, list):
            tensions = content

        for t in tensions:
            source = t.get("source", t.get("file", ""))
            if not source:
                continue

            entry = ExperienceEntry(
                type="tension_caused",
                file_pattern=generalize_path(source),
                keywords=extract_file_keywords(source),
                domain=guess_domain(source),
                description=t.get("description", t.get("message", ""))[:300],
                severity=t.get("severity", "medium"),
                project_origin=project_name,
                related_files=[f for f in [t.get("target", t.get("related_file"))] if f],
                scope="project",
                first_seen=now,
            )
            project_store.record(entry)

            # Also record globally (with global scope)
            global_entry = ExperienceEntry(
                type="tension_caused",
                file_pattern=entry.file_pattern,
                keywords=entry.keywords,
                domain=entry.domain,
                description=entry.description,
                severity=entry.severity,
                project_origin=project_name,
                related_files=entry.related_files,
                scope="global",
                first_seen=now,
            )
            global_store.record(global_entry)
            recorded_any = True

    # Extract smells
    if "smells" in raw_results and raw_results["smells"]:
        content = _extract_mcp_content(raw_results["smells"])
        if isinstance(content, dict):
            smells = content.get("smells", [])
            for s in smells:
                source = s.get("file", s.get("source", ""))
                if not source:
                    continue

                entry = ExperienceEntry(
                    type="smell_introduced",
                    file_pattern=generalize_path(source),
                    keywords=extract_file_keywords(source),
                    domain=guess_domain(source),
                    description=f"{s.get('type', 'unknown')}: {s.get('description', '')}",
                    severity=s.get("severity", "medium"),
                    project_origin=project_name,
                    scope="project",
                    first_seen=now,
                )
                project_store.record(entry)

                global_entry = ExperienceEntry(
                    type="smell_introduced",
                    file_pattern=entry.file_pattern,
                    keywords=entry.keywords,
                    domain=entry.domain,
                    description=entry.description,
                    severity=entry.severity,
                    project_origin=project_name,
                    scope="global",
                    first_seen=now,
                )
                global_store.record(global_entry)
                recorded_any = True

    if recorded_any:
        try:
            project_store.save()
            global_store.save()
        except Exception as e:
            print(f"[workflow-manager] Experience save failed (non-fatal): {e}", file=sys.stderr)


def _collect_gate_blocked(project_dir: str, node_id: str,
                          blocking_tensions: list[dict], severity: str) -> None:
    """Record a gate-blocked experience."""
    project_name = Path(project_dir).name
    global_store = _get_experience_store()
    project_store = _get_project_experience_store(project_dir)

    # Build description from blocking tensions
    tension_descs = [t.get("description", t.get("type", "unknown"))[:100] for t in blocking_tensions[:3]]
    desc = f"Gate blocked at node '{node_id}': {'; '.join(tension_descs)}"

    files = [t.get("source", t.get("file", "")) for t in blocking_tensions if t.get("source") or t.get("file")]

    for store, scope in [(project_store, "project"), (global_store, "global")]:
        for f in files[:3]:
            if f:
                entry = ExperienceEntry(
                    type="gate_blocked",
                    file_pattern=generalize_path(f),
                    keywords=extract_file_keywords(f),
                    domain=guess_domain(f),
                    description=desc[:300],
                    severity=severity,
                    project_origin=project_name,
                    related_files=[rf for rf in files if rf != f][:5],
                    scope=scope,
                )
                store.record(entry)

    try:
        project_store.save()
        global_store.save()
    except Exception as e:
        print(f"[workflow-manager] Experience gate_blocked save failed: {e}", file=sys.stderr)


def _collect_gate_resolved(project_dir: str, node_id: str, attempts: int) -> None:
    """Record a gate-resolved experience (gate passed after previous blocks)."""
    project_name = Path(project_dir).name
    global_store = _get_experience_store()
    project_store = _get_project_experience_store(project_dir)

    desc = f"Gate resolved at node '{node_id}' after {attempts} attempt(s)"

    for store, scope in [(project_store, "project"), (global_store, "global")]:
        entry = ExperienceEntry(
            type="gate_resolved",
            file_pattern=f"workflow/{node_id}",
            keywords=[node_id.replace("_", " ").replace("-", " ").split()[0]],
            domain="config",
            description=desc,
            severity="low",
            project_origin=project_name,
            scope=scope,
        )
        store.record(entry)

    try:
        project_store.save()
        global_store.save()
    except Exception as e:
        print(f"[workflow-manager] Experience gate_resolved save failed: {e}", file=sys.stderr)


def _extract_tensions(result: dict | None) -> list[dict]:
    """Extract tension list from DCC cube_get_tensions MCP response."""
    if not result:
        return []
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break
        if isinstance(content, dict):
            return content.get("tensions", [])
        if isinstance(content, list):
            return content
    except Exception:
        pass
    return []


def _summarize_fix_suggestion(result: dict | None) -> str | None:
    """Parse cube_suggest_fix result into actionable text."""
    if not result:
        return None
    try:
        content = result
        if isinstance(result, dict) and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    content = json.loads(item["text"])
                    break
        if isinstance(content, dict):
            fix = content.get("suggestion", content.get("fix", ""))
            files = content.get("files", content.get("affected_files", []))
            if fix:
                summary = str(fix)[:300]
                if files:
                    summary += f" (files: {', '.join(str(f) for f in files[:3])})"
                return summary
        return str(content)[:300]
    except Exception:
        return str(result)[:200]


async def _check_tension_gate(node: "Node | None", project_dir: str) -> dict | None:
    """Check tension gate for a node before allowing transition out.

    Returns None if no gate or gate allows passage.
    Returns dict with blocking details if tensions prevent traversal.
    """
    if not node or not node.dcc_context:
        return None

    gate_config = node.dcc_context.get("tension_gate")
    if not gate_config or not gate_config.get("enabled", False):
        return None

    gate_key = (project_dir, node.id)
    gate_state = _tension_gate_state.setdefault(gate_key, {"attempts": 0, "acknowledged": False})

    # Escape hatches
    if gate_state["acknowledged"]:
        return None
    max_retries = gate_config.get("max_retries", 5)
    if gate_state["attempts"] >= max_retries:
        return {"blocked": False, "auto_escaped": True, "attempts": gate_state["attempts"]}

    # Run DCC analysis
    min_severity = gate_config.get("min_severity", "medium")
    min_sev_level = _SEVERITY_ORDER.get(min_severity, 1)

    await _run_dcc_reindex(project_dir)
    raw_tensions = await _execute_dcc_tool("cube_get_tensions", {"status": "detected"}, project_dir)
    tensions = _extract_tensions(raw_tensions)

    # Filter by severity
    blocking = [
        t for t in tensions
        if _SEVERITY_ORDER.get(t.get("severity", "low"), 0) >= min_sev_level
    ]

    if not blocking:
        # Gate passed — record resolution if there were previous attempts
        if gate_state["attempts"] > 0:
            try:
                _collect_gate_resolved(project_dir, node.id, gate_state["attempts"])
            except Exception:
                pass
        return None

    gate_state["attempts"] += 1

    # Experience memory: record gate blocked
    try:
        _collect_gate_blocked(project_dir, node.id, blocking, min_severity)
    except Exception:
        pass  # Non-fatal

    result = {
        "blocked": True,
        "attempts": gate_state["attempts"],
        "max_retries": max_retries,
        "remaining_retries": max_retries - gate_state["attempts"],
        "blocking_tensions": len(blocking),
        "min_severity": min_severity,
        "tensions": [
            {
                "type": t.get("type", "unknown"),
                "severity": t.get("severity", "unknown"),
                "source": t.get("source", t.get("file", "?")),
                "target": t.get("target", t.get("related_file", "?")),
                "description": t.get("description", t.get("message", ""))[:200],
            }
            for t in blocking[:5]
        ],
    }

    # Optionally get fix suggestions
    if gate_config.get("suggest_fixes", False):
        max_suggestions = gate_config.get("max_fix_suggestions", 3)
        suggestions = []
        for t in blocking[:max_suggestions]:
            source = t.get("source", t.get("file"))
            if source:
                fix_result = await _execute_dcc_tool("cube_suggest_fix", {"file": source}, project_dir)
                suggestion = _summarize_fix_suggestion(fix_result)
                if suggestion:
                    suggestions.append({"file": source, "suggestion": suggestion})
        if suggestions:
            result["fix_suggestions"] = suggestions

    return result


def _clear_tension_gate_state(project_dir: str, node_id: str | None = None) -> None:
    """Clear tension gate state for a project (optionally for a specific node)."""
    if node_id:
        _tension_gate_state.pop((project_dir, node_id), None)
    else:
        keys_to_remove = [k for k in _tension_gate_state if k[0] == project_dir]
        for k in keys_to_remove:
            del _tension_gate_state[k]


def _get_tension_gate_info(node: "Node | None", project_dir: str, node_id: str | None) -> dict | None:
    """Get tension gate status info for graph_status()."""
    if not node or not node.dcc_context:
        return None
    gate_config = node.dcc_context.get("tension_gate")
    if not gate_config or not gate_config.get("enabled", False):
        return None
    gate_key = (project_dir, node_id) if node_id else None
    gate_state = _tension_gate_state.get(gate_key, {"attempts": 0, "acknowledged": False}) if gate_key else None
    return {
        "enabled": True,
        "min_severity": gate_config.get("min_severity", "medium"),
        "max_retries": gate_config.get("max_retries", 5),
        "attempts": gate_state["attempts"] if gate_state else 0,
        "acknowledged": gate_state["acknowledged"] if gate_state else False,
        "suggest_fixes": gate_config.get("suggest_fixes", False),
    }


def _is_dcc_available() -> bool:
    """Check if deltacodecube MCP is configured (without starting it)."""
    configs = load_mcp_configs()
    return "deltacodecube" in configs


_DCC_DEFAULT_ANALYSES = ["stats", "smells"]
_DCC_DEFAULT_TOKEN_BUDGET = 400


def _resolve_dcc_config(node: "Node | None", enforcer_config: dict) -> tuple[bool, list[str], int]:
    """Resolve DCC injection config for a node.

    Returns: (should_run, analyses, token_budget)

    Priority:
    1. DCC MCP not available → skip
    2. enforcer_config["dcc_injection_enabled"] == False → skip
    3. node.dcc_context.enabled == False → skip (per-node opt-out)
    4. node.dcc_context exists with analyses → use those
    5. No per-node config → use defaults
    """
    if not _is_dcc_available():
        return False, [], 0

    if not enforcer_config.get("dcc_injection_enabled", True):
        return False, [], 0

    if node and node.dcc_context:
        if not node.dcc_context.get("enabled", True):
            return False, [], 0
        analyses = node.dcc_context.get("analyses", _DCC_DEFAULT_ANALYSES)
        budget = node.dcc_context.get("token_budget", _DCC_DEFAULT_TOKEN_BUDGET)
        return True, analyses, budget

    return True, _DCC_DEFAULT_ANALYSES, _DCC_DEFAULT_TOKEN_BUDGET


async def _run_dcc_reindex(project_dir: str) -> dict | None:
    """Reindex the project directory in DeltaCodeCube before analysis.

    Calls cube_index_directory to ensure DCC has fresh data for any files
    that were created, modified, or deleted since the last indexing.

    Returns:
        Reindex result dict, or None on failure.
    """
    try:
        result = await _execute_dcc_tool("cube_index_directory", {
            "path": project_dir,
            "patterns": ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.rs", "**/*.go", "**/*.css"],
        }, project_dir)
        if result:
            print(f"[workflow-manager] DCC reindex: {project_dir}", file=sys.stderr)
        return result
    except Exception as e:
        print(f"[workflow-manager] DCC reindex failed (non-fatal): {e}", file=sys.stderr)
        return None


async def _run_dcc_analysis(analyses: list[str], token_budget: int,
                           project_dir: str) -> tuple[dict | None, dict]:
    """Execute DCC analyses and return (summaries, raw_results).

    Automatically reindexes the project before running analyses to ensure
    results reflect the current state of the codebase.

    Args:
        analyses: List of analysis names to run (e.g. ["stats", "smells"]).
        token_budget: Approximate token budget for the combined output.
        project_dir: Project directory for DCC tool calls.

    Returns:
        Tuple of (summaries_dict, raw_results_dict).
        summaries_dict: analysis_name → summary string, or None.
        raw_results_dict: analysis_name → raw MCP response (for experience collection).
    """
    if not analyses:
        return None, {}

    # Reindex project so analyses reflect current codebase state
    await _run_dcc_reindex(project_dir)

    results = {}
    raw_results = {}
    total_chars = 0

    for analysis_name in analyses:
        if analysis_name not in _DCC_SUMMARIZERS:
            results[analysis_name] = f"Unknown analysis: {analysis_name}"
            continue

        tool_name, default_args, summarizer = _DCC_SUMMARIZERS[analysis_name]
        raw = await _execute_dcc_tool(tool_name, default_args, project_dir)
        raw_results[analysis_name] = raw
        summary = summarizer(raw)
        if summary:
            # Rough token budget check (1 token ≈ 4 chars)
            if total_chars + len(summary) > token_budget * 4:
                results[analysis_name] = summary[:max(50, token_budget * 4 - total_chars)] + "..."
                break
            results[analysis_name] = summary
            total_chars += len(summary)

    return (results if results else None), raw_results


# ============================================================================
# Impact Preview (Mejora 2: Impact Simulation Pre-Refactor)
# ============================================================================

async def _run_impact_preview(node: "Node | None", project_dir: str) -> dict | None:
    """Run impact simulation preview when entering a node with impact_preview configured.

    Uses cube_simulate_wave on recently changed files to predict which areas
    of the codebase are at risk from upcoming changes.

    Returns:
        Dict with impact analysis or None if not configured/available.
    """
    if not node or not node.dcc_context:
        return None

    preview_config = node.dcc_context.get("impact_preview")
    if not preview_config or not preview_config.get("enabled", False):
        return None

    if not _is_dcc_available():
        return None

    max_hops = preview_config.get("max_hops", 3)
    risk_threshold = preview_config.get("risk_threshold", "medium")
    risk_level = _SEVERITY_ORDER.get(risk_threshold, 1)

    try:
        # Get recently changed files from git
        import subprocess
        git_result = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~3"],
            cwd=project_dir, capture_output=True, text=True, timeout=10
        )
        changed_files = [f.strip() for f in git_result.stdout.strip().split("\n") if f.strip()]

        if not changed_files:
            # Fallback: get files from DCC tensions
            raw_tensions = await _execute_dcc_tool("cube_get_tensions", {"limit": 5}, project_dir)
            tensions = _extract_tensions(raw_tensions)
            changed_files = list({t.get("source", t.get("file", "")) for t in tensions if t.get("source") or t.get("file")})

        if not changed_files:
            return None

        # Run wave simulation on top changed files (max 5)
        wave_results = []
        for file_path in changed_files[:5]:
            wave = await _execute_dcc_tool("cube_simulate_wave", {
                "file": file_path,
                "max_hops": max_hops,
            }, project_dir)
            if wave:
                wave_results.append({"source_file": file_path, "wave": wave})

        if not wave_results:
            return None

        # Aggregate impact
        files_at_risk = set()
        risk_details = []
        for wr in wave_results:
            wave_data = wr["wave"]
            content = wave_data
            if isinstance(wave_data, dict) and "content" in wave_data:
                for item in wave_data["content"]:
                    if item.get("type") == "text":
                        try:
                            content = json.loads(item["text"])
                        except Exception:
                            content = wave_data
                        break

            affected = []
            if isinstance(content, dict):
                affected = content.get("affected_files", content.get("wave", content.get("ripple", [])))
            elif isinstance(content, list):
                affected = content

            for af in affected:
                if isinstance(af, dict):
                    sev = _SEVERITY_ORDER.get(af.get("risk", af.get("severity", "low")), 0)
                    if sev >= risk_level:
                        fname = af.get("file", af.get("path", "?"))
                        files_at_risk.add(fname)
                        risk_details.append({
                            "file": fname,
                            "risk": af.get("risk", af.get("severity", "unknown")),
                            "reason": af.get("reason", af.get("description", ""))[:150],
                            "from": wr["source_file"],
                        })
                elif isinstance(af, str):
                    files_at_risk.add(af)

        if not files_at_risk and not risk_details:
            return {"risk_level": "low", "message": "No significant impact detected"}

        return {
            "files_at_risk": len(files_at_risk),
            "risk_threshold": risk_threshold,
            "changed_files_analyzed": len(wave_results),
            "details": risk_details[:10],
            "review_order": list(files_at_risk)[:10],
        }

    except Exception as e:
        return {"error": f"Impact preview failed: {e}"}


@mcp.tool()
def graph_status(project_dir: str | None = None, session_id: str | None = None) -> dict:
    """Get current graph workflow status: current node, available edges, visits.

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
        "dcc_injection": {
            "available": _is_dcc_available(),
            "enabled": enforcer_config.get("dcc_injection_enabled", True),
            "node_override": current_node.dcc_context if current_node and current_node.dcc_context else None,
        },
        "tension_gate": _get_tension_gate_info(current_node, resolved_dir, current_node_id),
        "last_activity": state.last_activity,
        "project_dir": resolved_dir
    }


@mcp.tool()
async def graph_traverse(
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

    # Tension gate: check if current node blocks exit due to unresolved tensions
    current_node = graph.nodes.get(current_node_id)
    gate_result = await _check_tension_gate(current_node, resolved_dir)
    if gate_result and gate_result.get("blocked"):
        return {
            "error": True,
            "tension_gate_blocked": True,
            "session_id": sid,
            "message": (
                f"Tension gate blocked: {gate_result['blocking_tensions']} unresolved tension(s) "
                f"with severity >= {gate_result['min_severity']}. "
                f"Fix the issues and retry, or use graph_acknowledge_tensions() to force advance. "
                f"Attempt {gate_result['attempts']}/{gate_result['max_retries']} "
                f"(auto-passes after {gate_result['max_retries']})."
            ),
            "gate_details": gate_result,
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

    # Run DCC analysis (global injection — auto-detects availability)
    enforcer_config = load_enforcer_config(resolved_dir)
    should_run, analyses, token_budget = _resolve_dcc_config(new_node, enforcer_config)

    dcc_result = None
    dcc_raw = {}
    if should_run:
        try:
            dcc_result, dcc_raw = await _run_dcc_analysis(analyses, token_budget, resolved_dir)
        except Exception as e:
            dcc_result = {"error": str(e)}

    # Experience memory: auto-collect from DCC results
    if dcc_raw:
        try:
            _collect_experiences_from_dcc(dcc_raw, resolved_dir)
        except Exception:
            pass  # Non-fatal

    # Impact preview: simulate wave for nodes with impact_preview configured
    impact_result = None
    try:
        impact_result = await _run_impact_preview(new_node, resolved_dir)
    except Exception as e:
        impact_result = {"error": str(e)}

    result = {
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
        "dcc_analysis": dcc_result,
        "reason": reason,
        "project_dir": resolved_dir
    }

    if impact_result:
        result["impact_preview"] = impact_result

    return result


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
    _clear_tension_gate_state(resolved_dir)
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
    _clear_tension_gate_state(resolved_dir, node_id)

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
async def graph_acknowledge_tensions(
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Acknowledge unresolved tensions and force-advance past the tension gate.

    Use this as an escape hatch when the agent has reviewed the tensions but
    decides to proceed anyway. The next graph_traverse() from this node will
    skip the tension gate check.

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

    current_node_id = state.get_current_node()
    current_node = graph.nodes.get(current_node_id) if current_node_id else None

    if not current_node or not current_node.dcc_context:
        return {
            "error": True,
            "session_id": sid,
            "message": f"Node '{current_node_id}' has no tension gate configured",
            "project_dir": resolved_dir
        }

    gate_config = current_node.dcc_context.get("tension_gate", {})
    if not gate_config.get("enabled", False):
        return {
            "error": True,
            "session_id": sid,
            "message": f"Node '{current_node_id}' has no tension gate enabled",
            "project_dir": resolved_dir
        }

    gate_key = (resolved_dir, current_node_id)
    gate_state = _tension_gate_state.setdefault(gate_key, {"attempts": 0, "acknowledged": False})
    gate_state["acknowledged"] = True

    # Mark tensions as reviewed in DCC
    try:
        await _execute_dcc_tool("cube_get_tensions", {"status": "reviewed"}, resolved_dir)
    except Exception:
        pass

    return {
        "success": True,
        "session_id": sid,
        "message": f"Tensions acknowledged for node '{current_node_id}'. Next traverse will pass the gate.",
        "node_id": current_node_id,
        "attempts_before_ack": gate_state["attempts"],
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
async def graph_timeline(
    since: str | None = None,
    limit: int = 50,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Get a unified timeline of workflow transitions, DCC tensions, and git commits.

    Correlates three data sources into a single chronological view:
    - Workflow transitions (from execution_path in graph state)
    - DCC tensions and smells (from DeltaCodeCube)
    - Git commits (from git log)

    Args:
        since: ISO timestamp to filter events from (default: workflow start)
        limit: Maximum number of events to return (default: 50)
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

    events = []

    # 1. Workflow transitions from execution_path
    for entry in state.execution_path:
        ts = entry.timestamp if hasattr(entry, 'timestamp') else entry.get("timestamp", "")
        from_node = entry.from_node if hasattr(entry, 'from_node') else entry.get("from_node")
        to_node = entry.to_node if hasattr(entry, 'to_node') else entry.get("to_node", "?")
        reason = entry.reason if hasattr(entry, 'reason') else entry.get("reason", "")
        edge_id = entry.edge_id if hasattr(entry, 'edge_id') else entry.get("edge_id")

        if since and ts < since:
            continue

        to_name = graph.nodes[to_node].name if to_node in graph.nodes else to_node
        events.append({
            "type": "transition",
            "timestamp": ts,
            "description": f"→ {to_name}" + (f" ({reason})" if reason else ""),
            "from_node": from_node,
            "to_node": to_node,
            "edge_id": edge_id,
        })

    # 2. Git commits
    since_flag = f"--since={since}" if since else "--since=7 days ago"
    try:
        import subprocess
        git_result = subprocess.run(
            ["git", "log", since_flag, "--format=%H|%aI|%s", f"--max-count={limit}"],
            cwd=resolved_dir, capture_output=True, text=True, timeout=10
        )
        for line in git_result.stdout.strip().split("\n"):
            if not line or "|" not in line:
                continue
            parts = line.split("|", 2)
            if len(parts) < 3:
                continue
            commit_hash, ts, message = parts

            # Get changed files for this commit
            diff_result = subprocess.run(
                ["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit_hash],
                cwd=resolved_dir, capture_output=True, text=True, timeout=10
            )
            files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]

            events.append({
                "type": "commit",
                "timestamp": ts,
                "description": message,
                "commit": commit_hash[:8],
                "files": files[:10],
            })
    except Exception:
        pass

    # 3. DCC tensions (if available)
    if _is_dcc_available():
        try:
            raw_tensions = await _execute_dcc_tool("cube_get_tensions", {"limit": limit}, resolved_dir)
            tensions = _extract_tensions(raw_tensions)
            for t in tensions:
                ts = t.get("detected_at", t.get("timestamp", t.get("created_at", "")))
                if since and ts and ts < since:
                    continue
                events.append({
                    "type": "tension",
                    "timestamp": ts or "",
                    "severity": t.get("severity", "unknown"),
                    "description": t.get("description", t.get("message", t.get("type", "tension")))[:200],
                    "source": t.get("source", t.get("file", "?")),
                    "target": t.get("target", t.get("related_file")),
                    "status": t.get("status", "detected"),
                })

            # Also get smells
            raw_smells = await _execute_dcc_tool("cube_detect_smells", {"summary_only": False, "limit": 20}, resolved_dir)
            if raw_smells:
                smell_content = raw_smells
                if isinstance(raw_smells, dict) and "content" in raw_smells:
                    for item in raw_smells["content"]:
                        if item.get("type") == "text":
                            try:
                                smell_content = json.loads(item["text"])
                            except Exception:
                                smell_content = raw_smells
                            break

                smells_list = []
                if isinstance(smell_content, dict):
                    smells_list = smell_content.get("smells", [])
                elif isinstance(smell_content, list):
                    smells_list = smell_content

                for s in smells_list[:20]:
                    ts = s.get("detected_at", s.get("timestamp", ""))
                    if since and ts and ts < since:
                        continue
                    events.append({
                        "type": "smell",
                        "timestamp": ts or "",
                        "severity": s.get("severity", "unknown"),
                        "description": s.get("description", s.get("smell_type", s.get("type", "smell")))[:200],
                        "file": s.get("file", s.get("source", "?")),
                    })
        except Exception:
            pass

    # Sort by timestamp (events without timestamps go last)
    events.sort(key=lambda e: e.get("timestamp") or "9999", reverse=False)

    return {
        "success": True,
        "session_id": sid,
        "total_events": len(events),
        "events": events[:limit],
        "event_counts": {
            "transitions": sum(1 for e in events if e["type"] == "transition"),
            "commits": sum(1 for e in events if e["type"] == "commit"),
            "tensions": sum(1 for e in events if e["type"] == "tension"),
            "smells": sum(1 for e in events if e["type"] == "smell"),
        },
        "project_dir": resolved_dir,
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
    """List all available graphs in the project's workflows library.

    Args:
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)
    workflows_dir = get_workflows_library_dir(resolved_dir)

    if not workflows_dir.exists():
        return {
            "success": False,
            "session_id": sid,
            "message": f"Workflows directory not found: {workflows_dir}",
            "graphs": [],
            "project_dir": resolved_dir
        }

    graphs = []

    # Look for graph.yaml files (v2 format)
    for yaml_file in workflows_dir.glob("*-graph.yaml"):
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
    """Activate a graph from the workflows library.

    Copies the graph YAML to graph.yaml and initializes state.

    Args:
        graph_name: Name of the graph file (without -graph.yaml extension)
        project_dir: Absolute path to the project directory (optional after set_session)
        session_id: Optional session ID for parallel session isolation
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)
    workflows_dir = get_workflows_library_dir(resolved_dir)

    # Try both naming conventions
    graph_file = workflows_dir / f"{graph_name}-graph.yaml"
    if not graph_file.exists():
        graph_file = workflows_dir / f"{graph_name}.yaml"

    if not graph_file.exists():
        available = [f.stem for f in workflows_dir.glob("*-graph.yaml")] if workflows_dir.exists() else []
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


# ============================================================================
# Graph Builder Tools - Create graphs programmatically
# ============================================================================

# In-memory graph builder storage
# Key: builder_id, Value: {"metadata": {...}, "nodes": [...], "edges": [...]}
_graph_builders: dict[str, dict] = {}


def _get_or_create_builder(builder_id: str) -> dict:
    """Get or create a graph builder by ID."""
    if builder_id not in _graph_builders:
        _graph_builders[builder_id] = {
            "metadata": {
                "name": "Untitled Graph",
                "description": "",
                "version": "1.0.0",
                "type": "graph"
            },
            "nodes": [],
            "edges": []
        }
    return _graph_builders[builder_id]


def _generate_graph_yaml(builder: dict) -> str:
    """Generate YAML content from builder data."""
    lines = []

    # Metadata
    lines.append("metadata:")
    lines.append(f'  name: "{builder["metadata"].get("name", "Untitled")}"')
    lines.append(f'  description: "{builder["metadata"].get("description", "")}"')
    lines.append(f'  version: "{builder["metadata"].get("version", "1.0.0")}"')
    lines.append(f'  type: "graph"')
    lines.append("")

    # Nodes
    lines.append("nodes:")
    for node in builder["nodes"]:
        lines.append(f'  - id: "{node["id"]}"')
        lines.append(f'    name: "{node.get("name", node["id"])}"')

        if node.get("is_start"):
            lines.append("    is_start: true")
        if node.get("is_end"):
            lines.append("    is_end: true")

        # MCPs enabled
        mcps = node.get("mcps_enabled", ["*"])
        if mcps:
            lines.append("    mcps_enabled:")
            for mcp in mcps:
                lines.append(f'      - "{mcp}"')

        # Tools blocked
        blocked = node.get("tools_blocked", [])
        if blocked:
            lines.append("    tools_blocked:")
            for tool in blocked:
                lines.append(f'      - "{tool}"')

        # Max visits
        if node.get("max_visits"):
            lines.append(f'    max_visits: {node["max_visits"]}')

        # Prompt injection
        if node.get("prompt_injection"):
            lines.append("    prompt_injection: |")
            for pi_line in node["prompt_injection"].split("\n"):
                lines.append(f"      {pi_line}")

        lines.append("")

    # Edges
    lines.append("edges:")
    for edge in builder["edges"]:
        lines.append(f'  - id: "{edge["id"]}"')
        lines.append(f'    from: "{edge["from"]}"')
        lines.append(f'    to: "{edge["to"]}"')
        lines.append("    condition:")
        lines.append(f'      type: "{edge.get("condition_type", "always")}"')

        if edge.get("condition_tool"):
            lines.append(f'      tool: "{edge["condition_tool"]}"')

        if edge.get("condition_phrases"):
            lines.append("      phrases:")
            for phrase in edge["condition_phrases"]:
                lines.append(f'        - "{phrase}"')

        if edge.get("priority", 1) != 1:
            lines.append(f'    priority: {edge["priority"]}')

        lines.append("")

    return "\n".join(lines)


@mcp.tool()
def graph_builder_create(
    name: str,
    description: str = "",
    version: str = "1.0.0",
    builder_id: str | None = None
) -> dict:
    """Create a new graph builder session.

    Use this to start building a new graph programmatically.
    Returns a builder_id to use in subsequent calls.

    Args:
        name: Name of the graph (e.g., "CFA Remember Workflow")
        description: Description of what the graph does
        version: Version string (default "1.0.0")
        builder_id: Optional custom ID (auto-generated if not provided)

    Example:
        graph_builder_create(name="My Workflow", description="Does X and Y")
        graph_builder_add_node(node_id="start", name="Start", is_start=True)
        graph_builder_add_edge(edge_id="start-to-end", from_node="start", to_node="end")
        graph_builder_save(filename="my-workflow")
    """
    bid = builder_id or str(uuid.uuid4())[:8]

    _graph_builders[bid] = {
        "metadata": {
            "name": name,
            "description": description,
            "version": version,
            "type": "graph"
        },
        "nodes": [],
        "edges": []
    }

    return {
        "success": True,
        "builder_id": bid,
        "message": f"Graph builder created: {name}",
        "hint": "Use graph_builder_add_node() and graph_builder_add_edge() to build the graph"
    }


@mcp.tool()
def graph_builder_add_node(
    builder_id: str,
    node_id: str,
    name: str,
    is_start: bool = False,
    is_end: bool = False,
    mcps_enabled: list[str] | None = None,
    tools_blocked: list[str] | None = None,
    max_visits: int = 10,
    prompt_injection: str | None = None
) -> dict:
    """Add a node to a graph builder.

    Args:
        builder_id: ID from graph_builder_create()
        node_id: Unique identifier for this node (e.g., "start", "analysis", "complete")
        name: Human-readable name (e.g., "Sequential Thinking")
        is_start: True if this is the starting node
        is_end: True if this is an ending node
        mcps_enabled: List of MCP names allowed (default ["*"] = all)
        tools_blocked: List of tools to block (e.g., ["Write", "Edit", "Bash"])
        max_visits: Maximum visits before blocking (default 10)
        prompt_injection: Prompt text injected when entering this node

    Example:
        graph_builder_add_node(
            builder_id="abc123",
            node_id="thinking",
            name="Sequential Thinking",
            is_start=True,
            mcps_enabled=["sequential-thinking"],
            tools_blocked=["Write", "Edit"],
            prompt_injection="Use sequential thinking to analyze the task..."
        )
    """
    if builder_id not in _graph_builders:
        return {
            "success": False,
            "message": f"Builder '{builder_id}' not found. Use graph_builder_create() first."
        }

    builder = _graph_builders[builder_id]

    # Check for duplicate node_id
    for existing in builder["nodes"]:
        if existing["id"] == node_id:
            return {
                "success": False,
                "message": f"Node '{node_id}' already exists in this builder"
            }

    node = {
        "id": node_id,
        "name": name,
        "is_start": is_start,
        "is_end": is_end,
        "mcps_enabled": mcps_enabled or ["*"],
        "tools_blocked": tools_blocked or [],
        "max_visits": max_visits
    }

    if prompt_injection:
        node["prompt_injection"] = prompt_injection

    builder["nodes"].append(node)

    return {
        "success": True,
        "builder_id": builder_id,
        "node_id": node_id,
        "node_count": len(builder["nodes"]),
        "message": f"Node '{name}' added"
    }


@mcp.tool()
def graph_builder_add_edge(
    builder_id: str,
    edge_id: str,
    from_node: str,
    to_node: str,
    condition_type: str = "always",
    condition_tool: str | None = None,
    condition_phrases: list[str] | None = None,
    priority: int = 1
) -> dict:
    """Add an edge (transition) to a graph builder.

    Args:
        builder_id: ID from graph_builder_create()
        edge_id: Unique identifier for this edge (e.g., "start-to-analysis")
        from_node: Source node ID
        to_node: Destination node ID
        condition_type: "always", "tool", or "phrase"
        condition_tool: For type="tool", the tool that triggers (e.g., "mcp__cfa4__cfa.remember")
        condition_phrases: For type="phrase", list of phrases that trigger (e.g., ["done", "complete"])
        priority: Higher priority edges are evaluated first (default 1)

    Examples:
        # Tool-triggered transition
        graph_builder_add_edge(
            builder_id="abc123",
            edge_id="capture-to-complete",
            from_node="capture",
            to_node="complete",
            condition_type="tool",
            condition_tool="mcp__cfa4__cfa.remember"
        )

        # Phrase-triggered transition
        graph_builder_add_edge(
            builder_id="abc123",
            edge_id="analysis-to-dev",
            from_node="analysis",
            to_node="development",
            condition_type="phrase",
            condition_phrases=["ready to implement", "proceed with development"]
        )
    """
    if builder_id not in _graph_builders:
        return {
            "success": False,
            "message": f"Builder '{builder_id}' not found. Use graph_builder_create() first."
        }

    builder = _graph_builders[builder_id]

    # Validate nodes exist
    node_ids = {n["id"] for n in builder["nodes"]}
    if from_node not in node_ids:
        return {
            "success": False,
            "message": f"from_node '{from_node}' not found. Add it with graph_builder_add_node() first.",
            "available_nodes": list(node_ids)
        }
    if to_node not in node_ids:
        return {
            "success": False,
            "message": f"to_node '{to_node}' not found. Add it with graph_builder_add_node() first.",
            "available_nodes": list(node_ids)
        }

    # Check for duplicate edge_id
    for existing in builder["edges"]:
        if existing["id"] == edge_id:
            return {
                "success": False,
                "message": f"Edge '{edge_id}' already exists in this builder"
            }

    edge = {
        "id": edge_id,
        "from": from_node,
        "to": to_node,
        "condition_type": condition_type,
        "priority": priority
    }

    if condition_type == "tool" and condition_tool:
        edge["condition_tool"] = condition_tool
    elif condition_type == "phrase" and condition_phrases:
        edge["condition_phrases"] = condition_phrases

    builder["edges"].append(edge)

    return {
        "success": True,
        "builder_id": builder_id,
        "edge_id": edge_id,
        "edge_count": len(builder["edges"]),
        "message": f"Edge '{from_node}' → '{to_node}' added"
    }


@mcp.tool()
def graph_builder_preview(builder_id: str) -> dict:
    """Preview the YAML that will be generated.

    Args:
        builder_id: ID from graph_builder_create()

    Returns:
        The YAML content that would be saved
    """
    if builder_id not in _graph_builders:
        return {
            "success": False,
            "message": f"Builder '{builder_id}' not found"
        }

    builder = _graph_builders[builder_id]
    yaml_content = _generate_graph_yaml(builder)

    return {
        "success": True,
        "builder_id": builder_id,
        "yaml": yaml_content,
        "stats": {
            "nodes": len(builder["nodes"]),
            "edges": len(builder["edges"])
        }
    }


@mcp.tool()
def graph_builder_save(
    builder_id: str,
    filename: str,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Save the graph to the workflows library.

    Args:
        builder_id: ID from graph_builder_create()
        filename: Name for the file (without extension, e.g., "cfa-remember")
        project_dir: Project directory (optional after set_session)
        session_id: Session ID for parallel isolation

    The file will be saved as {filename}-graph.yaml in the workflows directory.
    """
    if builder_id not in _graph_builders:
        return {
            "success": False,
            "message": f"Builder '{builder_id}' not found"
        }

    builder = _graph_builders[builder_id]

    # Validate before saving
    if not builder["nodes"]:
        return {
            "success": False,
            "message": "Cannot save: no nodes defined. Use graph_builder_add_node() first."
        }

    has_start = any(n.get("is_start") for n in builder["nodes"])
    if not has_start:
        return {
            "success": False,
            "message": "Cannot save: no start node defined. Set is_start=True on one node."
        }

    # Generate YAML
    yaml_content = _generate_graph_yaml(builder)

    # Validate the generated YAML can be parsed
    try:
        test_graph = parse_graph_yaml(yaml_content)
        errors = test_graph.validate()
        if errors:
            return {
                "success": False,
                "message": "Generated graph has validation errors",
                "errors": errors
            }
    except GraphParseError as e:
        return {
            "success": False,
            "message": f"Generated YAML is invalid: {e}"
        }

    # Get workflows directory
    workflows_dir = get_global_workflows_dir()
    workflows_dir.mkdir(parents=True, exist_ok=True)

    # Save file
    safe_filename = filename.replace(" ", "-").lower()
    if not safe_filename.endswith("-graph"):
        safe_filename = f"{safe_filename}-graph"

    output_path = workflows_dir / f"{safe_filename}.yaml"
    output_path.write_text(yaml_content)

    # Clean up builder
    del _graph_builders[builder_id]

    return {
        "success": True,
        "message": f"Graph saved successfully",
        "file": str(output_path),
        "graph_name": builder["metadata"]["name"],
        "stats": {
            "nodes": len(builder["nodes"]),
            "edges": len(builder["edges"])
        },
        "hint": f"Use graph_activate('{safe_filename}') to activate this graph"
    }


@mcp.tool()
def graph_builder_list() -> dict:
    """List all active graph builders.

    Returns the current in-memory builders and their status.
    """
    builders = []
    for bid, builder in _graph_builders.items():
        builders.append({
            "builder_id": bid,
            "name": builder["metadata"].get("name", "Untitled"),
            "nodes": len(builder["nodes"]),
            "edges": len(builder["edges"]),
            "has_start": any(n.get("is_start") for n in builder["nodes"]),
            "has_end": any(n.get("is_end") for n in builder["nodes"])
        })

    return {
        "builders": builders,
        "count": len(builders),
        "hint": "Use graph_builder_preview(builder_id) to see YAML or graph_builder_save() to save"
    }


@mcp.tool()
def graph_builder_delete(builder_id: str) -> dict:
    """Delete a graph builder without saving.

    Args:
        builder_id: ID of the builder to delete
    """
    if builder_id not in _graph_builders:
        return {
            "success": False,
            "message": f"Builder '{builder_id}' not found"
        }

    name = _graph_builders[builder_id]["metadata"].get("name", "Untitled")
    del _graph_builders[builder_id]

    return {
        "success": True,
        "message": f"Builder '{name}' deleted"
    }


# ============================================================================
# Experience Memory MCP Tools
# ============================================================================

@mcp.tool()
def experience_query(
    file_path: str,
    top_n: int = 5,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Query experience memory for relevant memories about a file.

    Returns past experiences (tensions, smells, gate blocks) that are
    relevant to the given file path, ranked by relevance score.

    Args:
        file_path: Path to the file to query about (relative or absolute)
        top_n: Maximum number of results to return (default 5)
        project_dir: Project directory (optional after set_session)
        session_id: Optional session ID
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)
    project_name = Path(resolved_dir).name

    global_store = _get_experience_store()
    project_store = _get_project_experience_store(resolved_dir)

    # Merge both stores for unified query
    merged = merge_stores(global_store, project_store)

    # Score and rank
    scored = []
    for entry in merged:
        score = compute_relevance(entry, file_path)
        if score > 0.05:
            scored.append((entry, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:top_n]

    return {
        "file_path": file_path,
        "matches": len(top),
        "total_memories": len(merged),
        "results": [
            {
                "score": round(score, 3),
                "type": entry.type,
                "file_pattern": entry.file_pattern,
                "domain": entry.domain,
                "description": entry.description,
                "severity": entry.severity,
                "confidence": round(entry.confidence, 3),
                "occurrences": entry.occurrences,
                "resolution": entry.resolution or None,
                "scope": entry.scope,
                "last_seen": entry.last_seen,
            }
            for entry, score in top
        ],
        "session_id": sid,
        "project_dir": resolved_dir,
    }


@mcp.tool()
def experience_record(
    type: str,
    file_path: str,
    description: str,
    severity: str = "medium",
    resolution: str = "",
    scope: str = "project",
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Manually record an experience memory.

    Use this to capture insights about code patterns, issues found,
    or resolutions that should be remembered for future reference.

    Args:
        type: Experience type (tension_caused|tension_resolved|smell_introduced|
              smell_fixed|gate_blocked|gate_resolved|impact_high)
        file_path: File path this experience relates to
        description: Human-readable description of the experience
        severity: low|medium|high|critical (default medium)
        resolution: How the issue was resolved (if applicable)
        scope: "global" (cross-project) or "project" (default project)
        project_dir: Project directory (optional after set_session)
        session_id: Optional session ID
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)
    project_name = Path(resolved_dir).name

    from .experience_memory import VALID_TYPES, VALID_SEVERITIES, VALID_SCOPES

    if type not in VALID_TYPES:
        return {
            "error": True,
            "message": f"Invalid type '{type}'. Valid: {', '.join(sorted(VALID_TYPES))}",
        }
    if severity not in VALID_SEVERITIES:
        return {
            "error": True,
            "message": f"Invalid severity '{severity}'. Valid: {', '.join(sorted(VALID_SEVERITIES))}",
        }
    if scope not in VALID_SCOPES:
        return {
            "error": True,
            "message": f"Invalid scope '{scope}'. Valid: {', '.join(sorted(VALID_SCOPES))}",
        }

    entry = ExperienceEntry(
        type=type,
        file_pattern=generalize_path(file_path),
        keywords=extract_file_keywords(file_path),
        domain=guess_domain(file_path),
        description=description,
        severity=severity,
        project_origin=project_name,
        resolution=resolution,
        scope=scope,
    )

    if scope == "project":
        store = _get_project_experience_store(resolved_dir)
    else:
        store = _get_experience_store()

    recorded = store.record(entry)
    store.save()

    return {
        "success": True,
        "id": recorded.id,
        "type": recorded.type,
        "file_pattern": recorded.file_pattern,
        "domain": recorded.domain,
        "confidence": round(recorded.confidence, 3),
        "occurrences": recorded.occurrences,
        "scope": recorded.scope,
        "is_new": recorded.occurrences == 1,
        "session_id": sid,
        "project_dir": resolved_dir,
    }


@mcp.tool()
def experience_list(
    type_filter: str | None = None,
    scope_filter: str | None = None,
    min_confidence: float = 0.0,
    limit: int = 20,
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """List experience memories with optional filters.

    Args:
        type_filter: Filter by type (e.g. "tension_caused", "smell_introduced")
        scope_filter: Filter by scope ("global" or "project")
        min_confidence: Minimum confidence threshold (0.0-1.0)
        limit: Maximum entries to return (default 20)
        project_dir: Project directory (optional after set_session)
        session_id: Optional session ID
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    global_store = _get_experience_store()
    project_store = _get_project_experience_store(resolved_dir)
    merged = merge_stores(global_store, project_store)

    # Apply filters
    filtered = merged
    if type_filter:
        filtered = [e for e in filtered if e.type == type_filter]
    if scope_filter:
        filtered = [e for e in filtered if e.scope == scope_filter]
    if min_confidence > 0.0:
        filtered = [e for e in filtered if e.confidence >= min_confidence]

    # Sort by confidence desc, then recency
    filtered.sort(key=lambda e: (e.confidence, e.last_seen or ""), reverse=True)
    entries = filtered[:limit]

    return {
        "total_matching": len(filtered),
        "showing": len(entries),
        "entries": [
            {
                "id": e.id,
                "type": e.type,
                "file_pattern": e.file_pattern,
                "domain": e.domain,
                "description": e.description[:200],
                "severity": e.severity,
                "confidence": round(e.confidence, 3),
                "occurrences": e.occurrences,
                "scope": e.scope,
                "resolution": e.resolution[:100] if e.resolution else None,
                "last_seen": e.last_seen,
            }
            for e in entries
        ],
        "session_id": sid,
        "project_dir": resolved_dir,
    }


@mcp.tool()
def experience_stats(
    project_dir: str | None = None,
    session_id: str | None = None
) -> dict:
    """Get statistics about experience memory.

    Shows counts by type, scope, severity, and confidence distribution.

    Args:
        project_dir: Project directory (optional after set_session)
        session_id: Optional session ID
    """
    resolved_dir, sid = resolve_project_dir(project_dir, session_id)

    global_store = _get_experience_store()
    project_store = _get_project_experience_store(resolved_dir)

    global_stats = global_store.stats()
    project_stats = project_store.stats()

    return {
        "global": global_stats,
        "project": project_stats,
        "combined_total": global_stats["total"] + project_stats["total"],
        "storage": {
            "global_file": str(GLOBAL_MEMORY_FILE),
            "project_file": str(PROJECT_MEMORIES_DIR / Path(resolved_dir).name / "experience_memory.json"),
        },
        "session_id": sid,
        "project_dir": resolved_dir,
    }


# ============================================================================
# Agent Deployment — Deploy specialized agents + skills to user projects
# ============================================================================

# Mapping: tech stack keywords → recommended skills
_TECH_SKILL_MAP: dict[str, list[str]] = {
    # Languages
    "python": ["py-patterns", "qa-patterns"],
    "typescript": ["ts-patterns", "qa-patterns"],
    "javascript": ["ts-patterns", "jsbackend-patterns", "qa-patterns"],
    "go": ["go-patterns", "qa-patterns"],
    "rust": ["rs-patterns", "qa-patterns"],
    "java": ["java-patterns", "qa-patterns"],
    "php": ["php-patterns", "qa-patterns"],
    "swift": ["swift-patterns", "qa-patterns"],
    "lua": ["lua-patterns", "qa-patterns"],
    # Frameworks / domains
    "react": ["ts-patterns", "ui-patterns", "ux-patterns"],
    "tauri": ["rs-patterns", "rust-backend"],
    "deno-fresh": ["ts-patterns", "fresh-ui-components", "fresh-ui-animation"],
    "devops": ["devops-patterns", "dev-patterns"],
    "frontend": ["ui-patterns", "ux-patterns", "css-theming"],
}

# Core agents always included when include_core=True
_CORE_AGENTS = ["orchestrator", "debugger", "reviewer"]

# Core skills always included
_CORE_SKILLS = ["qa-patterns", "testing", "validation", "debug"]


def _parse_agent_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML-like frontmatter from an agent .md file.

    Returns (frontmatter_dict, body_after_frontmatter).
    """
    if not content.startswith("---"):
        return {}, content

    end_idx = content.index("---", 3)
    fm_text = content[3:end_idx].strip()
    body = content[end_idx + 3:].lstrip("\n")

    fm = {}
    for line in fm_text.splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            fm[key.strip()] = val.strip()
    return fm, body


def _build_agent_frontmatter(fm: dict) -> str:
    """Serialize frontmatter dict back to YAML-like block."""
    lines = ["---"]
    # Preserve key order: name, description, model, tools, skills
    key_order = ["name", "description", "model", "tools", "skills"]
    written = set()
    for key in key_order:
        if key in fm:
            lines.append(f"{key}: {fm[key]}")
            written.add(key)
    for key, val in fm.items():
        if key not in written:
            lines.append(f"{key}: {val}")
    lines.append("---")
    return "\n".join(lines)


def _resolve_skills_for_stack(tech_stack: list[str], extra_skills: list[str] | None = None) -> list[str]:
    """Given a tech_stack list, resolve the full set of recommended skills."""
    skills = set(_CORE_SKILLS)
    for tech in tech_stack:
        key = tech.lower().strip()
        if key in _TECH_SKILL_MAP:
            skills.update(_TECH_SKILL_MAP[key])
    if extra_skills:
        skills.update(extra_skills)
    return sorted(skills)


def _resolve_agents_for_stack(tech_stack: list[str], extra_agents: list[str] | None = None) -> list[str]:
    """Given a tech_stack list, resolve recommended agents."""
    agents = set(_CORE_AGENTS)
    stack_lower = {t.lower().strip() for t in tech_stack}

    # Detect if project has frontend/backend needs
    frontend_techs = {"react", "vue", "angular", "svelte", "deno-fresh", "typescript", "javascript", "frontend"}
    backend_techs = {"python", "go", "rust", "java", "php", "swift", "lua"}

    has_frontend = bool(stack_lower & frontend_techs)
    has_backend = bool(stack_lower & backend_techs)

    if has_frontend:
        agents.add("frontend")
    if has_backend:
        agents.add("backend")

    # Always include tester
    agents.add("tester")

    if extra_agents:
        agents.update(extra_agents)
    return sorted(agents)


@mcp.tool()
def deploy_project_agents(
    project_path: str,
    tech_stack: list[str],
    extra_agents: list[str] | None = None,
    extra_skills: list[str] | None = None,
    include_core: bool = True,
    tech_context: dict | None = None,
    session_id: str | None = None,
) -> dict:
    """Deploy specialized agents with injected skills to a user project.

    Copies agent templates from AgentCockpit hub and skill directories,
    customizing each agent's frontmatter with the skills relevant to the
    project's tech stack. Creates .claude/agents/ and .claude/skills/
    in the target project.

    Args:
        project_path: Absolute path to the target project directory
        tech_stack: List of technologies (e.g. ["typescript", "python", "react"])
        extra_agents: Additional agent names to deploy beyond auto-detected ones
        extra_skills: Additional skill names to deploy beyond auto-detected ones
        include_core: Include orchestrator, debugger, reviewer (default True)
        tech_context: Optional dict with project details (e.g. {"frontend": "React 19", "backend": "FastAPI"})
        session_id: Optional session ID

    Returns:
        Manifest of deployed agents and skills with paths

    Example:
        deploy_project_agents(
            project_path="/home/user/my-project",
            tech_stack=["typescript", "python", "react"],
            tech_context={"frontend": "React 19", "backend": "FastAPI"}
        )
    """
    hub_dir = get_hub_dir()
    hub_agents_dir = hub_dir / ".claude" / "agents"
    hub_skills_dir = hub_dir / ".claude" / "skills"

    target = Path(project_path)
    if not target.exists():
        return {"error": True, "message": f"Project path does not exist: {project_path}"}

    target_agents_dir = target / ".claude" / "agents"
    target_skills_dir = target / ".claude" / "skills"

    # Resolve what to deploy
    agents_to_deploy = _resolve_agents_for_stack(tech_stack, extra_agents) if include_core else list(extra_agents or [])
    skills_to_deploy = _resolve_skills_for_stack(tech_stack, extra_skills)

    # Create target directories
    target_agents_dir.mkdir(parents=True, exist_ok=True)
    target_skills_dir.mkdir(parents=True, exist_ok=True)

    deployed_agents = []
    skipped_agents = []
    deployed_skills = []
    skipped_skills = []

    # --- Deploy agents ---
    for agent_name in agents_to_deploy:
        src = hub_agents_dir / f"{agent_name}.md"
        dst = target_agents_dir / f"{agent_name}.md"

        if not src.exists():
            skipped_agents.append({"name": agent_name, "reason": "template not found in hub"})
            continue

        content = src.read_text(encoding="utf-8")
        fm, body = _parse_agent_frontmatter(content)

        # Inject skills into frontmatter
        fm["skills"] = ", ".join(skills_to_deploy)

        # Remove agentful-specific MCP tools that won't exist in target project
        if "tools" in fm:
            tools = fm["tools"]
            cleaned = ", ".join(
                t.strip() for t in tools.split(",")
                if not t.strip().startswith("mcp__agentful__")
            )
            fm["tools"] = cleaned

        # Build customized content
        new_content = _build_agent_frontmatter(fm) + "\n" + body

        # Append tech context section if provided
        if tech_context:
            ctx_lines = ["\n\n## Project Tech Stack\n"]
            for key, val in tech_context.items():
                ctx_lines.append(f"- **{key}**: {val}")
            ctx_lines.append("")
            new_content += "\n".join(ctx_lines)

        dst.write_text(new_content, encoding="utf-8")
        deployed_agents.append({
            "name": agent_name,
            "path": str(dst),
            "skills_injected": skills_to_deploy,
        })

    # --- Deploy skills ---
    import shutil

    for skill_name in skills_to_deploy:
        src_dir = hub_skills_dir / skill_name
        dst_dir = target_skills_dir / skill_name

        if not src_dir.exists():
            skipped_skills.append({"name": skill_name, "reason": "skill not found in hub"})
            continue

        # Copy entire skill directory (overwrite if exists)
        if dst_dir.exists():
            shutil.rmtree(dst_dir)
        shutil.copytree(src_dir, dst_dir)

        # Count files copied
        files = list(dst_dir.rglob("*"))
        file_count = sum(1 for f in files if f.is_file())
        deployed_skills.append({
            "name": skill_name,
            "path": str(dst_dir),
            "files": file_count,
        })

    return {
        "success": True,
        "project_path": project_path,
        "tech_stack": tech_stack,
        "agents_deployed": deployed_agents,
        "agents_skipped": skipped_agents,
        "skills_deployed": deployed_skills,
        "skills_skipped": skipped_skills,
        "summary": {
            "agents": len(deployed_agents),
            "skills": len(deployed_skills),
            "skipped": len(skipped_agents) + len(skipped_skills),
        },
        "tech_context": tech_context,
    }


@mcp.tool()
def list_available_agents_and_skills(
    session_id: str | None = None,
) -> dict:
    """List all agents and skills available in the AgentCockpit hub.

    Use this to discover what can be deployed before calling deploy_project_agents.

    Args:
        session_id: Optional session ID

    Returns:
        Lists of available agent names and skill names with descriptions
    """
    hub_dir = get_hub_dir()
    hub_agents_dir = hub_dir / ".claude" / "agents"
    hub_skills_dir = hub_dir / ".claude" / "skills"

    agents = []
    for f in sorted(hub_agents_dir.glob("*.md")):
        content = f.read_text(encoding="utf-8")
        fm, _ = _parse_agent_frontmatter(content)
        agents.append({
            "name": fm.get("name", f.stem),
            "description": fm.get("description", ""),
            "model": fm.get("model", "sonnet"),
        })

    skills = []
    for d in sorted(hub_skills_dir.iterdir()):
        if d.is_dir():
            skill_file = d / "SKILL.md"
            desc = ""
            if skill_file.exists():
                content = skill_file.read_text(encoding="utf-8")
                # Extract description from frontmatter
                if content.startswith("---"):
                    try:
                        end = content.index("---", 3)
                        for line in content[3:end].splitlines():
                            if line.startswith("description:"):
                                desc = line.partition(":")[2].strip()
                                break
                    except ValueError:
                        pass
            skills.append({"name": d.name, "description": desc})

    return {
        "agents": agents,
        "skills": skills,
        "tech_skill_map": _TECH_SKILL_MAP,
        "core_agents": _CORE_AGENTS,
        "core_skills": _CORE_SKILLS,
        "hub_dir": str(hub_dir),
    }
