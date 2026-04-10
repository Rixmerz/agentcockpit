---
name: swift-patterns
description: "Swift architecture reference — SwiftUI, UIKit, Combine, async/await, actors, and production best practices for Swift 5.9/6.0 (2024-2025). Use when making architectural decisions, reviewing Swift code, or selecting libraries. Also use when the user mentions iOS development, macOS apps, or Apple platform development."
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# Swift Architecture Patterns

Swift architecture reference for Claude Code. Covers frameworks, design patterns, concurrency, architecture, and best practices for Swift 6.0-6.2 (2024-2025).

## When to use this skill
- Making architectural decisions in Swift projects
- Reviewing Swift code for idioms and best practices
- Selecting frameworks or crates for iOS, macOS, server-side, or embedded Swift
- Understanding Swift concurrency (async/await, actors, structured concurrency)

## Decision Framework

### Platform selection
| Scenario | Default choice | Why |
|----------|---------------|-----|
| iOS/iPadOS/macOS app | **SwiftUI + SwiftData** | Apple's modern declarative stack |
| Complex state management | **TCA (Composable Architecture)** | Unidirectional, testeable, composable |
| Simple MVVM | **@Observable + SwiftUI** | Apple-recommended, minimal boilerplate |
| Server-side API | **Vapor 4** | Most mature Swift server framework |
| Lightweight server | **Hummingbird 2** | Fast, modular, fewer dependencies |
| Serverless (AWS) | **Swift AWS Lambda Runtime** | Native Lambda support |
| Persistence (iOS 17+) | **SwiftData** | Core Data successor, `@Model` macro |
| Persistence (legacy) | **GRDB.swift** | Best SQLite wrapper for Swift |
| Testing | **Swift Testing** | New framework (Swift 6), `@Test`, `#expect` |
| DI | **Factory** | Property-wrapper based, compile-time safe |

### Complexity tiers
1. **Simple screen**: MV pattern — `@Model` directly in View
2. **Feature with logic**: MVVM with `@Observable` ViewModel
3. **Complex app**: TCA or Clean Architecture with UseCases
4. **Enterprise/team**: Clean Architecture + DI (Factory/Needle)

## Swift Evolution (Key Versions)

| Version | Date | Key features |
|---------|------|-------------|
| 5.9 | Sep 2023 | Macros, parameter packs, `if`/`switch` expressions |
| 6.0 | Sep 2024 | **Data race safety compile-time**, Embedded Swift, Swift Testing, unified Foundation |
| 6.1 | Mar 2025 | Package traits, background indexing, `nonisolated` on types |
| 6.2 | Sep 2025 | Approachable Concurrency, WebAssembly beta, Swift-Java bridge, `Observations` |

## Production Results

| Company | Migration | Result |
|---------|-----------|--------|
| Apple (Password Monitoring) | Java → Swift | 40% perf improvement, 50% less K8s capacity, 85% less code |
| Duolingo | ObjC → Swift | 100% Swift + SwiftUI, faster iteration |
| Lyft | Mixed → Swift backend | High-perf services with Vapor |
| NSA/CISA | — | Recommends Swift for memory-safe critical code |

## Supporting files
- `frameworks.md` — Frameworks and libraries by domain
- `design-patterns.md` — Swift-idiomatic design patterns
- `architecture.md` — Architecture patterns (TCA, MVVM, Clean)
- `best-practices.md` — Concurrency, error handling, testing
- `language-features.md` — Unique Swift features (actors, macros, protocols)

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [ui-patterns](../ui-patterns/SKILL.md) — Frontend architecture and component patterns
