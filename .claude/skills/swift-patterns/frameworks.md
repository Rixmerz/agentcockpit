# Swift Frameworks and Libraries

## UI Frameworks

| Framework | Paradigm | Since | Notes |
|-----------|----------|-------|-------|
| **SwiftUI** | Declarative, reactive | iOS 13 | Modern standard. State-driven, multiplatform Apple |
| **UIKit** | Imperative, OOP | iOS 2.0 | Legacy but still needed for advanced cases |
| **AppKit** | Imperative macOS | macOS 10.0 | UIKit equivalent for macOS |
| **RealityKit** | 3D / AR | iOS 13 | Rendering, animation, physics for AR/visionOS |

## Data and Persistence

| Library | Type | Notes |
|---------|------|-------|
| **SwiftData** | ORM / persistence | iOS 17+. Core Data successor. `@Model`, `@Query`, migrations |
| **Core Data** | ORM legacy | NSManagedObject, NSFetchRequest. Mature, complex |
| **GRDB.swift** | SQLite wrapper | Most complete and fastest SQLite wrapper |
| **Realm** | Object DB | Reactive, cross-platform (iOS/Android) |
| **SQLite.swift** | SQL type-safe | SQL directly in Swift with type safety |
| **Keychain** | Security storage | Passwords, tokens. `KeychainAccess` library |

## Networking

| Library | Type | Notes |
|---------|------|-------|
| **URLSession** | HTTP native | Apple-first. Async/await native since iOS 15 |
| **Alamofire** | HTTP client | Most popular. Interceptors, retry, multipart |
| **Moya** | Network abstraction | Layer over Alamofire. Type-safe API endpoints |
| **Apollo iOS** | GraphQL | Official GraphQL client. Code generation |
| **Swift OpenAPI Generator** | REST client gen | Generates clients from OpenAPI specs |
| **gRPC Swift** | RPC | Official Apple/Swift gRPC client/server |

## Concurrency and Reactive

| Library | Paradigm | Notes |
|---------|----------|-------|
| **Swift Concurrency** | async/await, actors | Built-in since Swift 5.5. The standard |
| **Combine** | FRP (Publisher/Subscriber) | Apple-native. Complements async/await |
| **AsyncAlgorithms** | AsyncSequence ops | Zip, merge, debounce for AsyncSequence |
| **RxSwift** | FRP (ReactiveX) | Legacy. Migrate to Combine or async/await |

## DI / Architecture

| Library | Notes |
|---------|-------|
| **Factory** | Modern DI, property-wrapper based, compile-time safe |
| **Swinject** | Classic DI container |
| **Needle** | DI with code generation, for large apps |
| **TCA** | Architecture framework by Point-Free. Redux-like, composable |

## Testing

| Framework | Type | Notes |
|-----------|------|-------|
| **Swift Testing** | Unit/Integration | New Apple framework (Swift 6). `@Test`, `#expect` |
| **XCTest** | Unit/Integration | Legacy. Still valid and supported |
| **Quick + Nimble** | BDD | RSpec-like DSL for iOS |
| **SnapshotTesting** | UI Snapshots | Point-Free. Snapshot testing without Xcode |
| **ViewInspector** | SwiftUI testing | SwiftUI view inspection in unit tests |

## Tooling

| Tool | Function |
|------|----------|
| **Swift Package Manager (SPM)** | Official dependency manager. Replaces CocoaPods/Carthage |
| **Xcode 26** | Official IDE. Built-in AI, `#Playground` macro |
| **VS Code + Swift Extension** | Multi-platform alternative. Background indexing since 6.1 |
| **SwiftLint** | Linter. Style and quality rules |
| **SwiftFormat** | Auto-formatter |
| **Periphery** | Dead code detection |
| **Instruments** | Profiling: memory, CPU, energy, network |
| **swiftly** | Swift toolchain manager (like nvm for Node) |

## Server-Side Swift

| Framework | Type | Notes |
|-----------|------|-------|
| **Vapor 4** | Full-stack web | Most mature. Routing, ORM (Fluent), WebSockets, JWT |
| **Hummingbird 2** | Lightweight HTTP | Fast, modular, no heavy dependencies |
| **Smoke** | AWS-native | Amazon. Lambda and AWS services oriented |

### Server Ecosystem

| Library | Function |
|---------|----------|
| **Swift NIO** | Async networking base (Apple). Foundation for Vapor/Hummingbird |
| **AsyncHTTPClient** | Async HTTP client over NIO |
| **Swift Crypto** | Cross-platform cryptography |
| **Swift Distributed Actors** | Distributed actors (cluster, experimental) |
| **Swift Kafka** | Kafka client over librdkafka |
| **RediStack** | Pure Swift async Redis client |
| **Swift AWS Lambda Runtime** | Swift serverless on Lambda |
| **Swift OpenTelemetry** | Distributed observability |

## Cross-Platform

| Domain | Tool | Status |
|--------|------|--------|
| Android | Swift Android SDK | Beta (Swift 6.3 nightly, 2025) |
| WebAssembly | Swift for Wasm | Beta (Swift 6.2) |
| Embedded | Embedded Swift | Rapid evolution: ESP32, Arduino, Raspberry Pi |
| Windows | Swift on Windows | Official support, improved in 6.x |
| Linux | Swift on Linux | Stable since Swift 3. Unified Foundation in 6.0 |
