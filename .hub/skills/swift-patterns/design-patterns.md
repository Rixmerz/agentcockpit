# Swift Design Patterns

## Creational Patterns

### Builder with Result Builders
```swift
// Result Builder: type-safe declarative DSL (basis of SwiftUI)
@resultBuilder
struct QueryBuilder {
    static func buildBlock(_ conditions: String...) -> String {
        conditions.joined(separator: " AND ")
    }
    static func buildOptional(_ condition: String?) -> String {
        condition ?? "1=1"
    }
    static func buildEither(first: String) -> String { first }
    static func buildEither(second: String) -> String { second }
}

func buildQuery(@QueryBuilder conditions: () -> String) -> String {
    "WHERE " + conditions()
}

let query = buildQuery {
    "age > 18"
    "is_active = true"
    if searchTerm != nil { "name LIKE '%\(searchTerm!)%'" }
}
```

### Factory with Protocols and Enums
```swift
protocol Exporter {
    func export<T: Encodable>(_ data: T) throws -> Data
}

struct JSONExporter: Exporter {
    func export<T: Encodable>(_ data: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        return try encoder.encode(data)
    }
}

enum ExportFormat {
    case json, csv
    func makeExporter() -> Exporter {
        switch self {
        case .json: JSONExporter()
        case .csv:  CSVExporter()
        }
    }
}
```

### Singleton (Swift idiom)
```swift
// static let is lazy and thread-safe by default in Swift
final class AppConfiguration {
    static let shared = AppConfiguration()
    private(set) var apiBaseURL: URL
    private init() {
        apiBaseURL = URL(string: "https://api.example.com")!
    }
}
// In modern practice: prefer DI over Singleton
```

## Structural Patterns

### Repository Pattern with async/await
```swift
protocol UserRepository: Sendable {
    func findById(_ id: UUID) async throws -> User?
    func findAll() async throws -> [User]
    func save(_ user: User) async throws -> User
    func delete(id: UUID) async throws
}

// Actor implementation — thread-safe by compiler guarantee
actor RemoteUserRepository: UserRepository {
    private let client: APIClient
    init(client: APIClient) { self.client = client }

    func findById(_ id: UUID) async throws -> User? {
        try await client.get("/users/\(id)")
    }
    func findAll() async throws -> [User] {
        try await client.get("/users")
    }
    func save(_ user: User) async throws -> User {
        if user.id == nil {
            return try await client.post("/users", body: user)
        } else {
            return try await client.put("/users/\(user.id!)", body: user)
        }
    }
    func delete(id: UUID) async throws {
        try await client.delete("/users/\(id)")
    }
}

// In-memory for tests
actor InMemoryUserRepository: UserRepository {
    private var store: [UUID: User] = [:]
    func findById(_ id: UUID) async -> User? { store[id] }
    func findAll() async -> [User] { Array(store.values) }
    func save(_ user: User) async -> User {
        var u = user
        if u.id == nil { u = User(id: UUID(), name: u.name, email: u.email) }
        store[u.id!] = u
        return u
    }
    func delete(id: UUID) async { store.removeValue(forKey: id) }
}
```

### Decorator with Protocols
```swift
protocol Logger: Sendable {
    func log(_ message: String, level: LogLevel)
}

final class ConsoleLogger: Logger {
    func log(_ message: String, level: LogLevel) {
        print("[\(level)] \(message)")
    }
}

// Decorator adds timestamps
final class TimestampLogger: Logger {
    private let inner: Logger
    init(wrapping inner: Logger) { self.inner = inner }
    func log(_ message: String, level: LogLevel) {
        inner.log("[\(Date())] \(message)", level: level)
    }
}

// Composition
let logger: Logger = TimestampLogger(wrapping: ConsoleLogger())
```

## Behavioral Patterns

### Observer with Combine / AsyncStream
```swift
// Combine: Publisher/Subscriber
final class CartViewModel: ObservableObject {
    @Published private(set) var items: [CartItem] = []
    @Published private(set) var total: Decimal = 0
    private var cancellables = Set<AnyCancellable>()

    init() {
        $items
            .map { items in items.reduce(0) { $0 + $1.price * Decimal($1.quantity) } }
            .assign(to: &$total)
    }
}

// AsyncStream: modern observer with async/await
func makeLocationStream() -> AsyncStream<CLLocation> {
    AsyncStream { continuation in
        let delegate = LocationDelegate { location in
            continuation.yield(location)
        }
        continuation.onTermination = { _ in delegate.stop() }
    }
}

for await location in makeLocationStream() {
    updateUI(with: location)
}
```

### State Machine with Enums
```swift
// Swift enums with associated values = expressive state machines
enum DownloadState {
    case idle
    case downloading(progress: Double)
    case paused(bytesDownloaded: Int64)
    case completed(url: URL)
    case failed(error: Error)

    var isActive: Bool {
        if case .downloading = self { return true }
        return false
    }

    mutating func pause(bytesDownloaded: Int64) {
        guard case .downloading = self else { return }
        self = .paused(bytesDownloaded: bytesDownloaded)
    }
}

// Exhaustive pattern matching
func handleState(_ state: DownloadState) -> String {
    switch state {
    case .idle: "Waiting..."
    case .downloading(let progress): String(format: "%.0f%%", progress * 100)
    case .paused(let bytes): "Paused: \(bytes) bytes"
    case .completed(let url): "Done: \(url.lastPathComponent)"
    case .failed(let error): "Error: \(error.localizedDescription)"
    }
}
```

### Strategy with Closures and KeyPaths
```swift
struct SortStrategy<T> {
    let comparator: (T, T) -> Bool

    static func ascending<C: Comparable>(by keyPath: KeyPath<T, C>) -> SortStrategy<T> {
        SortStrategy { $0[keyPath: keyPath] < $1[keyPath: keyPath] }
    }
    static func descending<C: Comparable>(by keyPath: KeyPath<T, C>) -> SortStrategy<T> {
        SortStrategy { $0[keyPath: keyPath] > $1[keyPath: keyPath] }
    }
}

extension Array {
    func sorted(by strategy: SortStrategy<Element>) -> [Element] {
        sorted(by: strategy.comparator)
    }
}

let byAge = users.sorted(by: .ascending(by: \.age))
```

## Modern Swift Patterns

### Value Objects with Immutable Structs
```swift
struct Email: Hashable, Sendable, CustomStringConvertible {
    let value: String
    init(_ raw: String) throws {
        let pattern = #"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$"#
        guard raw.range(of: pattern, options: .regularExpression) != nil else {
            throw ValidationError.invalidEmail(raw)
        }
        self.value = raw.lowercased()
    }
    var description: String { value }
}

struct Money: Comparable, Sendable {
    let amount: Decimal
    let currency: Currency
    static func + (lhs: Money, rhs: Money) throws -> Money {
        guard lhs.currency == rhs.currency else { throw MoneyError.currencyMismatch }
        return Money(amount: lhs.amount + rhs.amount, currency: lhs.currency)
    }
    static func < (lhs: Money, rhs: Money) -> Bool { lhs.amount < rhs.amount }
}
```

### Actor for Shared Mutable State
```swift
actor BankAccount {
    private var balance: Decimal
    private var transactions: [Transaction] = []

    init(initialBalance: Decimal) { self.balance = initialBalance }

    func deposit(_ amount: Decimal) throws {
        guard amount > 0 else { throw AccountError.invalidAmount }
        balance += amount
        transactions.append(.deposit(amount))
    }

    func withdraw(_ amount: Decimal) throws {
        guard amount > 0 else { throw AccountError.invalidAmount }
        guard balance >= amount else { throw AccountError.insufficientFunds }
        balance -= amount
        transactions.append(.withdrawal(amount))
    }

    var currentBalance: Decimal { balance }
}

// Usage: each access is async, guarantees mutual exclusion
let account = BankAccount(initialBalance: 1000)
try await account.deposit(500)
try await account.withdraw(200)
```

## Anti-Patterns

| Anti-pattern | Problem | Fix |
|-------------|---------|-----|
| Force unwrap `!` everywhere | Crash source #1 | `guard let`, `if let`, `??` |
| Mutable global singletons | Data races | DI with protocols |
| Massive ViewController | Untestable, unmaintainable | Extract ViewModel/UseCase |
| Callback hell | Hard to reason about | async/await |
| `DispatchQueue` in async code | Thread confusion | Use actors, `Task`, `MainActor` |
| Retain cycles in closures | Memory leaks | `[weak self]` |
| `class` by default | Unnecessary reference semantics | `struct` by default |
| `ObservableObject` on iOS 17+ | More boilerplate than needed | `@Observable` macro |
