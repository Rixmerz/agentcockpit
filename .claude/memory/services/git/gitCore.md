# Memoria de Edición: gitCore.ts

## Propósito
Módulo de infraestructura compartida para git. NO es parte de la API pública.
El barrel `gitService.ts` NO re-exporta este módulo.

## Contenido
- `execGit(projectPath, args)` — ejecuta comandos git, lanza error si falla
- `execGitSafe(projectPath, args)` — idem pero retorna null en error
- `INVOKE_TIMEOUT_MS` — timeout para comandos Tauri
- `USE_BACKGROUND_PTY` — flag de configuración

## Importado por (8 dependientes)
- gitRepoService.ts, gitStatusService.ts, gitRemoteService.ts
- gitStagingService.ts, gitTagService.ts, gitHistoryService.ts, gitPushService.ts

## DCC detecta gitCore.ts como god_file (8 deps, complexity 1.0)
Esto es ESPERADO — gitCore es intencionalmente un hub de infraestructura.
No se debe fragmentar más; es inherente al patrón de módulo compartido.

## Regla: no exportar desde gitService.ts
```ts
// gitService.ts barrel - NO incluir gitCore
export * from './git/gitRepoService';
export * from './git/gitStatusService';
// ... pero NO: export * from './git/gitCore'
```
