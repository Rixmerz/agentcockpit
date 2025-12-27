# Architectural Decisions

## 1. xterm Integration for Terminal UI

**Status:** Decided

**Context:**
Frontend needs to display a terminal emulator. Multiple terminal libraries exist. Need rich UX with resizing, link detection, and reliable rendering.

**Decision:**
Use `@xterm/xterm` with addons (`@xterm/addon-fit`, `@xterm/addon-web-links`)

**Rationale:**
- Most mature and widely-used JavaScript terminal emulator
- Excellent addon ecosystem for fit-to-container resizing
- Clickable link detection built-in
- Good browser compatibility and active maintenance

**Alternatives Considered:**
- hterm (Google Chrome OS terminal) - less features
- PapermillVM (lightweight) - less polished
- RxTerminal (minimal) - limited addons
- Custom WebSocket + canvas - too complex

**Consequences:**
- Adds ~500KB to bundle
- Requires CSS import in components
- Terminal rendering handled by xterm, React manages lifecycle
- Good trade-off between UX and complexity

**Date:** 2025-12-27

---

## 2. Frontend/Backend Separation with Tauri IPC

**Status:** Decided

**Context:**
Desktop application needs Rust backend for shell execution and system integration. Frontend is React-based. Need reliable communication bridge.

**Decision:**
Use Tauri's command system (IPC) with typed service layer (`src/services/tauriService.ts`)

**Rationale:**
- Tauri already configured and set up
- Command pattern gives clear frontend/backend boundary
- Service layer allows mocking for frontend testing
- Type-safe with TypeScript generics

**Architecture:**
```
React Component
    ↓
tauriService (typed IPC calls)
    ↓
Tauri Commands (shell.rs, greet.rs)
    ↓
Rust Backend (services, models)
```

**Consequences:**
- All frontend→backend calls go through tauriService
- Changes to command signatures require frontend+backend sync
- IPC overhead for each call (negligible for terminal)

**Date:** 2025-12-27

---

## 3. Modular Rust Structure (commands/services/models)

**Status:** Decided

**Context:**
Rust backend needs clear organization as it grows. Terminal commands, shell execution, and data models need separation.

**Decision:**
Organize backend as:
- `commands/` - Tauri IPC handlers
- `services/` - Business logic (future)
- `models/` - Shared types

**Rationale:**
- Clear separation of concerns
- Commands stay thin (just IPC mapping)
- Business logic isolated in services
- Models are serializable for IPC

**Structure:**
```
src-tauri/src/
├── main.rs (entry point)
├── lib.rs (app setup)
├── commands/
│   ├── mod.rs
│   ├── greet.rs
│   └── shell.rs
├── services/
│   └── mod.rs (future: terminal management)
└── models/
    └── mod.rs (TerminalSession, CommandResult)
```

**Consequences:**
- Easy to add new commands
- Services layer ready for complex logic
- Models are version-controlled boundary

**Date:** 2025-12-27

---

## 4. React Hook for Terminal Lifecycle

**Status:** Decided

**Context:**
Terminal component needs to initialize xterm, handle resizing, and cleanup. Need reusable logic.

**Decision:**
Create `useTerminal` hook to encapsulate terminal initialization and lifecycle

**Rationale:**
- Hooks are React standard for stateful logic
- Separates terminal setup from UI rendering
- Easy to test (mock containerRef)
- Reusable in other components if needed

**Hook Responsibilities:**
- Initialize Terminal instance
- Load addons (FitAddon, WebLinksAddon)
- Handle window resize events
- Cleanup on unmount

**Consequences:**
- Terminal state managed by hook (not Redux/Context needed yet)
- Terminal ref returned for event handling
- Resize listener added to window

**Date:** 2025-12-27

---

## 5. CSS Modules for Terminal Component

**Status:** Decided

**Context:**
Terminal component needs styling (header, controls, terminal container). Need scoped styles to avoid conflicts.

**Decision:**
Use CSS Modules (`Terminal.module.css`) for component styling

**Rationale:**
- Automatically scoped to component
- No naming conflicts with global styles
- Imported as JavaScript object
- Works well with xterm CSS imports

**Structure:**
```
components/
├── Terminal.tsx (component)
├── Terminal.module.css (styles)
└── index.ts (re-export)
```

**Consequences:**
- Styles are co-located with component
- xterm CSS still imported globally
- Class names are generated (e.g., `.terminalWrapper` → `.Terminal_terminalWrapper__xyz`)

**Date:** 2025-12-27
