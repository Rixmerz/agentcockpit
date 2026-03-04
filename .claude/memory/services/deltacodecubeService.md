# Memoria de Edición: deltacodecubeService.ts

## Estado actual (2026-03)
Este archivo es un **barrel** — re-exporta todo desde `./dcc/`.
NO agregar lógica directamente aquí.

## Estructura del módulo
```
services/deltacodecubeService.ts  ← barrel re-export (no lógica)
services/dcc/
  _dccInternal.ts     ← dccState, callDccTool, timeout utils, path utils
  dccTypes.ts         ← todas las interfaces exportadas (~26 tipos)
  dccInstallService.ts ← isDeltaCodeCubeInstalled, install/uninstall
  dccServerService.ts  ← warmupDccServer, isDccServerRunningFor
  dccIndexService.ts   ← indexProject, reindexProject, isIndexing
  dccAnalysisService.ts ← 20 funciones de query read-only
  dccVisualizationService.ts ← generateArchitecture, generateMatrix, etc.
  dccClaudeMdService.ts ← generateClaudeMdSection
```

## Reglas críticas
1. `dccState` es un objeto mutable compartido — NUNCA importar sus campos como primitivos
   - ✅ `dccState.indexingInProgress`
   - ❌ `import { _indexingInProgress }` (snapshot estático, no reactivo)
2. `callDccTool` solo existe en `_dccInternal.ts` — no duplicar
3. `_dccInternal` NO se re-exporta desde el barrel
4. Los imports externos usan `'../../services/deltacodecubeService'` — no cambiar
5. `debug.ts` usa `import * as dccService` — el barrel debe exportar todo con `export *`

## Dependencias circulares a evitar
`_dccInternal` → mcpConfigService ✅ OK
`_dccInternal` → dccInstallService ❌ CIRCULAR (no hacer)
`dccInstallService` → _dccInternal ✅ OK (solo para dccState)
