---
name: workflow
description: Gestiona el workflow de flujo controlado. Usa para ver estado, avanzar, resetear o ir a un step específico del workflow.
user-invocable: true
---

# Workflow Management

Gestiona el workflow de flujo controlado para este proyecto.

## Subcomandos

Parsea `$ARGUMENTS` para determinar la acción:

- **vacío o "status"** → Mostrar estado actual
- **"advance"** → Avanzar al siguiente step
- **"reset"** → Resetear a step 0
- **"set N"** → Ir directamente al step N

## Ejecución

El `project_dir` para este proyecto es: `/home/rixmerz/agentcockpit`

### Para status (default):
Llama a `mcp__workflow-manager__workflow_status` con `project_dir="/home/rixmerz/agentcockpit"`.

Muestra el resultado en formato tabla:
```
Workflow: Step {current_step} - {step_name}

| # | Nombre | Estado | Bloqueados |
|---|--------|--------|------------|
```

### Para advance:
Llama a `mcp__workflow-manager__workflow_advance` con `project_dir="/home/rixmerz/agentcockpit"`.
Confirma: "Avanzado a Step N - {nombre}"

### Para reset:
Llama a `mcp__workflow-manager__workflow_reset` con `project_dir="/home/rixmerz/agentcockpit"`.
Confirma: "Workflow reseteado a Step 0"

### Para set N:
Llama a `mcp__workflow-manager__workflow_set_step` con `project_dir="/home/rixmerz/agentcockpit"` y `step_index=N`.
Confirma: "Workflow en Step N - {nombre}"

## Notas

- Write/Edit están bloqueados en steps 0 y 1
- Usa `/workflow advance` o `/workflow set 2` para desbloquear
