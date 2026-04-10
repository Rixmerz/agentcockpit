---
paths: ["**/*.swift"]
---

# Swift Rules

> Always apply these rules when writing or reviewing Swift code.

## DO
- Use `struct` by default; only `class` when you need reference semantics, inheritance, or lifecycle
- Declare properties with `let` — only use `var` when mutation is needed
- Use `guard let` / `guard else { return }` for early exits instead of nested `if let`
- Use `async/await` instead of callbacks and completion handlers
- Use actors for shared mutable state instead of locks or DispatchQueue
- Mark types crossing concurrency boundaries as `Sendable`
- Use `@MainActor` for UI code
- Program against protocols, not concrete implementations
- Use DI (constructor injection) instead of global singletons
- Use Swift Testing (`@Test`, `#expect`) for new tests
- Use `.task { }` instead of `.onAppear` for async work in SwiftUI
- Prefer `@Observable` (iOS 17+) over `ObservableObject` + `@Published`
- Use `some` (opaque types) when returning a single concrete type
- Use `any` (existential) only for heterogeneous collections
- Use SPM for dependency management
- Use `guard let url = URL(string: input)` instead of force-unwrapping URLs

## DON'T
- Don't force unwrap (`!`) without documented justification — crash source #1
- Don't use mutable global singletons — data races guaranteed in Swift 6
- Don't use `DispatchQueue` when `async/await` or actors are available
- Don't create retain cycles — use `[weak self]` in closures that capture self
- Don't use `class` by default — `struct` is the Swift idiom
- Don't use `Timer.scheduledTimer` in async code — use `Task.sleep`
- Don't use `ObservableObject` on iOS 17+ — `@Observable` is more efficient
- Don't ignore compiler warnings about Sendable conformance
- Don't use `as!` force casting without a fallback — use `as?` with guard
- Don't use CocoaPods or Carthage for new projects — SPM is the standard
- Don't put business logic in Views — extract to ViewModel or UseCase
- Don't use `RxSwift` in new code — use Combine or async/await
