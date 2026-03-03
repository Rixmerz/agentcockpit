# Flow-Controlled MCP Workflow

Workflow de control de flujo para Claude Code que habilita/bloquea MCPs según el step actual.

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

### Cómo funciona

1. **UserPromptSubmit**: Inyecta prompt del step actual
2. **PreToolUse**: Bloquea tools no permitidos
3. **PostToolUse**: Detecta completación de gates y avanza

### Avanzar Steps

Cada step tiene condiciones para avanzar:

- **Step 0**: Usar `sequential-thinking` O decir "tarea simple"
- **Step 1**: Usar `Context7` O decir "no requiere documentación externa"
- **Step 2**: Siempre disponible (step final)

## Archivos

```
.workflow-manager/
├── src/workflow_manager/
│   ├── server.py          # FastMCP server (26 tools)
│   ├── graph_engine.py    # Graph execution engine
│   ├── graph_parser.py    # YAML parsing
│   └── graph_state.py     # State management
├── pyproject.toml
└── README.md              # Esta documentación
```
