---
name: kotlin-patterns
description: Kotlin architecture reference - frameworks, design patterns, coroutines, Compose Multiplatform, KMP, Ktor, Spring Boot, and production best practices for Kotlin 2.0/2.1 (2024-2025). Use when making architectural decisions, reviewing Kotlin code, or selecting libraries.
user-invocable: true
argument-hint: "[frameworks|patterns|architecture|practices|features|all]"
---

# Kotlin Architecture Reference (2024-2025)

Comprehensive reference for Kotlin architectural decisions. Use `$ARGUMENTS` to focus on a specific area, or browse all sections.

## Quick Navigation

- For framework/library selection and comparisons, see [frameworks.md](frameworks.md)
- For design patterns (sealed classes, DSL builders, delegation, coroutines), see [design-patterns.md](design-patterns.md)
- For architecture patterns (Clean, MVI/MVVM, multi-module), see [architecture.md](architecture.md)
- For best practices (null safety, coroutines, extensions, K2), see [best-practices.md](best-practices.md)
- For language features (Kotlin 2.0/2.1, K2 compiler, KMP), see [language-features.md](language-features.md)

## Decision Framework

1. **Backend**: Enterprise/existing Java -> Spring Boot (Kotlin DSL). Kotlin-native server -> Ktor. Lightweight -> http4k
2. **Mobile**: Android UI -> Jetpack Compose. Cross-platform UI -> Compose Multiplatform. Shared logic only -> KMP
3. **Database**: Type-safe SQL DSL -> Exposed. ORM -> Hibernate (Spring). Async -> R2DBC + Jasync
4. **DI**: Android/KMP -> Koin. Compile-time -> Dagger/Hilt. Spring -> built-in Spring DI
5. **Testing**: Default -> kotlin.test + MockK. Coroutines -> Turbine. Property-based -> Kotest
6. **Serialization**: Default -> kotlinx.serialization. JSON interop -> Moshi/Gson (legacy)
7. **Build**: Always Gradle (Kotlin DSL). Version catalogs for dependency management

## Kotlin in Production

| Company | Result |
|---------|--------|
| **Google** | Android's preferred language, 95%+ of top apps use Kotlin |
| **JetBrains** | IntelliJ platform, Space, Kotlin compiler itself |
| **Netflix** | Backend services, Android app |
| **Uber** | Android app (100% Kotlin), some backend services |
| **Pinterest** | Android (100% Kotlin), backend services |
| **Slack** | Android app, shared KMP modules with iOS |
| **Cash App** | Full stack: Android + server + KMP shared code |

## Kotlin Evolution

| Version | Key Features |
|---------|-------------|
| 1.9 (Jul 2023) | K2 beta, enum `entries`, data object, `..` operator for ranges |
| 2.0 (May 2024) | **K2 compiler stable** (2x faster), Smart cast improvements, Compose compiler plugin merged |
| 2.1 (Nov 2024) | Guard conditions in `when`, multi-dollar strings, non-local break/continue |
| 2.2 (2025) | Context parameters (replacing context receivers), UUID in stdlib, Base64 |

## Related Skills
- [dev-patterns](../dev-patterns/SKILL.md) — Language-agnostic design principles
- [qa-patterns](../qa-patterns/SKILL.md) — Testing strategies and quality gates
- [devops-patterns](../devops-patterns/SKILL.md) — CI/CD, containers, and infrastructure
