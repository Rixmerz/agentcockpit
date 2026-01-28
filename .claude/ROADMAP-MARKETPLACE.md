# Roadmap: Marketplace de Integraciones

## Visión General

Crear un sistema de **Marketplace** dentro de AgentCockpit que permita:
- Instalar integraciones de terceros (como Agentful)
- Cada integración se expone como un **nodo wrapper** en los pipelines
- Dentro del nodo, la integración tiene control total (sus agentes, hooks, skills)
- AgentCockpit solo orquesta cuándo entra/sale del nodo

---

## Arquitectura Conceptual

```
┌─────────────────────────────────────────────────────────┐
│                    AGENTCOCKPIT                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Pipeline Graph                      │    │
│  │  [Node 1] → [Node 2] → [Integration Node] → ... │    │
│  │                              ↓                   │    │
│  │                    ┌─────────────────┐          │    │
│  │                    │   WRAPPER       │          │    │
│  │                    │  ┌───────────┐  │          │    │
│  │                    │  │ AGENTFUL  │  │          │    │
│  │                    │  │ (control  │  │          │    │
│  │                    │  │  total)   │  │          │    │
│  │                    │  └───────────┘  │          │    │
│  │                    └─────────────────┘          │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## Fase 1: Fundamentos del Marketplace

### 1.1 Estructura de Datos

**Hub Config** (`~/.agentcockpit/config.json`):
```json
{
  "hub_dir": "~/.agentcockpit",
  "integrations_dir": "~/.agentcockpit/integrations",
  "marketplace": {
    "installed": [],
    "registry_url": null
  }
}
```

**Integración Instalada** (`~/.agentcockpit/integrations/agentful/manifest.json`):
```json
{
  "id": "agentful",
  "name": "Agentful",
  "version": "1.0.0",
  "description": "Parallel agent orchestration with protective hooks",
  "author": "itz4blitz",
  "source": {
    "type": "npm",
    "package": "@itz4blitz/agentful",
    "init_command": "npx @itz4blitz/agentful init"
  },
  "provides": {
    "node_type": "integration-wrapper",
    "agents": ["orchestrator", "backend", "frontend", "tester", "reviewer", "fixer", "architect", "product-analyzer"],
    "skills": ["agentful-start", "agentful-status", "agentful-generate", "agentful-decide", "agentful-validate"],
    "hooks": ["PreToolUse", "PostToolUse", "UserPromptSubmit"]
  },
  "entry_skill": "/agentful-start",
  "exit_condition": "AGENTFUL_COMPLETE",
  "status": "installed",
  "installed_at": "2026-01-28T..."
}
```

### 1.2 UI del Marketplace

**Nueva sección en AgentCockpit:**
- Tab/Panel "Marketplace" en la interfaz principal
- Lista de integraciones disponibles (hardcoded inicialmente)
- Estados: Available | Installed | Disabled
- Botones: Install | Enable | Disable | Uninstall

**Componentes:**
```
src/components/marketplace/
├── MarketplacePanel.tsx      # Panel principal
├── IntegrationCard.tsx       # Card de cada integración
├── InstallModal.tsx          # Modal de instalación
└── IntegrationSettings.tsx   # Configuración por integración
```

### 1.3 Servicios

```
src/services/
├── marketplaceService.ts     # CRUD de integraciones
│   ├── listAvailable()       # Hardcoded registry inicial
│   ├── listInstalled()       # Lee de config
│   ├── install(id)           # Ejecuta init_command
│   ├── uninstall(id)         # Limpia archivos
│   ├── enable(id, projectPath)
│   └── disable(id, projectPath)
```

---

## Fase 2: Nodo Wrapper de Integración

### 2.1 Nuevo Tipo de Nodo en Pipeline Graph

**En graph.yaml:**
```yaml
nodes:
  - id: "parallel-development"
    type: "integration"           # Nuevo tipo
    integration: "agentful"       # ID de la integración
    name: "Parallel Development"
    prompt_injection: |
      MODO: Desarrollo paralelo con Agentful
      Este nodo delega el control completo a Agentful.
      Ejecuta: /agentful-start con la tarea actual.
      El nodo termina cuando Agentful emite AGENTFUL_COMPLETE.

    # Configuración del wrapper
    wrapper_config:
      entry_skill: "/agentful-start"
      entry_context: "{{current_task}}"
      exit_signal: "AGENTFUL_COMPLETE"
      timeout_minutes: 60
      fallback_edge: "manual-override"
```

### 2.2 Lógica del Wrapper

**Flujo de ejecución:**
```
1. Pipeline llega al nodo "integration"
2. AgentCockpit:
   - Verifica que integración esté instalada y habilitada
   - Inyecta prompt con instrucción de ejecutar entry_skill
   - Pasa contexto (current_task, variables del pipeline)
3. Control pasa a la integración (Agentful)
   - Sus hooks toman control (PreToolUse, PostToolUse)
   - Sus agentes ejecutan el trabajo
   - Claude Code recibe instrucciones de Agentful
4. Detección de salida:
   - AgentCockpit monitorea output buscando exit_signal
   - Cuando detecta "AGENTFUL_COMPLETE" → transición al siguiente nodo
5. Timeout/Fallback:
   - Si pasa timeout_minutes → ofrece edge de fallback
```

### 2.3 Aislamiento

**Durante el nodo de integración:**
- Los hooks de AgentCockpit se PAUSAN
- Los hooks de la integración toman control
- El state de AgentCockpit se preserva pero no se modifica
- La integración usa su propio state (`.agentful/`)

**Al salir del nodo:**
- Se restauran hooks de AgentCockpit
- Se sincroniza información relevante (si aplica)

---

## Fase 3: Instalación de Agentful (Primera Integración)

### 3.1 Proceso de Instalación

```
Usuario: Click "Install" en Agentful
    ↓
1. Crear directorio: ~/.agentcockpit/integrations/agentful/
2. Guardar manifest.json con metadata
3. Marcar como "installed" en config.json
4. UI muestra "Installed - Ready to use"
```

### 3.2 Activación en Proyecto

```
Usuario: Click "Enable for Project"
    ↓
1. Ejecutar en proyecto: npx @itz4blitz/agentful init
2. Esto crea:
   - .claude/agents/*.md (8 agentes de Agentful)
   - .claude/skills/agentful-*/ (5 skills)
   - .agentful/ (state folder)
   - hooks en settings.json
3. Marcar proyecto como "agentful-enabled"
4. Disponible nodo "integration:agentful" en pipelines
```

### 3.3 Desactivación

```
Usuario: Click "Disable"
    ↓
1. Remover hooks de Agentful de settings.json
2. Opcional: limpiar .agentful/ y agents/skills
3. Nodo de integración ya no disponible
```

---

## Fase 4: Pipeline de Ejemplo con Integración

### 4.1 Pipeline Híbrido: Secuencial + Paralelo

```yaml
metadata:
  name: "hybrid-denofresh-agentful"
  version: "1.0.0"
  description: "Análisis secuencial + desarrollo paralelo"
  integrations_required:
    - agentful

nodes:
  # Fase 1: Análisis (secuencial, nuestro control)
  - id: "url-capture"
    model: haiku
    prompt_injection: |
      TAREA: Capturar URL y requisitos del usuario.
      **OBLIGATORIO: Delega al subagente url-capture**

  - id: "web-analysis"
    model: sonnet
    prompt_injection: |
      TAREA: Analizar página web con Lighthouse.
      **OBLIGATORIO: Delega al subagente web-analyzer**

  - id: "planning"
    model: opus
    prompt_injection: |
      TAREA: Crear plan de implementación.
      **OBLIGATORIO: Delega al subagente orchestrator**

  # Fase 2: Desarrollo (paralelo, control de Agentful)
  - id: "parallel-development"
    type: "integration"
    integration: "agentful"
    name: "Desarrollo Paralelo"
    prompt_injection: |
      MODO: Ejecución paralela con Agentful.

      Ejecuta /agentful-start con el siguiente contexto:
      - Plan: {{planning.output}}
      - Stack: Deno Fresh 2.2
      - Objetivo: Construir las secciones planificadas

      Agentful coordinará Backend + Frontend + Tests en paralelo.
      Este nodo termina cuando emita AGENTFUL_COMPLETE.

    wrapper_config:
      entry_skill: "/agentful-start"
      exit_signal: "AGENTFUL_COMPLETE"
      timeout_minutes: 45

  # Fase 3: Review (secuencial, nuestro control)
  - id: "ui-review"
    model: sonnet
    prompt_injection: |
      TAREA: Revisar resultado del desarrollo paralelo.
      **OBLIGATORIO: Delega al subagente ui-perfectionist**

  - id: "final-validation"
    model: haiku
    prompt_injection: |
      TAREA: Validación final y deployment.

edges:
  - from: "url-capture"
    to: "web-analysis"
    condition: { type: "auto" }

  - from: "web-analysis"
    to: "planning"
    condition: { type: "auto" }

  - from: "planning"
    to: "parallel-development"
    condition: { type: "auto" }

  - from: "parallel-development"
    to: "ui-review"
    condition: { type: "signal", value: "AGENTFUL_COMPLETE" }

  - from: "parallel-development"
    to: "planning"
    id: "retry-planning"
    condition: { type: "phrase", value: "needs replanning" }

  - from: "ui-review"
    to: "final-validation"
    condition: { type: "auto" }
```

---

## Fase 5: Escalabilidad del Marketplace

### 5.1 Registry Remoto (Futuro)

```json
{
  "marketplace": {
    "registry_url": "https://agentcockpit.dev/api/integrations",
    "cache_ttl": 86400
  }
}
```

**Endpoint:**
```
GET /api/integrations
→ Lista de integraciones disponibles con manifests

GET /api/integrations/{id}
→ Detalle de integración específica

POST /api/integrations/{id}/download
→ Descarga assets de la integración
```

### 5.2 Integraciones Potenciales Futuras

| Integración | Descripción | Tipo de Nodo |
|-------------|-------------|--------------|
| **Agentful** | Orquestación paralela | integration-wrapper |
| **Claude Coder** | Pair programming interactivo | integration-wrapper |
| **Devin-like** | Agente autónomo completo | integration-wrapper |
| **Test Runner** | CI/CD integrado | integration-wrapper |
| **Doc Generator** | Documentación automática | integration-wrapper |

### 5.3 Contribución de Integraciones

**Estructura para contribuir:**
```
integration-template/
├── manifest.json           # Metadata obligatoria
├── README.md               # Documentación
├── install.sh              # Script de instalación (opcional)
└── assets/
    ├── agents/             # Agentes que provee
    ├── skills/             # Skills que provee
    └── hooks/              # Hooks que requiere
```

---

## Resumen de Entregables por Fase

| Fase | Entregables | Prioridad |
|------|-------------|-----------|
| **1** | Config structure, UI básica, marketplaceService | Alta |
| **2** | Nodo type="integration", wrapper logic | Alta |
| **3** | Agentful como primera integración funcional | Alta |
| **4** | Pipeline de ejemplo híbrido | Media |
| **5** | Registry remoto, más integraciones | Baja (futuro) |

---

## Próximos Pasos Inmediatos

1. [ ] Definir estructura de `~/.agentcockpit/integrations/`
2. [ ] Crear `marketplaceService.ts` con CRUD básico
3. [ ] Crear `MarketplacePanel.tsx` con UI mínima
4. [ ] Hardcodear Agentful como primera integración disponible
5. [ ] Implementar `install()` que ejecute `npx @itz4blitz/agentful init`
6. [ ] Crear tipo de nodo `integration` en pipeline graph
7. [ ] Probar flujo completo: install → enable → use in pipeline → disable

---

*Roadmap creado: 2026-01-28*
*Versión: 1.0.0*
*Estado: Planificación inicial*
