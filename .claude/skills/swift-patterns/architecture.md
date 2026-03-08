# Swift Architecture Patterns

## TCA — The Composable Architecture

Most adopted architecture for complex SwiftUI apps. Unidirectional, testable, composable.
Core concepts: `State`, `Action`, `Reducer`, `Store`, `Effect`.

```swift
import ComposableArchitecture

@Reducer
struct CounterFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
        var isLoading = false
        var fact: String?
    }

    enum Action {
        case incrementTapped
        case decrementTapped
        case factButtonTapped
        case factResponse(Result<String, Error>)
    }

    @Dependency(\.numberFact) var numberFact

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .incrementTapped:
                state.count += 1
                return .none
            case .decrementTapped:
                state.count -= 1
                return .none
            case .factButtonTapped:
                state.isLoading = true
                return .run { [count = state.count] send in
                    await send(.factResponse(Result {
                        try await numberFact.fetch(count)
                    }))
                }
            case let .factResponse(.success(fact)):
                state.isLoading = false
                state.fact = fact
                return .none
            case .factResponse(.failure):
                state.isLoading = false
                return .none
            }
        }
    }
}
```

## MVVM with SwiftUI + Observation

Apple-recommended for SwiftUI apps. Since iOS 17, uses `@Observable` macro instead of `ObservableObject`.

```swift
// iOS 17+: @Observable (no Combine, more efficient)
@Observable
final class UserListViewModel {
    private(set) var users: [User] = []
    private(set) var isLoading = false
    private(set) var error: String?

    private let repository: UserRepository

    init(repository: UserRepository) {
        self.repository = repository
    }

    func loadUsers() async {
        isLoading = true
        error = nil
        do {
            users = try await repository.findAll()
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}

struct UserListView: View {
    @State private var viewModel = UserListViewModel(
        repository: RemoteUserRepository(client: .shared)
    )

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView("Loading...")
            } else if let error = viewModel.error {
                ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
            } else {
                List(viewModel.users) { user in
                    UserRowView(user: user)
                }
            }
        }
        .task { await viewModel.loadUsers() }
    }
}
```

## MV (Model-View) — The "Apple Way"

Apple promotes direct use of `@Model` SwiftData and `@Observable` without separate ViewModel for simple screens.

```swift
struct ProductDetailView: View {
    @Bindable var product: Product  // @Model from SwiftData

    var body: some View {
        Form {
            TextField("Name", text: $product.name)
            TextField("Price", value: $product.price, format: .currency(code: "USD"))
            Toggle("Available", isOn: $product.isAvailable)
        }
        .navigationTitle(product.name)
    }
}
```

## Clean Architecture for iOS

```
Sources/
├── Domain/                          # No external dependencies
│   ├── Entities/
│   │   ├── User.swift
│   │   └── Order.swift
│   ├── Repositories/                # Protocols (ports)
│   │   ├── UserRepository.swift
│   │   └── OrderRepository.swift
│   └── UseCases/
│       ├── GetUserUseCase.swift
│       └── CreateOrderUseCase.swift
│
├── Data/                            # Implementations
│   ├── Remote/
│   │   ├── API/UserAPIClient.swift
│   │   └── DTO/UserDTO.swift
│   ├── Local/
│   │   └── SwiftData/UserStore.swift
│   └── Repositories/
│       └── UserRepositoryImpl.swift
│
├── Presentation/                    # ViewModels + Views
│   ├── Users/
│   │   ├── UserListViewModel.swift
│   │   ├── UserListView.swift
│   │   └── UserDetailView.swift
│   └── Common/
│       └── ErrorView.swift
│
└── DI/
    └── AppContainer.swift
```

## Architecture Selection Guide

| Complexity | Pattern | When |
|-----------|---------|------|
| Simple screen | **MV** | Direct `@Model` binding, no business logic |
| Feature with logic | **MVVM** | `@Observable` ViewModel, async data loading |
| Complex app | **TCA** | Many features, shared state, side effects |
| Enterprise/team | **Clean Architecture** | Multiple teams, strict layer separation |

## Navigation Patterns

```swift
// NavigationStack (iOS 16+) — type-safe, programmatic
struct AppNavigator: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            HomeView()
                .navigationDestination(for: User.self) { user in
                    UserDetailView(user: user)
                }
                .navigationDestination(for: Order.self) { order in
                    OrderDetailView(order: order)
                }
        }
        .environment(\.navigate, NavigateAction { route in
            path.append(route)
        })
    }
}
```

## Dependency Injection with Factory

```swift
import Factory

extension Container {
    var userRepository: Factory<UserRepository> {
        self { RemoteUserRepository(client: self.apiClient()) }
            .singleton
    }

    var apiClient: Factory<APIClient> {
        self { APIClient(baseURL: Config.apiURL) }
            .singleton
    }
}

// Usage in ViewModel
@Observable
final class UserViewModel {
    @Injected(\.userRepository) private var repository

    func load() async throws {
        users = try await repository.findAll()
    }
}

// Override in tests
Container.shared.userRepository.register { InMemoryUserRepository() }
```
