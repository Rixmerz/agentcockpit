# Memoria de Edición: Hooks de Claude Code (.claude/hooks/)

## Hooks registrados en settings.json

### SessionStart
- `cfa_validator.py` — valida estructura CFA al iniciar sesión
- `lsp_status_check.py` — verifica estado LSP

### PreToolUse (matcher: *)
- `graph_enforcer.py` — bloquea tools no permitidos en el nodo actual del graph

### PreToolUse (matcher: Edit|Write)
- `cfa_validator.py` — valida que el archivo destino cumple reglas CFA
- `experience_injector.py` — inyecta memorias de experiencia relevantes al archivo
- `memory_injector.py` — inyecta memorias locales del proyecto desde `.claude/memory/`

### PostToolUse (matcher: Edit)
- `cfa_validator.py` — valida post-edición
- `cfa_smart_suggestions.py` — sugiere mejoras smart

## Protocolo de hooks (PreToolUse)
- stdin: `{"tool_name": "Edit", "tool_input": {"file_path": "...", ...}}`
- stdout: `{"decision": "approve"}` o `{"decision": "block", "reason": "..."}`
- stderr: contexto informativo visible al agente (memoria, warnings)
- exit 0: siempre (fail-safe: siempre aprobar si hay error)

## Variables de entorno disponibles
- `CLAUDE_PROJECT_DIR` — raíz del proyecto
- `FILE` — archivo siendo editado (si disponible)

## Regla: hooks deben ser fail-safe
Si el hook falla por cualquier razón, SIEMPRE aprobar (exit 0 con JSON approve).
Nunca bloquear por error técnico del hook.
