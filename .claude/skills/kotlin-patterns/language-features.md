# Kotlin Language Features

## Kotlin 2.0 — K2 Compiler (Stable)
Use Kotlin 2.0+ for all new projects:
```kotlin
// Smart casts work across control flow (K2 improvement)
fun process(value: Any) {
    if (value !is String) return
    // K2: value is smart-cast to String here AND in all subsequent code
    println(value.length)
}

// Smart casts in when with sealed interfaces
fun describe(result: NetworkResult<*>) = when (result) {
    is NetworkResult.Success -> "Data: ${result.data}"  // smart cast
    is NetworkResult.Error -> "Error ${result.code}: ${result.message}"
    NetworkResult.Loading -> "Loading..."
}
```

## Kotlin 2.0 — New KMP Targets
Use for cross-platform code sharing:
```kotlin
// build.gradle.kts
kotlin {
    androidTarget()
    iosArm64()
    iosSimulatorArm64()
    wasmJs()       // Kotlin/Wasm for browser (stable in 2.0)
    jvm()          // Server-side

    sourceSets {
        commonMain.dependencies {
            implementation("io.ktor:ktor-client-core:3.0.0")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.0")
        }
        androidMain.dependencies {
            implementation("io.ktor:ktor-client-okhttp:3.0.0")
        }
        iosMain.dependencies {
            implementation("io.ktor:ktor-client-darwin:3.0.0")
        }
    }
}
```

## Kotlin 2.1 — Guard Conditions in when
Use when adding conditions to pattern matches:
```kotlin
fun classify(value: Any) = when (value) {
    is String if value.isNotBlank() -> "non-blank string"
    is String -> "blank string"
    is Int if value > 0 -> "positive int"
    is Int -> "non-positive int"
    else -> "other"
}
```

## Kotlin 2.1 — Multi-Dollar String Interpolation
Use when working with strings containing literal `$` signs:
```kotlin
// $$ prefix: only $${ } triggers interpolation, single $ is literal
val price = 42
val template = $$"The price is $price: $${price} dollars"
// Result: "The price is $price: 42 dollars"

// Useful for regex, shell scripts, templates
val regex = $$"^\$$[0-9]+\.[0-9]{2}$$"
```

## Context Receivers (Experimental -> Context Parameters in 2.2)
Use when a function requires implicit context without polluting parameters:
```kotlin
// Kotlin 2.2+: context parameters (replacing context receivers)
context(logger: Logger, tx: Transaction)
fun saveOrder(order: Order) {
    logger.info("Saving order ${order.id}")
    tx.execute("INSERT INTO orders ...")
}
```
Rule: wait for Kotlin 2.2 stable for production use of context parameters.

## Power-Assert Compiler Plugin
Use for readable assertion messages in tests without assertion libraries:
```kotlin
// build.gradle.kts
kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xplugin=kotlin-power-assert")
    }
}

// Test code
@Test fun `order total is correct`() {
    val order = Order(items = listOf(Item(price = 10), Item(price = 20)))
    assert(order.total == 30)
    // On failure, prints:
    // assert(order.total == 30)
    //        |     |     |
    //        |     25    false
    //        Order(items=[...])
}
```

## Compose Multiplatform Key Patterns
```kotlin
// Shared Composable (runs on Android, iOS, Desktop, Web)
@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    var count by remember { mutableIntStateOf(0) }

    Column(modifier = modifier.padding(16.dp)) {
        Text("Hello, $name!", style = MaterialTheme.typography.headlineMedium)
        Button(onClick = { count++ }) {
            Text("Clicked $count times")
        }
    }
}

// Platform-specific with expect/actual
expect fun getPlatformName(): String

// androidMain
actual fun getPlatformName(): String = "Android ${Build.VERSION.SDK_INT}"

// iosMain
actual fun getPlatformName(): String = "iOS ${UIDevice.currentDevice.systemVersion}"
```

## Kotlin Idioms Summary

| Pattern | Kotlin Way |
|---------|------------|
| Singleton | `object MySingleton` |
| Static methods | Companion object or top-level functions |
| Builder | Named arguments + default values |
| Null check | `?.let { }`, `?:`, `requireNotNull` |
| Type check + cast | `is` with smart cast |
| Try-catch as expression | `runCatching { }.getOrElse { default }` |
| Iteration with index | `forEachIndexed { i, item -> }` |
| Map transformation | `.map { }`, `.associate { }`, `.groupBy { }` |
| Resource management | `.use { }` (auto-close) |
