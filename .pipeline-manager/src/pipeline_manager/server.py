"""FastMCP server for Pipeline Manager.

Permite a Claude autogestionar el pipeline de flujo:
- Ver estado del pipeline
- Resetear/avanzar el pipeline
- Ver/modificar configuración
- Ver/modificar steps
- Sugerir flujos óptimos
- Ejecutar tools de otros MCPs via proxy (execute_mcp_tool)

Per-Project Support:
- If CLAUDE_PROJECT_DIR env var is set, uses {project}/.claude/pipeline/
- Otherwise falls back to ~/.claude/pipeline/
"""

import os
import json
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional, Any
from fastmcp import FastMCP

# Create FastMCP server
mcp = FastMCP("pipeline-manager")


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


def get_state_file(project_dir: str) -> Path:
    """Get state file path for a project."""
    return get_pipeline_dir(project_dir) / "state.json"


def get_steps_file(project_dir: str) -> Path:
    """Get steps file path for a project."""
    return get_pipeline_dir(project_dir) / "steps.yaml"

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


def load_state(project_dir: str) -> dict:
    """Load current pipeline state for a project."""
    try:
        state_file = get_state_file(project_dir)
        if state_file.exists():
            return json.loads(state_file.read_text())
    except Exception:
        pass
    return {"current_step": 0, "completed_steps": [], "step_history": []}


def save_state(project_dir: str, state: dict):
    """Save pipeline state for a project."""
    state_file = get_state_file(project_dir)
    # Ensure directory exists
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state["last_activity"] = datetime.now().isoformat()
    state_file.write_text(json.dumps(state, indent=2))


def load_steps(project_dir: str) -> list:
    """Load steps from YAML for a project (simple parser)."""
    steps_file = get_steps_file(project_dir)
    if not steps_file.exists():
        return []

    content = steps_file.read_text()
    steps = []
    current_step = None
    in_list = None

    for line in content.split('\n'):
        stripped = line.strip()

        if stripped.startswith('- id:'):
            if current_step:
                steps.append(current_step)
            step_id = stripped.split('"')[1] if '"' in stripped else stripped.split(':')[1].strip()
            current_step = {"id": step_id, "mcps_enabled": [], "tools_blocked": [], "gate_phrases": []}
            in_list = None

        elif current_step:
            if stripped.startswith('mcps_enabled:'):
                in_list = "mcps_enabled"
            elif stripped.startswith('tools_blocked:'):
                in_list = "tools_blocked"
            elif stripped.startswith('gate_phrases:'):
                in_list = "gate_phrases"
            elif stripped.startswith('prompt_injection:'):
                in_list = "prompt_injection"
                current_step["prompt_injection"] = ""
            elif stripped.startswith('- "') and in_list and in_list != "prompt_injection":
                value = stripped[3:-1] if stripped.endswith('"') else stripped[3:]
                current_step[in_list].append(value)
            elif in_list == "prompt_injection" and not stripped.startswith(('mcps_enabled', 'tools_blocked', 'gate_')):
                current_step["prompt_injection"] += stripped + "\n"
            elif ':' in stripped and not stripped.startswith('-'):
                key, _, value = stripped.partition(':')
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if value and key not in ['mcps_enabled', 'tools_blocked', 'gate_phrases', 'prompt_injection']:
                    current_step[key] = value
                    in_list = None

    if current_step:
        steps.append(current_step)

    return steps


def load_config(project_dir: str) -> dict:
    """Load configuration from YAML for a project."""
    steps_file = get_steps_file(project_dir)
    if not steps_file.exists():
        return {"reset_policy": "timeout", "timeout_minutes": 30, "force_sequential": False}

    content = steps_file.read_text()
    config = {"reset_policy": "timeout", "timeout_minutes": 30, "force_sequential": False}
    in_config = False

    for line in content.split('\n'):
        stripped = line.strip()
        if stripped == "config:":
            in_config = True
            continue
        if stripped == "steps:":
            break
        if in_config and ':' in stripped and not stripped.startswith('#'):
            key, _, value = stripped.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if value:
                if value.lower() == "true":
                    config[key] = True
                elif value.lower() == "false":
                    config[key] = False
                elif value.isdigit():
                    config[key] = int(value)
                else:
                    config[key] = value
    return config


# === MCP Tools ===

@mcp.tool()
def pipeline_status(project_dir: str) -> dict:
    """Obtiene el estado actual del pipeline: step actual, steps completados, configuración.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
    """
    state = load_state(project_dir)
    steps = load_steps(project_dir)
    config = load_config(project_dir)
    current = state.get("current_step", 0)
    pipeline_path = get_pipeline_dir(project_dir)

    step_list = []
    for i, step in enumerate(steps):
        status = "completed" if i < current else ("current" if i == current else "pending")
        step_list.append({
            "index": i,
            "id": step.get("id"),
            "name": step.get("name", step.get("id")),
            "status": status,
            "mcps_enabled": step.get("mcps_enabled", []),
            "tools_blocked": step.get("tools_blocked", [])
        })

    return {
        "current_step": current,
        "total_steps": len(steps),
        "steps": step_list,
        "config": config,
        "last_activity": state.get("last_activity"),
        "completed_count": len(state.get("completed_steps", [])),
        "pipeline_path": str(pipeline_path),
        "project_dir": project_dir
    }


@mcp.tool()
def pipeline_reset(project_dir: str) -> dict:
    """Resetea el pipeline al Step 0.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
    """
    state = {
        "current_step": 0,
        "completed_steps": [],
        "session_id": None,
        "started_at": datetime.now().isoformat(),
        "last_activity": None,
        "step_history": []
    }
    save_state(project_dir, state)
    return {"success": True, "message": "Pipeline reset to Step 0", "current_step": 0, "project_dir": project_dir}


@mcp.tool()
def pipeline_advance(project_dir: str) -> dict:
    """Avanza manualmente al siguiente step del pipeline.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
    """
    state = load_state(project_dir)
    steps = load_steps(project_dir)
    current = state.get("current_step", 0)

    if current >= len(steps) - 1:
        return {"success": False, "message": "Already at last step", "current_step": current}

    state["current_step"] = current + 1
    state["completed_steps"].append({
        "id": steps[current].get("id", f"step_{current}"),
        "completed_at": datetime.now().isoformat(),
        "reason": "Manual advance via MCP"
    })
    state["step_history"].append({
        "from_step": current,
        "to_step": current + 1,
        "timestamp": datetime.now().isoformat(),
        "reason": "Manual advance via MCP"
    })
    save_state(project_dir, state)

    next_step = steps[current + 1]
    return {
        "success": True,
        "message": f"Advanced to Step {current + 1}",
        "current_step": current + 1,
        "current_step_name": next_step.get("name", next_step.get("id")),
        "project_dir": project_dir
    }


@mcp.tool()
def pipeline_set_step(project_dir: str, step_index: int) -> dict:
    """Establece el pipeline en un step específico.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
        step_index: Índice del step (0-indexed)
    """
    steps = load_steps(project_dir)

    if step_index < 0 or step_index >= len(steps):
        return {"success": False, "message": f"Invalid step index. Valid range: 0-{len(steps)-1}"}

    state = load_state(project_dir)
    old_step = state.get("current_step", 0)
    state["current_step"] = step_index
    state["step_history"].append({
        "from_step": old_step,
        "to_step": step_index,
        "timestamp": datetime.now().isoformat(),
        "reason": "Set via MCP"
    })
    save_state(project_dir, state)

    target_step = steps[step_index]
    return {
        "success": True,
        "message": f"Set to Step {step_index}",
        "current_step": step_index,
        "current_step_name": target_step.get("name", target_step.get("id")),
        "project_dir": project_dir
    }


@mcp.tool()
def pipeline_get_config(project_dir: str) -> dict:
    """Obtiene la configuración actual del pipeline.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
    """
    config = load_config(project_dir)
    config["project_dir"] = project_dir
    return config


@mcp.tool()
def pipeline_set_config(
    project_dir: str,
    reset_policy: Optional[str] = None,
    timeout_minutes: Optional[int] = None,
    force_sequential: Optional[bool] = None
) -> dict:
    """Modifica la configuración del pipeline.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
        reset_policy: Política de reset (manual, timeout, per_session)
        timeout_minutes: Minutos de inactividad antes de reset
        force_sequential: Si true, incluye instrucción para completar todos los steps
    """
    steps_file = get_steps_file(project_dir)
    if not steps_file.exists():
        return {"success": False, "message": "steps.yaml not found", "project_dir": project_dir}

    config = load_config(project_dir)

    if reset_policy is not None:
        if reset_policy not in ["manual", "timeout", "per_session"]:
            return {"success": False, "message": "Invalid reset_policy. Valid: manual, timeout, per_session"}
        config["reset_policy"] = reset_policy

    if timeout_minutes is not None:
        config["timeout_minutes"] = timeout_minutes

    if force_sequential is not None:
        config["force_sequential"] = force_sequential

    # Save config back to YAML
    content = steps_file.read_text()
    lines = content.split('\n')
    new_lines = []
    in_config = False

    for line in lines:
        stripped = line.strip()

        if stripped == "config:":
            in_config = True
            new_lines.append(line)
            new_lines.append(f'  reset_policy: "{config["reset_policy"]}"')
            new_lines.append(f'  timeout_minutes: {config["timeout_minutes"]}')
            new_lines.append(f'  force_sequential: {str(config["force_sequential"]).lower()}')
            continue

        if in_config and stripped.startswith("steps:"):
            in_config = False
            new_lines.append("")
            new_lines.append(line)
            continue

        if in_config and not stripped.startswith('#') and ':' in stripped:
            continue

        new_lines.append(line)

    steps_file.write_text('\n'.join(new_lines))

    return {"success": True, "config": config, "project_dir": project_dir}


@mcp.tool()
def pipeline_get_steps(project_dir: str) -> dict:
    """Obtiene todos los steps del pipeline con sus detalles.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
    """
    return {"steps": load_steps(project_dir), "project_dir": project_dir}


@mcp.tool()
def pipeline_suggest_flow(task_description: str) -> dict:
    """Sugiere un flujo óptimo de pipeline para una tarea específica.

    Args:
        task_description: Descripción de la tarea para la cual sugerir un flujo
    """
    suggestions = {
        "analysis": f"""Sugerencia de flujo para: {task_description}

Flujo recomendado:
1. **Complexity Gate** (Step 0)
   - Evalúa complejidad con sequential-thinking
   - Bloquea Write/Edit hasta validar

2. **Context Gate** (Step 1)
   - Usa Context7 si hay librerías externas
   - Valida dependencias antes de implementar

3. **Implementation** (Step 2)
   - Habilita todas las herramientas
   - Ejecuta con FFD (lee antes de escribir)

Configuración sugerida:
- reset_policy: "timeout" (30 min) para sesiones de trabajo
- force_sequential: true si necesitas pasos estrictos
""",
        "recommended_steps": [
            {
                "id": "complexity-check",
                "name": "Complexity Gate",
                "purpose": "Evalúa si la tarea requiere razonamiento estructurado",
                "mcps": ["sequential-thinking"],
                "blocked": ["Write", "Edit"]
            },
            {
                "id": "context-validation",
                "name": "Context Gate",
                "purpose": "Obtiene documentación de librerías si es necesario",
                "mcps": ["Context7"],
                "blocked": ["Write", "Edit"]
            },
            {
                "id": "implementation",
                "name": "Implementation",
                "purpose": "Ejecuta la implementación con todas las herramientas",
                "mcps": ["*"],
                "blocked": []
            }
        ],
        "tips": [
            "Usa gate_type: 'any' para permitir avanzar por tool O frase",
            "Usa gate_type: 'tool' si quieres forzar uso de herramienta específica",
            "Agrega gate_phrases para permitir saltar pasos no necesarios"
        ]
    }

    return suggestions


@mcp.tool()
def pipeline_create_step(
    project_dir: str,
    step_id: str,
    name: str,
    description: str,
    order: int,
    mcps_enabled: list[str],
    tools_blocked: Optional[list[str]] = None,
    gate_type: str = "any",
    gate_tool: Optional[str] = None,
    gate_phrases: Optional[list[str]] = None,
    prompt_injection: Optional[str] = None
) -> dict:
    """Crea un nuevo step en el pipeline.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
        step_id: ID único del step
        name: Nombre descriptivo del step
        description: Descripción del propósito del step
        order: Orden del step (0-indexed)
        mcps_enabled: MCPs habilitados en este step. Usar '*' para todos
        tools_blocked: Herramientas bloqueadas en este step
        gate_type: Tipo de gate (any, tool, phrase, always)
        gate_tool: Tool específico que activa el gate
        gate_phrases: Frases que activan el gate
        prompt_injection: Prompt a inyectar al inicio de este step
    """
    steps_file = get_steps_file(project_dir)
    if not steps_file.exists():
        return {"success": False, "message": "steps.yaml not found", "project_dir": project_dir}

    tools_blocked = tools_blocked or []
    gate_phrases = gate_phrases or []

    # Build step YAML
    step_yaml = f'''
  - id: "{step_id}"
    order: {order}
    name: "{name}"
    description: "{description}"
'''

    if prompt_injection:
        step_yaml += f'    prompt_injection: |\n'
        for line in prompt_injection.split('\n'):
            step_yaml += f'      {line}\n'

    step_yaml += '    mcps_enabled:\n'
    for mcp_name in mcps_enabled:
        step_yaml += f'      - "{mcp_name}"\n'

    if tools_blocked:
        step_yaml += '    tools_blocked:\n'
        for tool in tools_blocked:
            step_yaml += f'      - "{tool}"\n'

    step_yaml += f'    gate_type: "{gate_type}"\n'

    if gate_tool:
        step_yaml += f'    gate_tool: "{gate_tool}"\n'

    if gate_phrases:
        step_yaml += '    gate_phrases:\n'
        for phrase in gate_phrases:
            step_yaml += f'      - "{phrase}"\n'

    # Append to file
    content = steps_file.read_text()
    content += step_yaml
    steps_file.write_text(content)

    return {
        "success": True,
        "message": f"Step '{step_id}' created",
        "step": {
            "id": step_id,
            "name": name,
            "order": order
        },
        "project_dir": project_dir
    }


def check_and_advance_gate(project_dir: str, mcp_name: str, tool_name: str) -> Optional[dict]:
    """Check if tool usage triggers gate advancement."""
    state = load_state(project_dir)
    steps = load_steps(project_dir)
    current_idx = state.get("current_step", 0)

    if current_idx >= len(steps):
        return None

    current_step = steps[current_idx]
    gate_tool = current_step.get("gate_tool", "")
    gate_type = current_step.get("gate_type", "any")

    # Check if this tool triggers the gate
    full_tool_name = f"mcp__{mcp_name}__{tool_name}"

    if gate_type == "always":
        # Final step, no advancement
        return None

    if gate_tool and (full_tool_name.startswith(gate_tool) or gate_tool in full_tool_name):
        # Advance to next step
        state["current_step"] = current_idx + 1
        state["completed_steps"].append({
            "id": current_step.get("id", f"step_{current_idx}"),
            "completed_at": datetime.now().isoformat(),
            "reason": f"Gate tool used: {full_tool_name}"
        })
        state["step_history"].append({
            "from_step": current_idx,
            "to_step": current_idx + 1,
            "timestamp": datetime.now().isoformat(),
            "reason": f"Gate tool: {full_tool_name}"
        })
        save_state(project_dir, state)

        if current_idx + 1 < len(steps):
            next_step = steps[current_idx + 1]
            return {
                "advanced": True,
                "from_step": current_idx,
                "to_step": current_idx + 1,
                "next_step_name": next_step.get("name", next_step.get("id"))
            }

    return None


@mcp.tool()
async def execute_mcp_tool(
    project_dir: str,
    mcp_name: str,
    tool_name: str,
    arguments: dict[str, Any]
) -> dict:
    """Execute any available MCP tool through the pipeline proxy.

    This is the universal gateway for calling MCP tools. The available
    tools depend on the current pipeline step. Use pipeline_status to
    see which MCPs are enabled for the current step.

    The tool spawns MCP servers on-demand and maintains a connection pool
    for efficient reuse. MCP configurations are read from ~/.claude.json.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
        mcp_name: Name of the MCP server (e.g., "Context7", "sequential-thinking")
        tool_name: Name of the tool to execute (e.g., "get-library-docs", "sequentialthinking")
        arguments: Tool arguments as a dictionary matching the tool's schema

    Returns:
        The tool execution result or an error message

    Example:
        execute_mcp_tool(
            project_dir="/path/to/project",
            mcp_name="Context7",
            tool_name="get-library-docs",
            arguments={"context7CompatibleLibraryID": "/vercel/next.js", "topic": "routing"}
        )
    """
    global _request_counter

    # 1. Load current step
    state = load_state(project_dir)
    steps = load_steps(project_dir)
    current_idx = state.get("current_step", 0)

    if current_idx >= len(steps):
        current_step = {"mcps_enabled": ["*"], "name": "No steps configured"}
    else:
        current_step = steps[current_idx]

    # 2. Validate MCP is allowed in current step
    enabled_mcps = current_step.get("mcps_enabled", [])
    if "*" not in enabled_mcps and mcp_name not in enabled_mcps:
        return {
            "error": True,
            "message": f"❌ MCP '{mcp_name}' is not available in Step {current_idx}: {current_step.get('name', 'Unknown')}",
            "available_mcps": enabled_mcps,
            "hint": "Use pipeline_status(project_dir) to see available MCPs for current step"
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

    # 5. Check gate condition for auto-advance
    gate_result = check_and_advance_gate(project_dir, mcp_name, tool_name)

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

    # Include gate advancement info if it happened
    if gate_result:
        if isinstance(tool_result, dict):
            tool_result["_pipeline_advanced"] = gate_result
        else:
            tool_result = {
                "result": tool_result,
                "_pipeline_advanced": gate_result
            }

    return tool_result


@mcp.tool()
def get_available_tools(project_dir: str) -> dict:
    """Get the list of available MCP tools for the current pipeline step.

    Returns a manifest of all tools that can be used via execute_mcp_tool
    in the current step.

    Args:
        project_dir: Absolute path to the project directory (REQUIRED)
    """
    state = load_state(project_dir)
    steps = load_steps(project_dir)
    current_idx = state.get("current_step", 0)

    if current_idx >= len(steps):
        return {
            "step": "completed",
            "message": "Pipeline completed, all MCPs available",
            "mcps_enabled": ["*"],
            "project_dir": project_dir
        }

    current_step = steps[current_idx]
    enabled_mcps = current_step.get("mcps_enabled", [])

    return {
        "current_step": current_idx,
        "step_name": current_step.get("name", current_step.get("id")),
        "mcps_enabled": enabled_mcps,
        "tools_blocked": current_step.get("tools_blocked", []),
        "gate_tool": current_step.get("gate_tool", ""),
        "hint": "Use execute_mcp_tool(project_dir, mcp_name, tool_name, arguments) to call any enabled MCP tool",
        "project_dir": project_dir
    }


@mcp.tool()
def list_configured_mcps() -> dict:
    """List all MCP servers configured in ~/.claude.json.

    Returns the names and basic info of all configured MCPs that can be
    used with execute_mcp_tool.
    """
    configs = load_mcp_configs()

    mcps = []
    for name, config in configs.items():
        mcps.append({
            "name": name,
            "command": config.get("command", ""),
            "has_args": bool(config.get("args")),
            "has_env": bool(config.get("env")),
            "disabled": config.get("disabled", False)
        })

    return {
        "total": len(mcps),
        "mcps": mcps,
        "hint": "Use execute_mcp_tool(mcp_name, tool_name, arguments) to call tools"
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
