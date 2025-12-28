# Decision: Nombre Comercial - AgentCockpit

**Date:** 2025-12-28
**Status:** Accepted (supersedes TermCockpit)

## Context

El proyecto necesitaba un nombre comercial para distribución pública. Inicialmente se eligió "TermCockpit" pero se reconsideró dado que la visión del producto va más allá de solo Claude - el objetivo es soportar múltiples agentes AI.

## Decision

Usar **AgentCockpit** como nombre comercial con dominio **agentcockpit.dev**

## Rationale

1. **Visión multi-agente**: El producto no solo soportará Claude, sino potencialmente Cursor, Copilot, y otros agentes AI
2. **Foco correcto**: El terminal es el medio, los agentes AI son el producto
3. **Tendencia AI**: "Agent" es el paradigma actual en AI tooling
4. **Único**: No hay conflicto con productos existentes
5. **Escalable**: El nombre permite expandir funcionalidad sin rebranding

## Evolution from TermCockpit

| Aspecto | TermCockpit | AgentCockpit |
|---------|-------------|--------------|
| Foco | Terminal management | AI agent control |
| Alcance | Solo Claude CLI | Múltiples agentes |
| Futuro | Limitado | Escalable |

## Verification

| Platform | Status |
|----------|--------|
| GitHub | Available |
| npm | Available |
| Existing products | No conflicts |
| Domain .dev | Pending verification |

## Options Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| TermCockpit | Superseded | Too focused on terminal, limits vision |
| AgentCockpit | Selected | Captures multi-agent vision |
| DevCockpit | Backup | Generic, less specific |
| Cockpit.dev | Discarded | Conflicts with Cockpit Project |

## Consequences

### Positive
- Future-proof naming for multi-agent support
- Clear brand identity in AI agent space
- No trademark conflicts found

### Required Actions
- [ ] Register domain agentcockpit.dev
- [ ] Update package.json (name: "agentcockpit")
- [ ] Update tauri.conf.json (productName: "AgentCockpit")
- [ ] Design logo with cockpit/aviation theme
- [ ] Create icon for dock/taskbar
- [ ] Update README with new name

## Taglines

- "Your AI agent cockpit"
- "Take control of your AI agents"
- "The cockpit for AI-powered development"
