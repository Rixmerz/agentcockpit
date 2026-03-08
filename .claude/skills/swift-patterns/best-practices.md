# Swift Best Practices (2024-2025)

## Structured Concurrency

```swift
// async/await: the standard since Swift 5.5
func fetchProfile(id: UUID) async throws -> UserProfile {
    async let user = userService.findById(id)
    async let posts = postService.findByUser(id)
    async let stats = statsService.findByUser(id)

    // Wait for all three in parallel
    return UserProfile(
        user: try await user,
        posts: try await posts,
        stats: try await stats
    )
}

// Task groups for dynamic collections
func fetchAllProfiles(ids: [UUID]) async throws -> [UserProfile] {
    try await withThrowingTaskGroup(of: UserProfile.self) { group in
        for id in ids {
            group.addTask { try await fetchProfile(id: id) }
        }
        return try await group.reduce(into: []) { $0.append($1) }
    }
}

// Actor for shared mutable state
actor Cache<Key: Hashable, Value> {
    private var storage: [Key: Value] = [:]
    func get(_ key: Key) -> Value? { storage[key] }
    func set(_ key: Key, value: Value) { storage[key] = value }
}
```

## Error Handling

```swift
// Error types: enum with descriptive cases
enum NetworkError: LocalizedError {
    case notFound(URL)
    case unauthorized
    case serverError(statusCode: Int, body: Data)
    case decodingFailed(underlying: Error)
    case timeout

    var errorDescription: String? {
        switch self {
        case .notFound(let url): "Resource not found: \(url)"
        case .unauthorized: "Unauthorized"
        case .serverError(let code, _): "Server error: \(code)"
        case .decodingFailed: "Decoding error"
        case .timeout: "Request timed out"
        }
    }
}

// Result type for synchronous operations
func validateEmail(_ email: String) -> Result<Email, ValidationError> {
    do {
        return .success(try Email(email))
    } catch let error as ValidationError {
        return .failure(error)
    } catch {
        return .failure(.unknown(error))
    }
}
```

## Protocols and Generics

```swift
// Protocol-oriented programming: prefer protocols over inheritance
protocol Cacheable: Identifiable, Codable {}
protocol Repository<Entity>: Sendable {
    associatedtype Entity: Cacheable
    func findById(_ id: Entity.ID) async throws -> Entity?
    func save(_ entity: Entity) async throws -> Entity
}

// Opaque types (some) vs existential (any)
// some Protocol: concrete type, optimized, no boxing
func makeDefaultLogger() -> some Logger { ConsoleLogger() }

// any Protocol: dynamic type, boxing, needed for heterogeneous collections
let loggers: [any Logger] = [ConsoleLogger(), FileLogger()]
```

## Testing with Swift Testing

```swift
import Testing

@Suite("UserService Tests")
struct UserServiceTests {
    let svc = UserService(repository: MockUserRepository())

    @Test("creates user with valid data")
    func createUser() async throws {
        let user = try await svc.create(name: "Ana", email: "ana@test.com")
        #expect(user.name == "Ana")
        #expect(user.id != nil)
    }

    @Test("throws error with invalid email", arguments: ["", "no-email", "a@"])
    func invalidEmail(email: String) async {
        await #expect(throws: ValidationError.self) {
            try await svc.create(name: "Ana", email: email)
        }
    }
}
```

## SwiftUI Best Practices

```swift
// Use .task instead of .onAppear for async work
struct UserView: View {
    @State private var users: [User] = []

    var body: some View {
        List(users) { user in Text(user.name) }
            .task { users = try? await fetchUsers() }  // Cancelled on disappear
    }
}

// @State for local view state only
// @Observable ViewModel for shared/complex state
// @Environment for app-wide dependencies
// @Bindable for two-way binding to @Observable/@Model

// Prefer small, focused views
struct UserRowView: View {
    let user: User
    var body: some View {
        HStack {
            AsyncImage(url: user.avatarURL) { image in
                image.resizable().frame(width: 40, height: 40)
            } placeholder: { ProgressView() }
            VStack(alignment: .leading) {
                Text(user.name).font(.headline)
                Text(user.email).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
```

## Sendable and Memory Safety

```swift
// Mark types crossing concurrency boundaries as Sendable
struct UserDTO: Sendable, Codable {
    let id: UUID
    let name: String
    let email: String
}

// @MainActor for UI code
@MainActor
final class AppCoordinator {
    func showAlert(message: String) {
        // Always on main thread, guaranteed by compiler
    }
}

// Swift 6.2: single-threaded by default reduces annotations
// Set in Package.swift: defaultIsolation: MainActor.self
```

## Networking with URLSession

```swift
struct APIClient {
    let baseURL: URL
    let session = URLSession.shared

    func get<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appending(path: path)
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw APIError.invalidResponse
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func post<T: Encodable, R: Decodable>(_ path: String, body: T) async throws -> R {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, _) = try await session.data(for: request)
        return try JSONDecoder().decode(R.self, from: data)
    }
}
```

## Tooling Pipeline

| Tool | Purpose |
|------|---------|
| **SPM** | Dependency management (replace CocoaPods/Carthage) |
| **SwiftLint** | Linting — style and quality enforcement |
| **SwiftFormat** | Auto-formatting |
| **Periphery** | Dead code detection |
| **Instruments** | Profiling (memory, CPU, energy) |
| **Swift Testing** | Modern test framework |
| **SnapshotTesting** | UI regression tests |

## SwiftData Best Practices

```swift
@Model
class Task {
    var title: String
    var isCompleted: Bool
    var createdAt: Date

    init(title: String) {
        self.title = title
        self.isCompleted = false
        self.createdAt = .now
    }
}

// Use @Query for declarative fetching
struct TaskListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Task.createdAt, order: .reverse) private var tasks: [Task]

    var body: some View {
        List {
            ForEach(tasks) { task in TaskRowView(task: task) }
                .onDelete { offsets in
                    offsets.forEach { context.delete(tasks[$0]) }
                }
        }
    }
}
```
