# Kotlin Architecture Patterns

## Clean Architecture with Koin DI
Use when building Android or KMP apps with testable layers:
```
domain/              <- Entities, UseCases, Repository interfaces (no Android deps)
data/                <- Repository implementations, API clients, Room DAOs
presentation/        <- ViewModels, Compose UI, state management
di/                  <- Koin module definitions
```

```kotlin
// Domain: UseCase with no framework dependencies
class GetOrdersUseCase(private val repo: OrderRepository) {
    suspend operator fun invoke(userId: String): List<Order> =
        repo.getOrdersByUser(userId)
}

// DI: Koin module wiring
val appModule = module {
    single<OrderRepository> { OrderRepositoryImpl(get()) }
    factory { GetOrdersUseCase(get()) }
    viewModel { OrdersViewModel(get()) }
}
```

## MVI with Compose
Use when building reactive UIs with unidirectional data flow:
```kotlin
// State, Intent, Side Effect
data class OrdersState(
    val orders: List<Order> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

sealed interface OrdersIntent {
    data object LoadOrders : OrdersIntent
    data class DeleteOrder(val id: String) : OrdersIntent
}

sealed interface OrdersEffect {
    data class ShowToast(val message: String) : OrdersEffect
}

class OrdersViewModel(private val getOrders: GetOrdersUseCase) : ViewModel() {
    private val _state = MutableStateFlow(OrdersState())
    val state = _state.asStateFlow()

    private val _effects = Channel<OrdersEffect>(Channel.BUFFERED)
    val effects = _effects.receiveAsFlow()

    fun onIntent(intent: OrdersIntent) {
        when (intent) {
            OrdersIntent.LoadOrders -> loadOrders()
            is OrdersIntent.DeleteOrder -> deleteOrder(intent.id)
        }
    }

    private fun loadOrders() = viewModelScope.launch {
        _state.update { it.copy(isLoading = true) }
        runCatching { getOrders() }
            .onSuccess { orders -> _state.update { it.copy(orders = orders, isLoading = false) } }
            .onFailure { e -> _state.update { it.copy(error = e.message, isLoading = false) } }
    }
}
```

## Repository + UseCase Layer
Use when separating data access from business logic:
```kotlin
// Repository interface (domain layer — no implementation details)
interface UserRepository {
    suspend fun getById(id: String): User?
    fun observeAll(): Flow<List<User>>
    suspend fun save(user: User)
}

// Implementation (data layer)
class UserRepositoryImpl(
    private val api: UserApi,
    private val dao: UserDao,
) : UserRepository {
    override suspend fun getById(id: String): User? =
        dao.getById(id) ?: api.fetchUser(id)?.also { dao.insert(it) }

    override fun observeAll(): Flow<List<User>> = dao.observeAll()
}
```

## Multi-Module Gradle Projects
Use when scaling to larger codebases with clear module boundaries:
```
:app                 <- Android app, DI wiring, navigation
:core:domain         <- Entities, UseCases, interfaces (pure Kotlin)
:core:data           <- Repository implementations, network, database
:core:ui             <- Shared Compose components, theme
:feature:orders      <- Orders feature (screen, ViewModel, navigation)
:feature:profile     <- Profile feature
:shared              <- KMP shared module (iOS + Android)
```

```kotlin
// settings.gradle.kts
include(":app", ":core:domain", ":core:data", ":core:ui")
include(":feature:orders", ":feature:profile")

// :feature:orders/build.gradle.kts
dependencies {
    implementation(project(":core:domain"))
    implementation(project(":core:ui"))
    // No dependency on :core:data — accessed through DI
}
```
Rule: feature modules depend on `:core:domain` (interfaces), never on `:core:data` directly.

## Ktor Server Architecture
Use when building Kotlin-native backend services:
```kotlin
fun Application.module() {
    install(ContentNegotiation) { json() }
    install(StatusPages) {
        exception<NotFoundException> { call, _ ->
            call.respond(HttpStatusCode.NotFound)
        }
    }

    val orderService = OrderService(OrderRepository())

    routing {
        route("/api/orders") {
            get { call.respond(orderService.getAll()) }
            get("/{id}") {
                val id = call.parameters["id"] ?: throw BadRequestException("Missing id")
                call.respond(orderService.getById(id) ?: throw NotFoundException())
            }
            post {
                val dto = call.receive<CreateOrderDto>()
                val order = orderService.create(dto)
                call.respond(HttpStatusCode.Created, order)
            }
        }
    }
}
```
