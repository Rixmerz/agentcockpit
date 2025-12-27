# useTerminal Hook Contract

**Location:** `src/hooks/useTerminal.ts`

**Purpose:** React hook that initializes and manages xterm Terminal instance lifecycle. Handles terminal creation, addon setup, resizing, and cleanup.

## Interface

```typescript
function useTerminal(containerRef: React.RefObject<HTMLDivElement>): {
  terminal: Terminal | null,
  fitAddon: FitAddon | null
}
```

## Parameters
- `containerRef` - React ref to the DOM container where terminal will be rendered

## Returns
- `terminal` - xterm Terminal instance (null until mounted)
- `fitAddon` - FitAddon instance for terminal resizing

## Dependencies
- `@xterm/xterm` - Terminal emulator
- `@xterm/addon-fit` - Auto-fit addon
- `@xterm/addon-web-links` - Web links addon

## Lifecycle
1. **Mount:** Initialize terminal, create addons, open in container
2. **Window Resize:** Call `fitAddon.fit()` to resize terminal
3. **Unmount:** Cleanup event listeners, dispose terminal

## Configuration
- Default cols: 80
- Default rows: 24
- Theme: Dark VSCode-like theme
- Background: #1e1e1e
- Foreground: #d4d4d4

## Breaking Changes
- Changing containerRef behavior would break Terminal component
- Changing return type would break Terminal component usage
- Terminal configuration changes affect user experience
