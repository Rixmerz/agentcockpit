# Kotlin Design Patterns

## Sealed Classes/Interfaces for ADTs
Use when modeling exhaustive type hierarchies (algebraic data types):
```kotlin
sealed interface NetworkResult<out T> {
    data class Success<T>(val data: T) : NetworkResult<T>
    data class Error(val code: Int, val message: String) : NetworkResult<Nothing>
    data object Loading : NetworkResult<Nothing>
}

fun <T> NetworkResult<T>.fold(
    onSuccess: (T) -> Unit,
    onError: (Int, String) -> Unit,
    onLoading: () -> Unit = {},
) = when (this) {
    is NetworkResult.Success -> onSuccess(data)
    is NetworkResult.Error -> onError(code, message)
    NetworkResult.Loading -> onLoading()
}
```
Compiler verifies exhaustiveness in `when` -- no `else` branch needed.

## Data Classes vs Value Classes
Use data classes for DTOs, value classes for type-safe wrappers:
```kotlin
// Data class: multiple fields, structural equality, copy(), destructuring
data class User(val id: UserId, val name: String, val email: Email)

// Value class: zero-overhead wrapper at runtime (inlined)
@JvmInline
value class UserId(val value: String) {
    init { require(value.isNotBlank()) { "UserId cannot be blank" } }
}

@JvmInline
value class Email(val value: String) {
    init { require("@" in value) { "Invalid email" } }
}
```
Rule: use value classes for domain primitives. They prevent mixing up String parameters.

## Delegation Pattern (by keyword)
Use when composing behavior without inheritance:
```kotlin
interface Logger {
    fun log(message: String)
}

class ConsoleLogger : Logger {
    override fun log(message: String) = println("[LOG] $message")
}

// Delegation: Repository delegates Logger behavior
class UserRepository(
    private val db: Database,
    logger: Logger = ConsoleLogger()
) : Logger by logger {
    fun save(user: User) {
        log("Saving user ${user.id}")  // delegated to ConsoleLogger
        db.insert(user)
    }
}
```

## Type-Safe DSL Builders
Use when creating readable configuration or markup APIs:
```kotlin
@DslMarker annotation class HtmlDsl

@HtmlDsl
class HtmlBuilder {
    private val elements = mutableListOf<String>()
    fun h1(text: String) { elements += "<h1>$text</h1>" }
    fun p(text: String) { elements += "<p>$text</p>" }
    fun div(block: HtmlBuilder.() -> Unit) {
        elements += "<div>"
        elements += HtmlBuilder().apply(block).build()
        elements += "</div>"
    }
    fun build() = elements.joinToString("\n")
}

fun html(block: HtmlBuilder.() -> Unit) = HtmlBuilder().apply(block).build()

// Usage: reads like a template
val page = html {
    h1("Welcome")
    div {
        p("Hello, world!")
    }
}
```

## Coroutine Patterns (Structured Concurrency)
Use when doing concurrent work with proper lifecycle management:
```kotlin
// Parallel decomposition with coroutineScope
suspend fun loadDashboard(userId: String): Dashboard = coroutineScope {
    val user = async { userService.getUser(userId) }
    val orders = async { orderService.getOrders(userId) }
    val recommendations = async { recService.getRecommendations(userId) }

    Dashboard(
        user = user.await(),
        orders = orders.await(),
        recommendations = recommendations.await()
    )
}
// If any async fails, all siblings are cancelled automatically
```

### Coroutine exception handling
```kotlin
val handler = CoroutineExceptionHandler { _, exception ->
    logger.error("Unhandled: ${exception.message}")
}

// SupervisorScope: one child failure doesn't cancel siblings
supervisorScope {
    launch { riskyOperation1() }  // failure here...
    launch { riskyOperation2() }  // ...doesn't cancel this
}
```

## State Machine with Sealed Classes
Use when modeling complex state transitions:
```kotlin
sealed interface PaymentState {
    data object Pending : PaymentState
    data class Processing(val transactionId: String) : PaymentState
    data class Completed(val receipt: Receipt) : PaymentState
    data class Failed(val reason: String) : PaymentState
}

fun PaymentState.transition(event: PaymentEvent): PaymentState = when (this) {
    is PaymentState.Pending -> when (event) {
        is PaymentEvent.Submit -> PaymentState.Processing(event.txnId)
        else -> this
    }
    is PaymentState.Processing -> when (event) {
        is PaymentEvent.Confirm -> PaymentState.Completed(event.receipt)
        is PaymentEvent.Reject -> PaymentState.Failed(event.reason)
        else -> this
    }
    is PaymentState.Completed, is PaymentState.Failed -> this // terminal states
}
```

## Anti-Patterns to Flag

| Anti-Pattern | Fix |
|-------------|-----|
| `!!` (non-null assertion) everywhere | Use safe calls `?.`, `let`, or early return |
| `GlobalScope.launch` | Use structured concurrency with proper scope |
| Mutable data classes | Use `val` properties, `copy()` for changes |
| Deep inheritance hierarchies | Use composition and delegation (`by`) |
| Catching `Exception` broadly | Catch specific types, use `runCatching` |
| `var` for everything | Default to `val`, use `var` only when mutation needed |
| Extension functions replacing OOP | Use extensions for cross-cutting, not core domain |
| Suspending in `init` blocks | Use factory functions or lazy initialization |
