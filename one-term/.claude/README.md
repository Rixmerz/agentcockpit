# Context-First Architecture (CFA) Setup

This project uses **Context-First Architecture (CFA)** v2.0 for intelligent code context retrieval and development workflow.

## What is CFA?

CFA is an AI-assisted development framework that:
- **Intelligently retrieves code context** - Uses Knowledge Graph to understand what you DON'T see
- **Documents contracts** - Interfaces between components are documented before implementation
- **Tracks decisions** - Architectural decisions are persisted across sessions
- **Maintains memory** - Project learnings are stored persistently
- **Ensures safety** - Git checkpoints prevent risky operations

## CFA Files in This Project

```
.claude/
├── map.md                    # Project structure overview
├── decisions.md              # Architectural decisions with rationale
├── knowledge_graph.db        # Cached code relationships
├── contracts/                # Component interface definitions
│   ├── Terminal.contract.md
│   ├── useTerminal.contract.md
│   ├── tauriService.contract.md
│   ├── RustCommands.contract.md
│   └── RustModels.contract.md
└── settings.local.json       # CFA configuration
```

## Project Structure

### Frontend (`/src`)
- **components/** - React components
  - Terminal.tsx - Main terminal UI component
- **hooks/** - Custom React hooks
  - useTerminal.ts - xterm lifecycle management
- **services/** - Service layer for external communication
  - tauriService.ts - Tauri IPC communication layer
- **contexts/** - React context providers (future)
- **utils/** - Utility functions (future)
- **types/** - TypeScript type definitions (future)

### Backend (`/src-tauri/src`)
- **commands/** - Tauri IPC command handlers
  - greet.rs - Demo command
  - shell.rs - Shell command execution
- **services/** - Business logic (future)
- **models/** - Shared data types
  - TerminalSession - Terminal session info
  - CommandResult - Command execution result

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Start development server
npm run tauri dev

# Build for production
npm run tauri build
```

### Understanding the Code

1. **Start with map.md** - Get overview of project structure
2. **Read decisions.md** - Understand architectural choices
3. **Review contracts/** - See component interfaces
4. **Check knowledge_graph.db** - AI knows code relationships

## For Claude (AI Assistant)

When working on this project:

1. **Load context first**: `kg.retrieve("task description")` gets relevant code
2. **Check omission transparency**: Always see what code is hidden
3. **Validate contracts**: `contract.validate()` before shipping changes
4. **Record decisions**: `decision.add()` when making architectural choices
5. **Create safe points**: `safe_point.create()` before risky changes

## Adding New Features

When adding a feature:

1. **Create contract first** - Document interface in `.claude/contracts/FeatureName.contract.md`
2. **Update map.md** - Add to project map
3. **Add decision** - Record rationale in `decisions.md`
4. **Implement** - Write the code
5. **Validate contract** - Ensure implementation matches

## Key Architectural Decisions

See `decisions.md` for full rationales:

1. **xterm.js** - Terminal emulator library
2. **Tauri IPC** - Frontend/backend communication
3. **Service layer** - tauriService encapsulates IPC
4. **Modular Rust** - Clear separation (commands/services/models)
5. **useTerminal hook** - Encapsulates terminal lifecycle

## Data Flow

```
React Component → tauriService → Tauri IPC → Rust Commands → Shell
                                    ↓
                            Backend Processing
                                    ↓
                            Response → Frontend
```

## Frontend Dependency Graph

```
App.jsx
└── Terminal.tsx
    ├── useTerminal.ts
    │   └── @xterm/xterm (+ addons)
    └── tauriService.ts
        └── @tauri-apps/api
```

## Backend Module Graph

```
lib.rs
├── commands/
│   ├── greet.rs
│   └── shell.rs
├── services/ (empty, reserved)
└── models/
    └── (TerminalSession, CommandResult)
```

## Next Development Steps

### v0.2.0 - Terminal Interaction
- [ ] Connect Terminal UI to execute_command
- [ ] Implement input event handling
- [ ] Display command output in terminal
- [ ] Add basic command history

### v0.3.0 - Session Management
- [ ] Multiple terminal tabs
- [ ] Terminal session persistence
- [ ] PTY support for interactive shells

### v0.4.0 - Enhancement
- [ ] Search/find in terminal
- [ ] Theme switching
- [ ] Performance optimization

## Important Files

| File | Purpose |
|------|---------|
| `.claude/map.md` | Architecture overview |
| `.claude/decisions.md` | Design decisions with rationale |
| `.claude/contracts/` | Component interfaces |
| `src/components/Terminal.tsx` | Main UI component |
| `src/hooks/useTerminal.ts` | Terminal lifecycle |
| `src/services/tauriService.ts` | IPC service layer |
| `src-tauri/src/commands/` | Backend IPC handlers |
| `src-tauri/src/models/mod.rs` | Shared types |

## Helpful Commands

```bash
# Rebuild Knowledge Graph after major changes
# (CFA handles this automatically in most IDEs)

# Validate implementation matches contracts
# (Run during code review)

# Create safe point before risky operations
# (Automatic in CFA-aware editors)
```

## Questions?

- Check `map.md` for architecture overview
- Review `decisions.md` for design rationales
- Look at contracts in `.claude/contracts/` for interfaces
- See specific component files for implementation

---

**Last Updated:** 2025-12-27
**CFA Version:** 2.0
**Project:** one-term (v0.1.0)
