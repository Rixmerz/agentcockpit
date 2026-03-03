---
name: mermaid-viz
description: Mermaid diagram patterns for workflow and graph visualization in agentcockpit
---

# Mermaid Visualization

## Overview

agentcockpit uses Mermaid 11.x for rendering workflow graphs and workflow diagrams. The `MermaidRenderer` component takes graph definitions and renders interactive SVG diagrams.

## Configuration

- mermaid 11.12.2
- Rendered in `src/components/workflow/MermaidRenderer.tsx`
- Dark theme to match agentcockpit's glassmorphism UI

## Common Patterns

### Rendering a Mermaid Diagram
```typescript
import { MermaidRenderer } from '../components/workflow/MermaidRenderer';

<MermaidRenderer
  definition={`
    graph TD
      A[Start] --> B{Decision}
      B -->|Yes| C[Action]
      B -->|No| D[Skip]
  `}
  onNodeClick={(nodeId) => console.log('Clicked:', nodeId)}
/>
```

### Workflow Graph Format
Workflow graphs from the workflow-manager MCP use this structure:
```yaml
nodes:
  - id: analyze
    label: Analyze Code
    type: action
  - id: review
    label: Review Changes
    type: checkpoint
edges:
  - from: analyze
    to: review
```

Converted to Mermaid syntax for rendering.

### Styling for Dark Theme
```javascript
mermaid.initialize({
  theme: 'dark',
  themeVariables: {
    primaryColor: 'var(--accent)',
    primaryTextColor: 'var(--text-primary)',
    lineColor: 'var(--border)',
    // Match agentcockpit theme
  }
});
```

## Best Practices

1. **Use dark theme** — matches app aesthetic
2. **Handle click events** on nodes for interactivity
3. **Keep diagrams simple** — avoid overly complex graphs that become unreadable
4. **Re-render on definition change** — mermaid needs explicit re-initialization
5. **Sanitize graph definitions** from external sources before rendering
