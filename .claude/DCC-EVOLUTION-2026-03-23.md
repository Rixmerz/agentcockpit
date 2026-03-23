# DCC Evolution Plan — De Quality Gate a Capa Inteligente Continua

**Fecha:** 2026-03-23
**Objetivo:** Evolucionar DeltaCodeCube de un analizador batch periódico a una capa intermedia inteligente comparable a Cursor/Windsurf/Kiro

---

## Estado Actual

### Lo que funciona
- [x] Pipeline MCP → Workflow Manager → Inyección de contexto
- [x] 35 tools MCP categorizados (core, search, analysis, security, visualization, contracts, deltas)
- [x] Summarizers con token budget (400 tokens default) — evitan saturar contexto
- [x] Tension Gate con escalamiento gradual (max_retries + acknowledge manual)
- [x] Configuración granular por nodo en YAML (analyses, tension_gate, impact_preview)
- [x] Error handling no-fatal — DCC nunca bloquea el trabajo
- [x] Experience Memory escritura automática (tensiones, smells, gate blocks)

### Comparación con capas intermedias del mercado

| Capa | Cuándo actúa | Granularidad | Feedback loop |
|------|-------------|-------------|---------------|
| **Cursor** | Cada keystroke + tab | Línea/bloque | Instantáneo |
| **Windsurf** | Cada save/acción | Archivo/cascada | Segundos |
| **Kiro** | Por spec/hook | Feature completa | Minutos |
| **DCC actual** | Solo en `graph_traverse()` | Proyecto completo | Solo entre fases |

**Conclusión:** DCC opera como quality gate periódico, no como copiloto continuo.

---

## Hallazgos y Puntos Flacos

### A. DCC Core Integration (dcc_integration.py)

- [x] **A1. Experience Memory es write-only en traversal** ✅
  - `_collect_experiences_from_dcc()` registra tensiones/smells pero `experience_query()` NUNCA se llama durante `graph_traverse()`
  - El sistema aprende pero nunca recuerda
  - **Archivo:** `.workflow-manager/src/workflow_manager/dcc_integration.py` líneas 256-421 (collect) vs líneas 143-294 de `graph_core.py` (traverse)
  - **Fix:** Llamar `experience_query(file_paths)` al inicio de cada traversal e inyectar experiencias relevantes

- [x] **A2. Tension Gate state se pierde al reiniciar** ✅
  - `_tension_gate_state` es un dict en memoria (`Dict[Tuple[str, str], dict]`)
  - Si el proceso se reinicia, el contador de intentos vuelve a 0
  - **Archivo:** `dcc_integration.py` líneas 536-690
  - **Fix:** Serializar `_tension_gate_state` en `state.json` del proyecto

- [x] **A3. No hay inyección mid-phase (entre traversals)** ✅
  - Entre nodo A y nodo B, Claude puede escribir 50 archivos sin feedback de DCC
  - Solo al transitar al siguiente nodo recibe análisis
  - **Impacto:** Alto — es la diferencia fundamental con Cursor/Windsurf
  - **Fix:** Hook en el enforcer que dispare reindex incremental + mini-inyección

- [x] **A4. Impact Preview usa proxy crudo** ✅
  - `git diff HEAD~3` es un heurístico arbitrario
  - No considera la fase actual del workflow ni cuántos commits se hicieron dentro de ella
  - **Archivo:** `dcc_integration.py` líneas 696-799
  - **Fix:** Trackear el commit SHA al entrar a un nodo y hacer `git diff <entry_sha>..HEAD`

- [x] **A5. Reindex completo en cada traversal** ✅
  - `cube_index_directory` reindexa todo el proyecto en cada transición
  - Costoso e innecesario si solo cambiaron 3 archivos
  - **Fix:** Usar `cube_reindex` con lista de archivos cambiados (de git diff)

- [x] **A6. No hay temporal decay en experience memory** ✅
  - Todas las entradas tienen el mismo peso sin importar si son de hace 1 hora o 1 mes
  - **Fix:** Agregar `created_at` timestamp y factor de decaimiento en `experience_query()`

### B. DCC ↔ Skills Integration (DESCONECTADOS)

- [x] **B1. DCC smells no sugieren patrones del skill correspondiente** ✅
  - DCC detecta `long_method` → no sugiere refactoring pattern de `py-patterns/design-patterns.md`
  - Son dos sistemas paralelos que no se hablan
  - **Fix:** Mapeo smell_type → skill_section que inyecte la sección relevante junto al smell

- [x] **B2. No hay detección de lenguaje en DCC** ✅
  - DCC analiza archivos pero no sabe qué lenguaje domina el proyecto
  - Los skills se resuelven por `_TECH_SKILL_MAP` en deployment.py, pero DCC no tiene acceso
  - **Fix:** DCC debe exponer un tool `cube_get_languages()` o el workflow-manager debe pasar el lenguaje

- [x] **B3. Skills no ajustan profundidad según complejidad** ✅
  - Si detectas Python, cargas TODO `py-patterns` (5 archivos, ~500 líneas)
  - No importa si el task es "fix typo" o "rewrite auth system"
  - **Fix:** Inyección selectiva: solo la sección relevante del skill según el tipo de tarea

### C. Skills System

- [x] **C1. Profundidad desbalanceada entre lenguajes** ✅
  - Go: 91 líneas design patterns | PHP: 518 líneas | Python: 189 líneas
  - **Fix:** Nivelar todos a mínimo 150-200 líneas con patrones realmente útiles

- [x] **C2. No hay referencias cruzadas entre skills** ✅
  - `ts-patterns` no linkea a `dev-patterns` para patrones cross-language
  - Cada skill es una isla
  - **Fix:** Agregar sección "See also" con links a skills relacionados

- [x] **C3. Lenguajes ausentes** ✅
  - Kotlin, C#/.NET, Elixir, Scala, Ruby no tienen skills dedicados
  - **Prioridad:** C# (Unity/Blazor), Kotlin (Android/server-side)
  - **Fix:** Crear skills para los lenguajes más demandados

- [x] **C4. Sin feedback loop de utilidad** ✅
  - No se registra qué sección de qué skill fue útil o ignorada
  - No hay forma de optimizar los skills basado en uso real
  - **Fix:** Integrar con experience memory — registrar cuándo un agente referencia un skill

### D. Workflow Integration

- [x] **D1. DCC analysis corre DESPUÉS de la transición** ✅
  - En `graph_traverse()`, el estado se actualiza primero y DCC analiza después
  - Si DCC encuentra algo crítico, ya es tarde — el nodo ya cambió
  - **Archivo:** `graph_core.py` líneas 244-254 (post-transition)
  - **Fix:** Mover DCC pre-analysis antes de commit de transición (configurable)

- [x] **D2. No hay DCC analysis al activar un workflow** ✅
  - `graph_activate()` no corre DCC — el primer nodo se entra sin contexto de calidad
  - **Fix:** Correr DCC analysis en `graph_activate()` para dar baseline

- [x] **D3. Config resolution tiene fallback silencioso** ✅
  - Si `config.json` no existe, asume defaults sin notificar
  - El usuario no sabe si DCC está activo o no
  - **Fix:** Incluir `dcc_status` en la respuesta de `graph_status()`

---

## Propuesta de Niveles de Evolución

### Nivel 1: Quick Wins (sin cambiar arquitectura) — ~2-3 horas
Cambios internos al workflow-manager que mejoran la calidad de inyección:

| ID | Cambio | Impacto |
|----|--------|---------|
| A1 | Experience memory read en traversal | Alto — contexto histórico |
| A2 | Persistir tension gate state | Medio — resiliencia |
| A4 | Impact preview con SHA de entrada | Medio — precisión |
| A5 | Reindex incremental (solo archivos cambiados) | Alto — performance |
| A6 | Temporal decay en experience query | Bajo — calidad de contexto |
| D2 | DCC analysis en graph_activate | Medio — baseline |
| D3 | DCC status en graph_status response | Bajo — observabilidad |

### Nivel 2: DCC ↔ Skills Bridge (~2-3 horas)
Conectar los dos sistemas paralelos:

| ID | Cambio | Impacto |
|----|--------|---------|
| B1 | Smell → skill pattern mapping | Alto — sugerencias contextuales |
| B2 | Language detection en DCC | Medio — habilita B1 |
| B3 | Inyección selectiva de skills | Medio — reduce ruido |
| C2 | Cross-references entre skills | Bajo — navegabilidad |

### Nivel 3: Inyección Mid-Phase (~3-4 horas)
Cambio arquitectural que acerca DCC a comportamiento Cursor-like:

| ID | Cambio | Impacto |
|----|--------|---------|
| A3 | Hook enforcer → DCC incremental reindex + mini-inyección | Muy alto — feedback continuo |
| D1 | Pre-analysis antes de commit de transición | Medio — prevención |

### Nivel 4: Skills Expansion (~2-3 horas)
Ampliar cobertura:

| ID | Cambio | Impacto |
|----|--------|---------|
| C1 | Nivelar profundidad de skills existentes | Medio |
| C3 | Crear skills C#, Kotlin | Medio |
| C4 | Feedback loop skill → experience memory | Bajo |

---

## Métricas de Éxito

| Métrica | Actual | Target post-Nivel 1 | Target post-Nivel 3 |
|---------|--------|---------------------|---------------------|
| Frecuencia de feedback DCC | 1x por traversal | 1x por traversal + baseline | Continuo (cada edit) |
| Experience memory utilization | Write-only | Read + Write | Read + Write + Decay |
| Skills relevance | Dump completo | Dump completo | Sección específica |
| DCC ↔ Skills connection | Ninguna | Smell → pattern | Smell → pattern + language |
| Impact preview precision | git diff HEAD~3 | git diff <entry_sha>..HEAD | Per-file incremental |
| Tension gate resilience | Volatile (in-memory) | Persistido | Persistido + weighted |

---

## Archivos Clave

| Archivo | Qué cambiar |
|---------|------------|
| `.workflow-manager/src/workflow_manager/dcc_integration.py` | A1-A6, B1-B2, D1-D2 |
| `.workflow-manager/src/workflow_manager/tools/graph_core.py` | A1, D1, D2, D3 |
| `.workflow-manager/src/workflow_manager/tools/deployment.py` | B2, B3 |
| `.workflow-manager/src/workflow_manager/hub_config.py` | D3 |
| `.deltacodecube/src/deltacodecube/tools/core.py` | A5 (reindex incremental) |
| `.claude/skills/*/SKILL.md` | C1, C2 |
| `.claude/skills/csharp-patterns/` | C3 (nuevo) |
| `.claude/skills/kotlin-patterns/` | C3 (nuevo) |
| `.workflow-manager/src/workflow_manager/tools/experience.py` | A6, C4 |
