---
name: css-theming
description: CSS Custom Properties theming system and glassmorphism styling for agentcockpit
---

# CSS Theming

## Overview

agentcockpit uses pure CSS Custom Properties for theming — no Tailwind, no CSS-in-JS. The visual style is dark-mode glassmorphism with two switchable themes.

## Theme System

### Themes Available
- `cyber-teal` — Teal/cyan accent, default dark theme
- `battlefield` — Military green/amber accent

### Theme Files
```
src/styles/themes/
├── cyber-teal.css    # --accent: #2dd4bf (teal)
├── battlefield.css   # --accent: #84cc16 (green)
src/App.css           # Base styles + component styles
src/index.css         # CSS reset, font imports, root variables
```

### How Themes Work
Theme class applied on root element. Each theme file overrides CSS custom properties:

```css
/* cyber-teal.css */
:root, .theme-cyber-teal {
  --accent: #2dd4bf;
  --accent-dim: #0d9488;
  --bg-primary: #0a0a0f;
  --bg-surface: rgba(15, 15, 25, 0.85);
  /* ... */
}
```

## Design Tokens

### Colors
```css
--bg-primary       /* Main background (#0a0a0f) */
--bg-surface       /* Panel backgrounds with transparency */
--bg-input         /* Input field backgrounds */
--text-primary     /* Main text color */
--text-muted       /* Secondary text */
--accent           /* Brand color (varies by theme) */
--accent-dim       /* Muted accent */
--success          /* Green */
--error            /* Red */
--warning          /* Yellow */
--border           /* Border color with transparency */
```

### Glassmorphism Pattern
```css
.panel {
  background: var(--bg-surface);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: 8px;
}
```

### Typography
- Display: `'Space Grotesk', sans-serif`
- Body: `'Plus Jakarta Sans', sans-serif`
- Mono: `'JetBrainsMono Nerd Font', 'Fira Code', monospace`

## Common Patterns

### Component Styling
```css
/* Use CSS custom properties, not hardcoded colors */
.my-component {
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

/* Hover states */
.my-component:hover {
  background: var(--bg-hover);
  border-color: var(--accent-dim);
}
```

### Layout
- Three-panel layout: sidebar-left (250px) + main content (flex) + sidebar-right (300px)
- Panels use `flex` and `overflow: auto`
- Terminal takes remaining height in main content

## Best Practices

1. **Always use CSS variables** — never hardcode colors
2. **Maintain transparency** — use `rgba()` for glassmorphism effect
3. **Use `clsx`** for conditional classes, not string concatenation
4. **No inline styles** for colors — only for dynamic values (opacity, dimensions)
5. **Test both themes** when changing styles
