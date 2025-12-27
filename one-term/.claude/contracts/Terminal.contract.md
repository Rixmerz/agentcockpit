# Terminal Component Contract

**Location:** `src/components/Terminal.tsx`

**Purpose:** React component that renders xterm terminal emulator with header controls. Main UI entry point.

## Interface

### Export
```typescript
export function Terminal(): JSX.Element
export default Terminal
```

## Dependencies
- `react` - UI framework
- `@xterm/xterm` - Terminal emulator library
- `useTerminal` hook - Terminal initialization and lifecycle
- `Terminal.module.css` - Component styling

## Props
- None (root component)

## State Management
- Uses `useTerminal` hook to manage terminal instance
- Terminal state is internal to hook

## Responsibilities
1. Render terminal container with header
2. Handle window resize for terminal fitting
3. Display terminal controls (minimize, maximize, close)
4. Initialize xterm with proper configuration

## External Communications
- None (local terminal only for now)

## Breaking Changes
- Removing export would break App.jsx import
- Changing props would require App.jsx update
- Changing terminal configuration affects user experience
