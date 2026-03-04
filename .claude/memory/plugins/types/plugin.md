# Memoria de Edición: plugins/types/plugin.ts

## Estado actual
Este archivo es un **barrel** que re-exporta sub-módulos de tipos.
NO agregar interfaces directamente aquí.

## Estructura de sub-módulos
```
plugins/types/
  manifest.ts       ← AgentPluginManifest, QuickActionConfig, ModelConfig
  mcp.ts            ← McpServerInfo, McpServerConfig
  session.ts        ← SessionInfo
  command.ts        ← BuildCommandOptions
  component-props.ts ← LauncherProps, McpPanelProps, QuickActionsProps, CustomPanelProps
                       (importa de ./session y ./mcp)
  plugin-contract.ts ← AgentPlugin interface runtime
                       (importa de ./manifest, ./component-props, ./command)
  registry.ts       ← PluginRegistration, PluginDiscoveryResult
                       (importa de ./plugin-contract, ./manifest)
  plugin.ts (barrel) ← export * de todos los anteriores
  index.ts (barrel)  ← idéntico a plugin.ts, path alternativo
```

## Orden de dependencias (sin circular)
```
manifest, mcp, session, command     (sin deps internas)
    ↓
component-props (depende: session, mcp)
    ↓
plugin-contract (depende: manifest, component-props, command)
    ↓
registry (depende: plugin-contract, manifest)
    ↓
plugin.ts barrel
```

## Los 19 importadores usan path fijo
`import { X } from '../../plugins/types/plugin'`
NO cambiar ese path — el barrel lo resuelve.
