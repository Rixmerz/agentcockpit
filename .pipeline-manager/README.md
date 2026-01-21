# Flow-Controlled MCP Pipeline

Pipeline de control de flujo para Claude Code que habilita/bloquea MCPs según el step actual.

## Filosofía

Basado en **FFD (Flow First Development)**:
- El flujo del usuario manda
- Orden secuencial estricto
- Dependencias antes que features
- Cero trabajo especulativo

## Steps MVP

| Step | Gate | MCPs Habilitados | Tools Bloqueados |
|------|------|------------------|------------------|
| 0 - Complexity | ¿Tarea compleja? | sequential-thinking | Write, Edit |
| 1 - Library Context | ¿Necesita docs? | Context7 | Write, Edit |
| 2 - Implementation | ✅ Contexto validado | Todos | Ninguno |

## Uso

### CLI

```bash
# Ver estado actual
python3 ~/.claude/pipeline/pipeline_cli.py status

# Resetear a Step 0
python3 ~/.claude/pipeline/pipeline_cli.py reset

# Avanzar manualmente
python3 ~/.claude/pipeline/pipeline_cli.py advance

# Listar steps configurados
python3 ~/.claude/pipeline/pipeline_cli.py steps
```

### Cómo funciona

1. **UserPromptSubmit**: Inyecta prompt del step actual
2. **PreToolUse**: Bloquea tools no permitidos
3. **PostToolUse**: Detecta completación de gates y avanza

### Avanzar Steps

Cada step tiene condiciones para avanzar:

- **Step 0**: Usar `sequential-thinking` O decir "tarea simple"
- **Step 1**: Usar `Context7` O decir "no requiere documentación externa"
- **Step 2**: Siempre disponible (step final)

## Configuración

Edita `~/.claude/pipeline/steps.yaml` para:
- Agregar/modificar steps
- Cambiar MCPs habilitados por step
- Modificar prompts inyectados
- Ajustar condiciones de gates

## Archivos

```
~/.claude/pipeline/
├── steps.yaml           # Definición de steps
├── state.json           # Estado actual (auto-generado)
├── pipeline_controller.py  # Lógica de control
├── pipeline_cli.py      # CLI de gestión
└── README.md            # Esta documentación
```
