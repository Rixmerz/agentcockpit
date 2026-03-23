<!-- AgentCockpit workflow manager — do not remove this line -->

# AgentCockpit — Guía de Desarrollo

## Stack
- **Frontend:** React 19 + TypeScript + Vite (rolldown-vite)
- **Backend nativo:** Rust + Tauri v2
- **Workflow manager:** Python (.workflow-manager/) — MCP server
- **Build:** Dentro de `distrobox agentcockpit-build` (host Fedora Atomic no tiene libs de desarrollo)

## Comandos esenciales

```bash
# Dev (host)
pnpm dev

# Build completo (SIEMPRE desde distrobox)
distrobox enter agentcockpit-build -- bash -c "cd /var/home/rixmerz/agentcockpit && pnpm tauri build 2>&1"

# Solo frontend
pnpm build

# Linting
pnpm lint
```

El binario queda en `src-tauri/target/release/agentcockpit`.
El AppImage falla siempre por falta de linuxdeploy — es esperado e irrelevante.

---

## Arquitectura frontend

### Capas (respetar siempre)
```
components/          ← Solo UI: estado local, handlers, JSX
services/            ← Lógica de negocio, I/O, Tauri invoke
core/utils/          ← Event buses, utils puros sin side effects
```

**Regla:** Los componentes nunca leen archivos ni invocan Tauri directamente. Todo va por un service.

### Servicios de workflow
```
services/workflow/
  index.ts                  ← Re-exports públicos (importar solo desde aquí)
  workflowGraphService.ts   ← Estado del grafo, activación, reset, enforcer
  workflowIOService.ts      ← Lectura/escritura de archivos .workflow-manager/
  workflowNodeService.ts    ← Lógica de nodos individuales
services/hookService.ts     ← Install/uninstall/sync de hooks en proyectos del usuario
services/workflowService.ts ← Facade de alto nivel para componentes
```

Importar servicios de workflow **siempre desde** `../../services/workflow/index` (no desde archivos internos directamente).

---

## Estado persistente del workflow

El workflow-manager escribe estado en el proyecto del usuario bajo `.workflow-manager/`:
```
.workflow-manager/
  state/
    <projectHash>/
      state.json          ← nodo actual, historial de traversal
      config.json         ← configuración del enforcer (enforcer_enabled, etc.)
```

`config.json` es la fuente de verdad para el toggle ON/OFF del enforcer.
El hook Python lo lee antes de aplicar enforcement:
```python
cfg = json.loads(config_path.read_text())
if not cfg.get("enforcer_enabled", True):
    print(json.dumps({"decision": "approve"}))
    return
```

La UI escribe `config.json` vía `syncWorkflowHooks(projectPath, enabled, [])` en `hookService.ts`.

---

## Patrones de desarrollo

### Agregar un toggle/acción en la UI

1. **Leer estado** en el `useEffect` existente del componente (no crear efectos extra).
2. **Handler** con `useCallback`, optimistic update + rollback en catch.
3. **Service** en la capa correcta — si escribe archivos, va en `workflowIOService.ts` o `hookService.ts`.
4. **UI** usando `DropdownItem` / `DropdownSection` existentes — no inventar componentes nuevos para esto.

### Agregar funcionalidad al enforcer Python

El enforcer está en `.workflow-manager/src/workflow_manager/`.
Cualquier nueva lectura de configuración debe:
- Usar `config.json` como fuente (no crear nuevos archivos de estado ad-hoc).
- Fallar silenciosamente (si el archivo no existe, asumir defaults).
- Ser idempotente.

### Modificar hookService.ts

`syncWorkflowHooks` es la función central que instala/actualiza los hooks en proyectos del usuario. Si cambia la estructura de `config.json`, actualizar también `getEnforcerEnabled` en `workflowGraphService.ts`.

---

## Reglas de consistencia

### NO hacer
- No crear archivos de estado ad-hoc (`.json`, `.txt`) fuera de las rutas establecidas.
- No duplicar lógica entre `workflowService.ts` (facade) y `workflowGraphService.ts` (real).
- No leer archivos directamente desde componentes — siempre a través de un service.
- No agregar `useEffect` extra para cargar datos que ya carga un efecto existente.
- No modificar el CLAUDE.md del proyecto del *usuario* (en `projectPath/CLAUDE.md`) desde el código de la app — ese archivo le pertenece al usuario.

### SÍ hacer
- Un service por dominio. Si crece mucho, dividir en sub-archivos dentro de `services/dominio/`.
- Optimistic updates en handlers de UI (actualizar estado → llamar servicio → rollback si error).
- Re-usar `DropdownItem`, `DropdownSection`, `DropdownPanel` para UI en el ControlBar.
- Documentar en este CLAUDE.md cuando se agrega una nueva fuente de estado persistente.

---

## Flujo completo de una feature típica

```
1. Definir dónde vive el estado: ¿config.json? ¿state.json? ¿solo en memoria?
2. Agregar lectura/escritura en el service correspondiente
3. Exponer en index.ts si es workflow service
4. Consumir en el componente con useState + useEffect/handler
5. Agregar UI (DropdownItem u otro componente existente)
6. Verificar en dev (pnpm dev) antes de hacer build completo
7. Build completo solo cuando la feature está lista
```

---

## Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `src/components/control-bar/ControlBar.tsx` | Barra superior con dropdowns |
| `src/components/workflow/WorkflowPanel.tsx` | Panel lateral del workflow |
| `src/services/workflow/workflowGraphService.ts` | Lógica central del grafo |
| `src/services/hookService.ts` | Hooks en proyectos del usuario |
| `.workflow-manager/src/workflow_manager/` | Enforcer Python (MCP server) |
| `src-tauri/src/` | Backend Rust |
