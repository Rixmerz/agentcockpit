# Memoria de Edición: _dccInternal.ts

## Propósito
Infraestructura compartida interna del módulo DCC. NO es parte de la API pública.

## Contenido
- `dccState` — objeto mutable singleton con todo el estado del módulo
- `callDccTool(toolName, args, projectPath)` — dispatcher MCP central
- `ensureDccServer(projectPath)` — lifecycle del server DCC
- `getDccPath()`, `getProjectDataDir(projectPath)` — paths
- `withDccTimeout<T>(promise, ms)` — helper de timeout
- `pathMatchesProject(filePath, prefix)` — filtro de rutas
- `filterFilesByProject(files, projectPath)` — filtro de arrays
- `scoreToGrade(score)` — convierte score numérico a letra

## El objeto dccState
```ts
export const dccState = {
  installedCache: undefined as boolean | undefined,
  installedPromise: null as Promise<boolean> | null,
  dccPathCache: undefined as string | null | undefined,
  dccPathPromise: null as Promise<string | null> | null,
  serverStartedForProject: null as string | null,
  serverStartPromise: null as Promise<void> | null,
  serverStartFailedAt: null as number | null,
  indexingInProgress: false,
  homeDirCache: null as string | null,
};
```

## Regla: NO importar desde otros módulos dcc/
Este archivo no debe importar de `dccInstallService`, `dccAnalysisService`, etc.
Solo puede importar: Tauri APIs, mcpConfigService, indexEvents.
