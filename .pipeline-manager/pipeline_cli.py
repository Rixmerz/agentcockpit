#!/usr/bin/env python3
"""
Pipeline CLI - Gestión del Flow-Controlled MCP Pipeline

Uso:
  pipeline status    - Ver estado actual
  pipeline reset     - Resetear pipeline a step 0
  pipeline advance   - Avanzar manualmente al siguiente step
  pipeline steps     - Listar todos los steps
  pipeline config    - Ver configuración actual
  pipeline config reset_policy <manual|timeout|per_session>
  pipeline config timeout_minutes <N>
  pipeline config force_sequential <true|false>
"""

import json
import sys
from pathlib import Path
from datetime import datetime

PIPELINE_DIR = Path.home() / ".claude" / "pipeline"
STATE_FILE = PIPELINE_DIR / "state.json"
STEPS_FILE = PIPELINE_DIR / "steps.yaml"


def load_state():
    try:
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text())
    except Exception:
        pass
    return {"current_step": 0, "completed_steps": [], "step_history": []}


def save_state(state):
    state["last_activity"] = datetime.now().isoformat()
    STATE_FILE.write_text(json.dumps(state, indent=2))


def load_steps():
    """Carga steps desde YAML de forma simplificada."""
    if not STEPS_FILE.exists():
        return []

    content = STEPS_FILE.read_text()
    steps = []
    current_step = None

    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('- id:'):
            if current_step:
                steps.append(current_step)
            step_id = stripped.split('"')[1] if '"' in stripped else stripped.split(':')[1].strip()
            current_step = {"id": step_id}
        elif current_step and ':' in stripped and not stripped.startswith('-'):
            key, _, value = stripped.partition(':')
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if value:
                current_step[key] = value

    if current_step:
        steps.append(current_step)

    return steps


def cmd_status():
    """Muestra el estado actual del pipeline."""
    state = load_state()
    steps = load_steps()
    current = state.get("current_step", 0)

    print("\n🔄 PIPELINE STATUS")
    print("=" * 50)

    for i, step in enumerate(steps):
        if i < current:
            status = "✅"
        elif i == current:
            status = "👉"
        else:
            status = "⬚"

        name = step.get("name", step.get("id", f"Step {i}"))
        print(f"  {status} Step {i}: {name}")

    print("=" * 50)
    print(f"  Current: Step {current}")
    print(f"  Completed: {len(state.get('completed_steps', []))}")

    if state.get("last_activity"):
        print(f"  Last activity: {state['last_activity']}")

    print()


def cmd_reset():
    """Resetea el pipeline a step 0."""
    state = {
        "current_step": 0,
        "completed_steps": [],
        "session_id": None,
        "started_at": datetime.now().isoformat(),
        "last_activity": None,
        "step_history": []
    }
    save_state(state)
    print("✅ Pipeline reseteado a Step 0")


def cmd_advance():
    """Avanza manualmente al siguiente step."""
    state = load_state()
    steps = load_steps()
    current = state.get("current_step", 0)

    if current >= len(steps) - 1:
        print("⚠️ Ya estás en el último step")
        return

    state["current_step"] = current + 1
    state["completed_steps"].append({
        "id": steps[current].get("id", f"step_{current}"),
        "completed_at": datetime.now().isoformat(),
        "reason": "Manual advance"
    })
    state["step_history"].append({
        "from_step": current,
        "to_step": current + 1,
        "timestamp": datetime.now().isoformat(),
        "reason": "Manual advance"
    })
    save_state(state)

    next_step = steps[current + 1]
    print(f"✅ Avanzado a Step {current + 1}: {next_step.get('name', next_step.get('id'))}")


def cmd_steps():
    """Lista todos los steps configurados."""
    steps = load_steps()

    print("\n📋 PIPELINE STEPS")
    print("=" * 50)

    for i, step in enumerate(steps):
        name = step.get("name", step.get("id", f"Step {i}"))
        desc = step.get("description", "")
        print(f"\n  Step {i}: {name}")
        if desc:
            print(f"    {desc}")

        enabled = step.get("mcps_enabled", [])
        if enabled:
            print(f"    MCPs: {enabled}")

        blocked = step.get("tools_blocked", [])
        if blocked:
            print(f"    Blocked: {blocked}")

    print()


def load_config():
    """Carga la configuración desde YAML."""
    if not STEPS_FILE.exists():
        return {"reset_policy": "timeout", "timeout_minutes": 30, "force_sequential": False}

    content = STEPS_FILE.read_text()
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


def save_config(config):
    """Guarda la configuración en YAML."""
    if not STEPS_FILE.exists():
        print("❌ No existe el archivo steps.yaml")
        return False

    content = STEPS_FILE.read_text()
    lines = content.split('\n')
    new_lines = []
    in_config = False
    config_written = False

    for line in lines:
        stripped = line.strip()

        if stripped == "config:":
            in_config = True
            new_lines.append(line)
            # Write new config values
            new_lines.append(f"  reset_policy: \"{config.get('reset_policy', 'timeout')}\"")
            new_lines.append(f"  timeout_minutes: {config.get('timeout_minutes', 30)}")
            new_lines.append(f"  force_sequential: {str(config.get('force_sequential', False)).lower()}")
            config_written = True
            continue

        if in_config and stripped.startswith("steps:"):
            in_config = False
            new_lines.append("")  # Empty line before steps
            new_lines.append(line)
            continue

        if in_config and not stripped.startswith('#') and ':' in stripped:
            # Skip old config lines
            continue

        new_lines.append(line)

    STEPS_FILE.write_text('\n'.join(new_lines))
    return True


def cmd_config(args):
    """Muestra o modifica la configuración."""
    config = load_config()

    if len(args) == 0:
        # Show current config
        print("\n⚙️ PIPELINE CONFIG")
        print("=" * 50)
        print(f"  reset_policy: {config.get('reset_policy', 'timeout')}")
        print(f"    Options: manual | timeout | per_session")
        print(f"  timeout_minutes: {config.get('timeout_minutes', 30)}")
        print(f"  force_sequential: {config.get('force_sequential', False)}")
        print("=" * 50)
        print()
        return

    if len(args) < 2:
        print("❌ Uso: pipeline config <key> <value>")
        return

    key = args[0]
    value = args[1]

    if key == "reset_policy":
        if value not in ["manual", "timeout", "per_session"]:
            print("❌ Valores válidos: manual | timeout | per_session")
            return
        config["reset_policy"] = value
    elif key == "timeout_minutes":
        try:
            config["timeout_minutes"] = int(value)
        except ValueError:
            print("❌ timeout_minutes debe ser un número")
            return
    elif key == "force_sequential":
        config["force_sequential"] = value.lower() == "true"
    else:
        print(f"❌ Configuración desconocida: {key}")
        return

    if save_config(config):
        print(f"✅ {key} = {config[key]}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1].lower()

    if cmd == "status":
        cmd_status()
    elif cmd == "reset":
        cmd_reset()
    elif cmd == "advance":
        cmd_advance()
    elif cmd == "steps":
        cmd_steps()
    elif cmd == "config":
        cmd_config(sys.argv[2:])
    else:
        print(f"Comando desconocido: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
