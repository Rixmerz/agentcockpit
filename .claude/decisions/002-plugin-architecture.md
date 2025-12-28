# ADR 002: Plugin Architecture for Agent Integration

## Status
Accepted

## Date
2025-12-28

## Context

AgentCockpit necesitaba soportar multiples agentes AI (Claude, Gemini, Cursor Agent, etc.) sin hardcodear cada uno. La sidebar-right tenia codigo especifico de Claude que hacia dificil agregar nuevos agentes.

Problemas identificados:
- 12 archivos con strings "claude" hardcodeados
- 8 comandos CLI hardcodeados
- 5 rutas de configuracion hardcodeadas
- Quick actions no configurables
- Sin forma de agregar agentes sin modificar codigo existente

## Decision

Implementar arquitectura de plugins donde cada agente es un plugin auto-contenido con:

1. **manifest.json** - Metadata declarativa (id, name, icon, color, CLI config)
2. **Components** - React components (Launcher, QuickActions, McpPanel)
3. **Services** - Logica de negocio (buildCommand, etc.)

### Estructura de Directorios

```
src/
├── core/utils/terminalCommands.ts    # Utilities reutilizables
├── plugins/
│   ├── types/plugin.ts               # Interfaces TypeScript
│   ├── registry/PluginRegistry.ts    # Singleton de registro
│   └── context/PluginContext.tsx     # React context + hooks
└── agents/
    └── claude/                       # Primer plugin
        ├── manifest.json
        ├── index.ts
        ├── components/
        └── services/
```

### Flujo de Datos

```
App.tsx → PluginProvider → PluginRegistry.register()
                              ↓
                       validateInstallation()
                              ↓
ActionsPanel → usePlugins() → AgentTabs → activePlugin.Launcher
```

## Options Considered

1. **Switch/case hardcodeado** - Rechazado: no escalable
2. **Solo configuracion (sin componentes)** - Rechazado: limita customizacion
3. **Plugin system completo** - Aceptado: balance entre flexibilidad y estructura
4. **Carga externa de plugins** - Futuro: para marketplace

## Consequences

### Positivas
- Cada agente es aislado y mantenible
- Type-safe via interfaces TypeScript
- Utilities compartidas reducen duplicacion
- Agregar agente = crear directorio sin tocar codigo existente
- Preparado para plugins externos en futuro

### Negativas
- Overhead inicial de abstracciones
- Plugins deben seguir interfaz estricta
- Testing requiere mocks de PluginContext

## Implementation

- `src/plugins/types/plugin.ts` - 360+ lineas de interfaces
- `src/core/utils/terminalCommands.ts` - 8 funciones reutilizables
- `src/agents/claude/` - Implementacion de referencia
- `docs/PLUGINS.md` - Guia de desarrollo de plugins

## References

- Plan original: `.claude/plans/wondrous-juggling-mist.md`
- Documentacion: `docs/PLUGINS.md`
