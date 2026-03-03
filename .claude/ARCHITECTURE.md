# AgentCockpit Architecture

Documento viviente del ecosistema completo: MCPs, tools, workflows, agents, skills, y patrones de orquestacion.

---

## 1. MCP Servers

### 1.1 Workflow-Manager (26 tools)

Servidor central de orquestacion. Gestiona sesiones, workflows de grafos, proxy de tools, y busqueda semantica.

| Categoria | Tool | Descripcion |
|-----------|------|-------------|
| **Session** | `set_session` | Establece el proyecto activo para la sesion |
| | `workflow_set_enabled` | Activa/desactiva el enforcer del workflow |
| | `close_mcp_connections` | Cierra conexiones MCP activas |
| **Graph Nav** | `graph_status` | Estado actual: nodo, edges disponibles, visitas |
| | `graph_traverse` | Moverse por un edge al siguiente nodo |
| | `graph_check_tool` | Verificar si un tool call dispara transicion |
| | `graph_check_phrase` | Verificar si texto dispara transicion |
| | `graph_reset` | Reset al nodo de inicio |
| | `graph_set_node` | Saltar a nodo especifico (admin) |
| **Graph Viz** | `graph_visualize` | Generar diagrama Mermaid del grafo |
| | `graph_validate` | Validar estructura del grafo |
| **Graph Mgmt** | `graph_override_max_visits` | Override max_visits de un nodo |
| | `graph_list_available` | Listar grafos disponibles en workflows library |
| | `graph_activate` | Activar un grafo desde la library |
| **Proxy** | `execute_mcp_tool` | Ejecutar cualquier MCP tool via proxy |
| **Search** | `search_tools` | Buscar tools por objetivo con similitud semantica |
| | `refresh_tool_index` | Actualizar indice de tools |
| | `get_learned_weights` | Ver pesos aprendidos del sistema de busqueda |
| | `reset_learned_weights` | Resetear pesos aprendidos |
| **Builder** | `graph_builder_create` | Crear sesion de builder |
| | `graph_builder_add_node` | Agregar nodo al builder |
| | `graph_builder_add_edge` | Agregar edge al builder |
| | `graph_builder_preview` | Preview del YAML generado |
| | `graph_builder_save` | Guardar grafo en library |
| | `graph_builder_list` | Listar builders activos |
| | `graph_builder_delete` | Eliminar builder sin guardar |

**Arquitectura:** Centralized Hub. Workflows globales en `{hub}/.claude/workflows/`. Estados centralizados en `{hub}/.agentcockpit/states/{project}/`. Config en `~/.agentcockpit/config.json`.

### 1.2 DeltaCodeCube (35 tools)

Indexacion multidimensional de codigo. Representa archivos como puntos en espacio de features 63D para busqueda por similaridad, analisis de impacto, y deteccion de cambios.

| Categoria | Tool | Descripcion |
|-----------|------|-------------|
| **Indexacion** | `cube_index_file` | Indexar un archivo en el espacio 63D |
| | `cube_index_directory` | Indexar todos los archivos de un directorio |
| | `cube_reindex` | Re-indexar archivo y detectar cambios/tensiones |
| **Consulta** | `cube_get_position` | Obtener coordenadas de un archivo en el cubo |
| | `cube_get_stats` | Estadisticas del cubo (total files, grade, score) |
| | `cube_list_code_points` | Listar code points indexados con paginacion |
| | `cube_get_temporal` | Features temporales (git history) de un archivo |
| **Busqueda** | `cube_find_similar` | Buscar archivos similares a uno dado |
| | `cube_search_by_domain` | Buscar archivos por dominio semantico |
| | `cube_find_by_criteria` | Buscar archivos por multiples criterios |
| | `cube_compare` | Comparar dos archivos en detalle |
| **Analisis** | `cube_analyze_graph` | Analizar grafo de dependencias, metricas de centralidad |
| | `cube_get_centrality` | Metricas de centralidad para un archivo |
| | `cube_detect_smells` | Detectar code smells en el codebase |
| | `cube_cluster_files` | Clusterizar archivos por similaridad (K-means) |
| | `cube_get_suggestions` | Sugerencias priorizadas de refactoring |
| | `cube_analyze_surface` | Analizar API surface de todos los modulos |
| | `cube_detect_drift` | Detectar drift en archivos que divergen |
| | `cube_get_debt` | Calcular score de deuda tecnica |
| **Deltas** | `cube_get_deltas` | Obtener cambios recientes en feature space |
| | `cube_analyze_impact` | Analizar impacto potencial de cambios |
| | `cube_get_tensions` | Obtener tensiones (violaciones de contratos) |
| | `cube_resolve_tension` | Actualizar estado de una tension |
| **Prediccion** | `cube_simulate_wave` | Simular onda de tension desde un archivo |
| | `cube_predict_impact` | Predecir impacto de cambiar un archivo |
| | `cube_detect_clones` | Detectar clones de codigo |
| **Contratos** | `cube_get_contracts` | Obtener relaciones import/require entre archivos |
| | `cube_get_contract_stats` | Estadisticas de contratos detectados |
| **Reparacion** | `cube_suggest_fix` | Generar contexto de fix para tension/cambio |
| **Visualizacion** | `cube_generate_timeline` | Timeline interactivo de cambios |
| | `cube_generate_matrix` | Matriz de dependencias interactiva |
| | `cube_generate_heatmap` | Heatmap de codigo |
| | `cube_generate_architecture` | Diagrama de arquitectura interactivo |
| **Export** | `cube_export_positions` | Exportar posiciones para visualizacion externa |
| | `cube_export_html` | Exportar visualizacion HTML interactiva |

**Fuente:** `.deltacodecube/src/deltacodecube/tools/` (6 modulos: core, contracts, deltas, search, analysis, visualizations)

### 1.3 Otros MCPs en el Ecosistema

| MCP | Proposito | Usado en workflows |
|-----|-----------|-------------------|
| `sequential-thinking` | Razonamiento paso a paso forzado | haiku-orchestrator, denofresh-analyzer, testing-demo |
| `cfa4` | Context-First Architecture — memoria, knowledge graph | cfa-remember, cfa-recall, testing-demo |
| `denofreshmcp` | Deno Fresh project scaffolding/generation | denofresh-analyzer, landing-generator, fresh-seo-optimizer, landing-from-materials |
| `lighthouse` | Auditorias web performance/accessibility | denofresh-analyzer |
| `Context7` | Documentacion de librerias | testing-demo |

---

## 2. Graph Workflows

Todos los workflows residen en `.claude/workflows/`. Son grafos YAML con nodos, edges, y condiciones de transicion.

### 2.1 Inventario

| Workflow | Archivo | Nodos | Patron | MCPs |
|----------|---------|-------|--------|------|
| CFA Remember | `cfa-remember-graph.yaml` | 3 | Linear (2 + end) | cfa4 |
| CFA Recall | `cfa-recall-graph.yaml` | 3 | Linear (2 + end) | cfa4 |
| CFA Remember Test | `cfa-remember-test-graph.yaml` | 3 | Linear test | cfa4 |
| Haiku Orchestrator | `haiku-orchestrator-graph.yaml` | 19 | Multi-branch escalation | sequential-thinking |
| Landing Generator | `landing-generator-graph.yaml` | 34 | Sequential + loops | denofreshmcp, sequential-thinking |
| DenoFresh Analyzer | `denofresh-analyzer-graph.yaml` | 36 | Hybrid multi-agent | denofreshmcp, lighthouse, sequential-thinking |
| Fresh SEO Optimizer | `fresh-seo-optimizer-graph.yaml` | 27 | SEO focused | denofreshmcp |
| Landing from Materials | `landing-from-materials-graph.yaml` | 38 | Material-based generation | denofreshmcp |
| Testing Demo | `testing-demo.yaml` | 4 | Simple demo | sequential-thinking, cfa4, Context7, deltacodecube |
| **DCC Code Quality** | `dcc-code-quality-graph.yaml` | 7 | Quality lifecycle | deltacodecube |
| **Macro Orchestrator** | `macro-orchestrator-graph.yaml` | 5 | Workflow-of-workflows | workflow-manager |

### 2.2 Patrones de Diseno de Workflows

**Linear:** Nodos secuenciales sin branches. Ejemplo: cfa-remember (capture → complete).

**Multi-branch:** Un nodo clasificador enruta a diferentes caminos segun la condicion. Ejemplo: haiku-orchestrator (thinking → classify → trivial|development|planning).

**Sequential + Loops:** Flujo largo con loops de retry. Nodos validate pueden volver a develop. Ejemplo: landing-generator.

**Hybrid Multi-agent:** Nodos delegan a sub-agents especificos via Task tool. Ejemplo: denofresh-analyzer.

**Workflow-of-Workflows (Macro):** Un grafo que activa otros grafos via `graph_activate` y delega a agents. Ver `macro-orchestrator-graph.yaml`.

### 2.3 Anatomia de un Nodo

```yaml
- id: "node-id"
  name: "Display Name"
  is_start: true          # Solo uno por grafo
  is_end: true            # Puede haber varios
  model: haiku            # Override de modelo (haiku/sonnet/opus)
  mcps_enabled:
    - "mcp-name"          # Solo estos MCPs disponibles
    - "*"                 # Todos los MCPs
  tools_blocked:
    - "Write"             # Bloquear tools especificas
    - "Edit"
  max_visits: 10          # Limite de visitas (previene loops infinitos)
  prompt_injection: |     # Prompt inyectado cuando se esta en este nodo
    Instrucciones para el modelo...
```

### 2.4 Tipos de Edge Conditions

```yaml
edges:
  - id: "edge-id"
    from: "source-node"
    to: "target-node"
    condition:
      type: "tool"        # Se dispara cuando se usa el tool especificado
      tool: "tool_name"
    # O:
    condition:
      type: "phrase"      # Se dispara cuando el modelo dice la frase
      phrases:
        - "task completed"
        - "done"
    priority: 1           # Menor = mayor prioridad
```

---

## 3. Agents

Todos los agents residen en `.claude/agents/`. Son archivos `.md` con frontmatter YAML y system prompt.

| Agent | Archivo | Foco | Model |
|-------|---------|------|-------|
| form-specialist | `form-specialist.md` | Formularios + validacion Deno Fresh | inherit |
| component-builder | `component-builder.md` | UI components + CVA | inherit |
| ui-master | `ui-master.md` | UI end-to-end (combina todo) | inherit |
| integration-tester | `integration-tester.md` | Testing + type checking | inherit |
| layout-architect | `layout-architect.md` | Layouts + responsive design | inherit |
| animation-designer | `animation-designer.md` | Animaciones + transitions | inherit |
| **codebase-analyst** | `codebase-analyst.md` | Analisis DCC de codebase | haiku |
| **workflow-executor** | `workflow-executor.md` | Ejecutor autonomo de workflows | inherit |

### Patron de Agent

```markdown
---
name: agent-name
description: |
  Descripcion corta.
  Cuando usar este agente...
---

# Agent Title

## Capacidades
...

## Workflows
...
```

---

## 4. Skills

Todas las skills residen en `.claude/skills/`. Son directorios con `SKILL.md`.

| Skill | Directorio | Invocacion | Foco |
|-------|-----------|------------|------|
| fresh-ui-components | `skills/fresh-ui-components/` | cargada automaticamente | 40+ componentes UI |
| fresh-ui-animation | `skills/fresh-ui-animation/` | cargada automaticamente | 20+ presets animacion |
| workflow | `skills/workflow/` | `/workflow [status|advance|reset|set N]` | Control de workflow |
| **dcc-analysis** | `skills/dcc-analysis/` | `/dcc-analysis` | Catalogo DCC + flujos |

---

## 5. Patrones de Orquestacion

### 5.1 Tool Blocking — Hard Enforcement via Hook

`tools_blocked` en nodos de grafo se aplica de dos formas:

**Hard enforcement (hook):** `graph_enforcer.py` es un PreToolUse hook registrado con matcher `"*"` en `settings.json`. Intercepta CADA tool call antes de ejecucion:

```
Claude → PreToolUse hook → graph_enforcer.py
                              ├── Lee graph_state.json (hub centralizado)
                              ├── Lee graph.yaml (local al proyecto)
                              ├── Compara tool_name vs tools_blocked del nodo actual
                              ├── Bloqueado → {"decision": "block", "message": "..."}
                              └── Permitido → {"decision": "approve"}
```

**Soft enforcement (prompt injection):** `prompt_injection` del nodo incluye instrucciones al modelo. El modelo puede ignorarlo — la hard enforcement lo previene.

**Fail-safe:** Cualquier error en el hook (archivo faltante, JSON invalido, excepcion) resulta en `approve`. Nunca bloquea trabajo legitimo.

**Wildcard:** `"*"` en `tools_blocked` bloquea todas las tools (util para nodos estrictamente de lectura).

**Comparacion con mcps_enabled:** `mcps_enabled` se aplica dentro de `execute_mcp_tool` en server.py (hardcoded). `tools_blocked` se aplica via el hook externo.

Patron de uso: `tools_blocked: ["Write", "Edit", "Bash"]` en nodos de analisis.

### 5.2 Model per Node

Nodos simples usan `model: haiku` (rapido, barato). Nodos complejos heredan o usan `model: sonnet`. Nodos de arquitectura usan `model: opus`. Ya soportado en el graph engine.

### 5.3 Minimal Context Injection

Cada `prompt_injection` solo contiene las instrucciones necesarias para ese nodo. No inyectar contexto global — usar `global_prompt` solo para reglas criticas.

### 5.4 Sub-agent Delegation

Para tareas que generan mucho output (test suites, analisis completo), delegar a sub-agent via `Task` tool. Mantiene limpio el contexto principal.

**Limitacion:** Sub-agents en background no tienen acceso a MCP tools. Solo el contexto principal puede usar MCPs.

### 5.5 Paralelizacion

- Sub-agents paralelos para tareas read-only (analisis, busqueda)
- Main context para modificaciones (Write, Edit)
- Costo: ~duplicar tokens de contexto por instancia paralela
- Patron: lanzar N explorers en paralelo, consolidar en main

### 5.6 Workflow-of-Workflows (Macro)

Limitacion: solo un graph activo por proyecto. Workaround:
1. Macro-workflow clasifica la tarea
2. Activa el workflow apropiado via `graph_activate`
3. Delega a agent configurado con ese workflow
4. Agent ejecuta el micro-flujo completo
5. Al volver, macro-workflow avanza

---

## 6. DCC por Fase de Desarrollo

Mapeo de cuales tools de DCC usar en cada fase del ciclo de desarrollo:

| Fase | Tools DCC | Cuando |
|------|-----------|--------|
| **Setup** | `cube_index_directory`, `cube_index_file` | Inicio de proyecto, post-commit, CI |
| **Explorar** | `cube_get_stats`, `cube_analyze_graph`, `cube_get_centrality`, `cube_cluster_files`, `cube_search_by_domain`, `cube_find_similar` | Pre-desarrollo: entender codebase |
| **Detectar** | `cube_detect_smells`, `cube_get_debt`, `cube_get_tensions`, `cube_detect_clones`, `cube_detect_drift`, `cube_analyze_surface` | Pre-refactor, code review |
| **Planificar** | `cube_predict_impact`, `cube_simulate_wave`, `cube_get_contracts`, `cube_get_contract_stats` | Pre-cambio: evaluar riesgo |
| **Desarrollar** | `cube_suggest_fix`, `cube_find_by_criteria`, `cube_compare` | Durante implementacion |
| **Validar** | `cube_reindex`, `cube_analyze_impact`, `cube_get_tensions`, `cube_get_debt` | Post-cambio: verificar |
| **Reportar** | `cube_generate_architecture`, `cube_generate_matrix`, `cube_generate_heatmap`, `cube_generate_timeline`, `cube_export_html` | Documentacion, entregables |

---

## 7. Estructura de Directorios

```
agentcockpit/
  .claude/
    agents/              # Agent definitions (.md)
    workflows/           # Graph workflow YAMLs
    skills/              # Skill definitions (dirs with SKILL.md)
    hooks/               # Hook scripts (Python)
      graph_enforcer.py  # PreToolUse: hard-blocks tools per graph node
      cfa_validator.py   # PreToolUse/PostToolUse: CFA validation
      cfa_smart_suggestions.py  # PostToolUse: CFA suggestions
    decisions/           # Decision records
    settings.json        # Hooks config
    settings.local.json  # Permissions
    cfa.yaml             # CFA config
    map.md               # Project map
    memories.json        # CFA memories
    knowledge_graph.db   # CFA knowledge graph
    ARCHITECTURE.md      # This file
  .workflow-manager/
    src/workflow_manager/
      server.py          # 26 tools (FastMCP)
      graph_engine.py    # Graph execution engine
      graph_parser.py    # YAML parsing
      graph_state.py     # State management

    data/                # DBs
  .deltacodecube/
    src/deltacodecube/
      server.py          # FastMCP server entry
      tools/             # 35 tools across 6 modules
      cube/              # Core DCC logic
      db/                # SQLite persistence
      visualization/     # HTML export
  .agentcockpit/
    states/              # Centralized workflow states per project
    snapshots.json       # Snapshots
  src/                   # AgentCockpit app source (TypeScript/React)
```
