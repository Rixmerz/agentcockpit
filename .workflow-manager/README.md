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

## Experience Memory System

Sistema de memoria experiencial automática que aprende de resultados DCC (tensiones, smells, gate blocks) y los inyecta como contexto cuando el agente modifica archivos.

### Arquitectura

```
                    ┌──────────────────────────────┐
                    │   Experience Memory Store     │
                    │  ~/.workflow-manager/         │
                    │  ├── experience_memory.json   │  ← Global (cross-project)
                    │  └── project_memories/        │
                    │      └── {project}/           │  ← Per-project
                    │          └── experience.json  │
                    └──────┬───────────────┬────────┘
                           │               │
              ┌────────────┘               └─────────────┐
              │ WRITE (colección)           READ (inyección) │
              │                                             │
    ┌─────────▼───────────────┐          ┌──────────────────▼──────────┐
    │  MCP Server (server.py)  │          │  PreToolUse Hook            │
    │                          │          │  (experience_injector.py)   │
    │ Colección automática:    │          │                             │
    │ - graph_traverse() DCC   │          │ On Write/Edit:              │
    │ - _check_tension_gate()  │          │ 1. Lee archivo target       │
    │ - experience_record()    │          │ 2. Carga memory JSONs       │
    │                          │          │ 3. Score + rank             │
    │ Escribe a disco          │          │ 4. Output top 3 a stderr   │
    └──────────────────────────┘          │ 5. Approve (exit 0)        │
                                          └─────────────────────────────┘
```

### Cómo funciona

1. **Colección automática**: Cuando `graph_traverse()` ejecuta análisis DCC, las tensiones y smells detectados se guardan como experiencias (global + por proyecto).
2. **Gate tracking**: Cuando `_check_tension_gate()` bloquea o permite avanzar, se registran experiencias `gate_blocked` / `gate_resolved`.
3. **Inyección**: El hook `experience_injector.py` se ejecuta antes de cada `Write`/`Edit`. Lee las memorias, rankea por relevancia al archivo siendo modificado, y muestra las top 3 al agente vía stderr.
4. **Deduplicación**: Experiencias repetidas (mismo `type + file_pattern + domain`) se fusionan, incrementando ocurrencias y confianza.
5. **Confianza asintótica**: Crece con repetición (0.28 → 0.48 → 0.65 → 0.79 → ...), capped en 0.95.
6. **Evicción**: Al superar 500 entries, se eliminan las de menor confianza/más antiguas.

### MCP Tools

| Tool | Descripción |
|------|-------------|
| `experience_query(file_path)` | Busca memorias relevantes para un archivo |
| `experience_record(type, file_path, description)` | Registra una experiencia manualmente |
| `experience_list(type_filter, scope_filter)` | Lista memorias con filtros |
| `experience_stats()` | Estadísticas: conteos por tipo, scope, confianza |

### Tipos de experiencia

| Tipo | Cuándo se crea |
|------|---------------|
| `tension_caused` | DCC detecta tensión en un archivo |
| `tension_resolved` | Tensión previamente detectada desaparece |
| `smell_introduced` | DCC detecta code smell |
| `smell_fixed` | Smell previamente detectado desaparece |
| `gate_blocked` | Tension gate bloquea avance del workflow |
| `gate_resolved` | Gate pasa después de intentos previos bloqueados |
| `impact_high` | Impacto alto detectado en archivo |

### Relevancia scoring

```
score = path_match * 0.30 + keyword_overlap * 0.25 + domain_match * 0.20
        + confidence * 0.15 + recency * 0.10
```

### Storage

- **Global**: `~/.workflow-manager/experience_memory.json`
- **Per-project**: `~/.workflow-manager/project_memories/{project_name}/experience_memory.json`

### Hook output (ejemplo)

```
⚡ Experience Memory (3 matches for authService.ts):
  [0.85] Service files with >10 imports → hub_overload smell (4x)
    → Extract shared interfaces to reduce coupling
  [0.72] Auth domain changes → tension with middleware (3x)
    → Run cube_predict_impact before editing
  [0.45] Renaming exports → shotgun surgery (global, 2x)
    → Use cube_simulate_wave to preview propagation
```

## Archivos

```
.workflow-manager/
├── src/workflow_manager/
│   ├── server.py              # FastMCP server (33 tools)
│   ├── experience_memory.py   # Experience memory core module
│   ├── graph_engine.py        # Graph execution engine
│   ├── graph_parser.py        # YAML parsing
│   └── graph_state.py         # State management
├── pyproject.toml
└── README.md                  # Esta documentación

.claude/hooks/
├── graph_enforcer.py          # PreToolUse: bloquea tools por nodo
└── experience_injector.py     # PreToolUse: inyecta memorias en Write/Edit
```
