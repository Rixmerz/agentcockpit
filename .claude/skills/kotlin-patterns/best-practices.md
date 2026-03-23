# Kotlin Best Practices (2024-2025)

## Null Safety Idioms
Use Kotlin's type system instead of defensive null checks:
```kotlin
// Safe call + elvis operator (preferred)
val length = name?.length ?: 0

// let for nullable transformation
user?.let { saveToDatabase(it) }

// require/check for preconditions (throw on violation)
fun process(id: String?) {
    requireNotNull(id) { "ID must not be null" }
    require(id.isNotBlank()) { "ID must not be blank" }
    // id is smart-cast to non-null String here
}

// filterNotNull for collections
val validEmails: List<String> = users.mapNotNull { it.email }
```
Rule: never use `!!` except in tests. If you need `!!`, restructure to avoid it.

## Coroutine Scoping and Cancellation
Use proper scope hierarchy to prevent leaks:
```kotlin
// ViewModel: viewModelScope (auto-cancelled on ViewModel clear)
class MyViewModel : ViewModel() {
    fun load() = viewModelScope.launch {
        val data = withContext(Dispatchers.IO) { repo.fetch() }
        _state.value = data
    }
}

// Service: custom scope with SupervisorJob
class BackgroundService : CoroutineScope {
    override val coroutineContext = SupervisorJob() + Dispatchers.Default

    fun processAsync(item: Item) = launch {
        // Failure here doesn't cancel other children
        process(item)
    }

    fun shutdown() { coroutineContext.cancelChildren() }
}
```

### Cancellation cooperation
```kotlin
suspend fun processItems(items: List<Item>) {
    for (item in items) {
        ensureActive()  // check cancellation before each item
        heavyComputation(item)
    }
}
```

## Flow vs Channel

| Use Case | Mechanism | Why |
|----------|-----------|-----|
| Observe data over time | `Flow` | Cold, declarative, backpressure |
| One-shot events (toast, nav) | `Channel` | Hot, consumed once |
| Shared state stream | `StateFlow` | Hot, always has value |
| Broadcast events to many | `SharedFlow` | Hot, multiple collectors |

```kotlin
// StateFlow for UI state
private val _state = MutableStateFlow(UiState())
val state: StateFlow<UiState> = _state.asStateFlow()

// Channel for one-shot effects
private val _effects = Channel<Effect>(Channel.BUFFERED)
val effects = _effects.receiveAsFlow()
```

## Extension Functions — When to Use vs Avoid
Use for cross-cutting utilities and API enrichment:
```kotlin
// Good: utility that doesn't belong in the class
fun String.toSlug(): String = lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

// Good: scoped extensions (only available in context)
context(LoggingContext)
fun HttpResponse.logResult() { logger.info("Status: ${status.value}") }
```

Avoid when the function is core domain logic:
```kotlin
// Bad: core behavior as extension (should be a method on Order)
fun Order.calculateTotal(): Money = ...  // put this IN Order class

// Bad: extension that mutates (side effects are hard to discover)
fun MutableList<User>.removeInactive() = removeAll { !it.isActive }
```

## Kotlin 2.0 K2 Compiler Benefits
- **2x faster compilation** than K1 on most projects
- **Better smart casts**: works across `when` branches, control flow
- **Improved type inference**: fewer explicit type annotations needed
- **Compiler plugin API**: Compose compiler merged into Kotlin distribution
- Enable: `kotlin.version=2.0.0` or later in `gradle.properties`

## DO / DON'T Quick Reference

| DO | DON'T |
|----|-------|
| Use `val` by default, `var` only when needed | Use `var` everywhere out of habit |
| Use `data class` for DTOs | Use regular classes with manual `equals`/`hashCode` |
| Use `sealed` for finite type hierarchies | Use `enum` when types carry different data |
| Use `runCatching` for expected failures | Catch `Exception` broadly and swallow |
| Use `kotlinx.serialization` for new projects | Use Gson (reflection-based, slower) |
| Use `Dispatchers.IO` for blocking I/O | Block `Dispatchers.Main` with network calls |
| Use `value class` for domain primitives | Pass raw `String`/`Int` for typed concepts |
| Use `Flow` for reactive data streams | Use callbacks or LiveData in new code |
