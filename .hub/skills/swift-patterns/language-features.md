# Swift Language Features

## Concurrency — Structured Concurrency and Actors

Swift's concurrency model is integrated into the compiler, not a library. In **Swift 6**, data race checking is compile-time by default. **Swift 6.2** introduced "Approachable Concurrency": `single-threaded by default` to reduce annotations.

```swift
// async/await: suspends without blocking the thread
func fetchData() async throws -> Data {
    let (data, _) = try await URLSession.shared.data(from: url)
    return data
}

// Actor: mutual exclusion guaranteed by compiler
actor SafeCounter {
    private var value = 0
    func increment() { value += 1 }
    func current() -> Int { value }
}

// @MainActor: main thread isolation
@MainActor
class ViewModel {
    var title = ""  // Always accessed on main thread
}

// TaskGroup: parallelism with limits and error handling
let results = try await withThrowingTaskGroup(of: String.self) { group in
    for url in urls {
        group.addTask { try await download(url) }
    }
    return try await group.reduce(into: []) { $0.append($1) }
}
```

## Protocol-Oriented Programming

Swift is "protocol-first" — protocols support `associatedtype`, default implementations via extensions, and retroactive conformances.

```swift
// Protocol with associated type
protocol Repository<Entity>: Sendable {
    associatedtype Entity: Identifiable
    func findById(_ id: Entity.ID) async throws -> Entity?
}

// Extension with default implementation
extension Collection where Element: Comparable {
    var sorted: [Element] { sorted(by: <) }
}

// Retroactive conformance — add conformance to external types
extension Int: Describable {
    var description: String { "\(self) (Int)" }
}
```

## Value Types and Copy-on-Write

`struct` and `enum` are value types — copied on assignment. Swift implements **copy-on-write (COW)** for standard collections.

```swift
// Custom COW
struct LargeDataBuffer {
    private var _storage: Storage

    mutating func append(_ byte: UInt8) {
        if !isKnownUniquelyReferenced(&_storage) {
            _storage = Storage(copying: _storage)
        }
        _storage.data.append(byte)
    }
}
```

## Generics and Opaque Types

```swift
// Generics: type-safe without boxing (vs Java/Kotlin with JVM type erasure)
func zip<A, B, C>(
    _ a: some AsyncSequence<A, Error>,
    _ b: some AsyncSequence<B, Error>,
    combining: (A, B) -> C
) -> AsyncStream<C> { /* ... */ }

// Opaque types (some): concrete type hidden from caller
// Compiler knows concrete type -> no boxing overhead
var body: some View { Text("Hello") }

// Existential types (any): dynamic type, boxing, dynamic dispatch
let shapes: [any Shape] = [Circle(), Rectangle(), Triangle()]
```

## Property Wrappers

```swift
@propertyWrapper
struct Clamped<Value: Comparable> {
    private var value: Value
    private let range: ClosedRange<Value>

    init(wrappedValue: Value, in range: ClosedRange<Value>) {
        self.range = range
        self.value = min(max(wrappedValue, range.lowerBound), range.upperBound)
    }

    var wrappedValue: Value {
        get { value }
        set { value = min(max(newValue, range.lowerBound), range.upperBound) }
    }
}

struct Player {
    @Clamped(in: 0...100) var health: Int = 100
    @Clamped(in: 0...1) var opacity: Double = 1.0
}

// SwiftUI property wrappers: @State, @Binding, @ObservedObject,
// @EnvironmentObject, @AppStorage, @Query, @Bindable
```

## Macros (Swift 5.9+)

```swift
// Macros: type-safe compile-time meta-programming
// (No runtime reflection like Java/Kotlin)

// @Observable (Apple macro - iOS 17)
@Observable class Store {
    var count = 0  // Automatically observable
}

// #Preview macro
#Preview {
    ContentView()
        .modelContainer(for: Task.self, inMemory: true)
}

// @Model (SwiftData macro)
@Model class Article {
    var title: String
    var content: String
    var publishedAt: Date?
}
```

## Pattern Matching

```swift
// Exhaustive switch with complex patterns
func processEvent(_ event: AppEvent) {
    switch event {
    case .networkError(let error) where error.isRetryable:
        scheduleRetry()
    case .networkError(let error):
        showError(error)
    case .userAction(.purchase(let item)) where item.price > 100:
        requireBiometrics(for: item)
    case .userAction(.purchase(let item)):
        processPurchase(item)
    case .backgroundRefresh:
        refreshData()
    }
}

// if case let — pattern matching in ifs
if case .downloading(let progress) = downloadState, progress > 0.5 {
    showCompletionHint()
}

// for case — filter with pattern matching
for case .completed(let url) in downloadStates {
    processFile(at: url)
}
```

## Result Builders

```swift
// The mechanism behind SwiftUI's declarative syntax
@resultBuilder
struct HTMLBuilder {
    static func buildBlock(_ components: String...) -> String {
        components.joined(separator: "\n")
    }
    static func buildOptional(_ component: String?) -> String {
        component ?? ""
    }
    static func buildEither(first: String) -> String { first }
    static func buildEither(second: String) -> String { second }
}

func html(@HTMLBuilder content: () -> String) -> String {
    "<html>\(content())</html>"
}
```

## String Interpolation

```swift
// Custom string interpolation
extension String.StringInterpolation {
    mutating func appendInterpolation(_ date: Date, format: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = format
        appendLiteral(formatter.string(from: date))
    }

    mutating func appendInterpolation(sql value: String) {
        appendLiteral("'\(value.replacingOccurrences(of: "'", with: "''"))'")
    }
}

let message = "Created \(createdAt, format: "dd/MM/yyyy")"
let query = "SELECT * FROM users WHERE name = \(sql: userInput)"
```

## Embedded Swift

```swift
// Embedded Swift (Swift 6+): subset without runtime for microcontrollers
// No heap allocation, no reflection, no Objective-C runtime
// Compiles to KB-sized binaries for ESP32, Arduino

// Available in Embedded Swift:
// - Full value types (struct, enum)
// - Protocols (no dynamic existentials)
// - Generics
// - Basic closures (no heap-allocated closures)
// NOT available: Any, AnyObject, reflection, objc interop
```

## Key Type System Features

| Feature | Description |
|---------|-------------|
| `struct` default | Value types by default — copied, thread-safe |
| `let` immutability | Prefer `let` over `var` — compiler enforces |
| `guard let` | Early exit pattern for optional unwrapping |
| `some` (opaque) | Concrete type hidden from caller, no boxing |
| `any` (existential) | Dynamic dispatch, boxing, heterogeneous collections |
| `@Sendable` | Closures safe to send across concurrency domains |
| `Sendable` protocol | Types safe to share across actors |
| `@MainActor` | Compiler-guaranteed main thread execution |
| `actor` | Mutual exclusion without locks |
| `async let` | Structured concurrent bindings |
| `consuming`/`borrowing` | Ownership modifiers (Swift 5.9+) |
