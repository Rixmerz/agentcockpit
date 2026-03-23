# Kotlin Frameworks & Libraries

## Server Frameworks

| Framework | Best For | Key Feature |
|-----------|----------|-------------|
| **Spring Boot (Kotlin)** | Enterprise, existing Java teams | Kotlin DSL, coroutine support, massive ecosystem |
| **Ktor** | Kotlin-native servers, microservices | Coroutine-first, modular plugins, KMP-ready |
| **http4k** | Functional HTTP, testing-first | Typesafe, no reflection, serverless-friendly |
| **Quarkus (Kotlin)** | Cloud-native, GraalVM | Fast startup, low memory, reactive |

## Android / Mobile

| Library | Purpose |
|---------|---------|
| **Jetpack Compose** | Android declarative UI (Google recommended) |
| **Compose Multiplatform** | Cross-platform UI (iOS, Desktop, Web, Android) |
| **Hilt** | DI for Android (compile-time, Dagger-based) |
| **Koin** | DI for Kotlin (runtime, simpler, KMP-friendly) |
| **Room** | Android SQLite ORM with coroutines |
| **Retrofit + OkHttp** | HTTP client (Android standard) |
| **Ktor Client** | Multiplatform HTTP client (KMP-native) |
| **Coil** | Image loading for Compose |

## KMP (Kotlin Multiplatform)

| Layer | Library |
|-------|---------|
| **Shared networking** | Ktor Client (iOS, Android, Desktop, JS) |
| **Shared serialization** | kotlinx.serialization |
| **Shared date/time** | kotlinx-datetime |
| **Shared persistence** | SQLDelight (generates type-safe Kotlin from SQL) |
| **Shared DI** | Koin (KMP module) |
| **Shared state** | KMM-ViewModel, Decompose |

## Database

| Library | Approach | Best For |
|---------|----------|----------|
| **Exposed** | Kotlin SQL DSL + DAO | Type-safe queries, Kotlin-idiomatic |
| **SQLDelight** | SQL-first, generates Kotlin | KMP, Android, compile-time SQL verification |
| **Spring Data JPA** | JPA/Hibernate | Enterprise, existing Spring projects |
| **Ktorm** | Lightweight ORM | Simple CRUD, Kotlin-first |

## Testing

| Tool | Purpose |
|------|---------|
| **kotlin.test** | Multiplatform test annotations |
| **JUnit 5** | JVM test runner (standard) |
| **Kotest** | Property-based, data-driven, rich matchers |
| **MockK** | Kotlin-first mocking (coroutine support) |
| **Turbine** | Flow testing (assert emissions) |
| **Testcontainers** | Integration tests with Docker |

## Build & Tooling

| Tool | Purpose |
|------|---------|
| **Gradle (Kotlin DSL)** | Build system (Kotlin-first config) |
| **Version Catalogs** | Centralized dependency versions |
| **Detekt** | Static analysis for Kotlin |
| **Ktlint** | Kotlin code formatting |
| **Kover** | Kotlin code coverage |
| **KSP** | Kotlin Symbol Processing (annotation processing) |
