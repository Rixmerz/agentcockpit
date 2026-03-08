# PHP Best Practices

## Type Declarations Evolution

```php
// PHP 7.0: Scalar type declarations
function add(int $a, int $b): int { return $a + $b; }

// PHP 7.1: Nullable types, void return
function find(int $id): ?User { /* ... */ }
function log(string $msg): void { /* ... */ }

// PHP 7.4: Typed properties
class User { public string $name; public ?string $email = null; }

// PHP 8.0: Union types
function parse(string|int $input): array|false { /* ... */ }

// PHP 8.1: Intersection types, never return
function process(Countable&Iterator $items): void { /* ... */ }
function abort(): never { throw new RuntimeException('Fatal'); }

// PHP 8.1: Readonly properties
class Point { public function __construct(public readonly float $x, public readonly float $y) {} }

// PHP 8.2: Readonly classes, DNF types (Disjunctive Normal Form)
readonly class Coordinate { public function __construct(public float $lat, public float $lng) {} }
function handle((Countable&Iterator)|null $items): void { /* ... */ }

// PHP 8.2: true, false, null as standalone types
function isReady(): true { return true; }
```

## Always Use Strict Types

```php
<?php
declare(strict_types=1);

// Without strict_types: PHP silently coerces types
// "5" + 3 works, "hello" + 3 gives 3 — dangerous

// With strict_types: type mismatches throw TypeError
function multiply(int $a, int $b): int
{
    return $a * $b;
}

multiply(3, 4);     // OK: 12
multiply("3", 4);   // TypeError! String given, int expected
```

Every PHP file should start with `declare(strict_types=1)` immediately after `<?php`.

## Named Arguments and Match Expressions

```php
declare(strict_types=1);

// Named arguments: skip optional params, self-documenting calls
$response = Http::timeout(seconds: 30)->get(
    url: 'https://api.example.com/users',
);

str_contains(haystack: $email, needle: '@');

// match: strict comparison, returns value, exhaustive
function statusLabel(OrderStatus $status): string
{
    return match ($status) {
        OrderStatus::Pending => 'Awaiting Payment',
        OrderStatus::Processing => 'Being Prepared',
        OrderStatus::Shipped => 'On the Way',
        OrderStatus::Delivered => 'Delivered',
        OrderStatus::Cancelled => 'Cancelled',
    }; // No default needed — enum is exhaustive
}

// match with complex conditions
$category = match (true) {
    $age < 13 => 'child',
    $age < 18 => 'teenager',
    $age < 65 => 'adult',
    default => 'senior',
};
```

## Attributes Replacing Docblock Annotations

```php
declare(strict_types=1);

// BEFORE (docblock annotation — requires runtime parser)
/**
 * @Route("/api/users", methods={"GET"})
 * @IsGranted("ROLE_ADMIN")
 */

// AFTER (native attributes — PHP 8.0+, zero overhead)
#[Route('/api/users', methods: ['GET'])]
#[IsGranted('ROLE_ADMIN')]
class UserController
{
    #[Route('/{id}', methods: ['GET'])]
    public function show(
        #[MapEntity(id: 'id')] User $user,
    ): JsonResponse {
        return $this->json($user);
    }
}

// Validation attributes
readonly class CreateUserRequest
{
    public function __construct(
        #[Assert\NotBlank]
        #[Assert\Length(min: 2, max: 100)]
        public string $name,

        #[Assert\NotBlank]
        #[Assert\Email]
        public string $email,

        #[Assert\NotBlank]
        #[Assert\Length(min: 8)]
        #[Assert\PasswordStrength]
        public string $password,
    ) {}
}
```

## Security

### Prepared Statements (ALWAYS)

```php
declare(strict_types=1);

// NEVER: SQL injection vulnerability
$query = "SELECT * FROM users WHERE email = '$email'"; // DANGEROUS

// ALWAYS: Prepared statements with parameter binding
// PDO
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email AND active = :active');
$stmt->execute(['email' => $email, 'active' => 1]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

// Eloquent (automatically parameterized)
$user = User::where('email', $email)->where('active', true)->first();

// Query Builder
$user = DB::table('users')->where('email', '=', $email)->first();
```

### Password Hashing

```php
declare(strict_types=1);

// NEVER: Store plaintext or use MD5/SHA1
$hash = md5($password);     // INSECURE
$hash = sha1($password);    // INSECURE

// ALWAYS: Use password_hash with Argon2id (PHP 7.2+)
$hash = password_hash($password, PASSWORD_ARGON2ID, [
    'memory_cost' => 65536,  // 64 MB
    'time_cost' => 4,        // 4 iterations
    'threads' => 3,          // 3 threads
]);

// Verify
if (password_verify($inputPassword, $storedHash)) {
    // Authenticated
}

// Check if rehash needed (algorithm/cost changed)
if (password_needs_rehash($storedHash, PASSWORD_ARGON2ID)) {
    $newHash = password_hash($inputPassword, PASSWORD_ARGON2ID);
    // Update stored hash
}
```

### XSS Prevention

```php
declare(strict_types=1);

// NEVER: Echo unescaped user input
echo $userInput;            // XSS vulnerability
echo "<p>$name</p>";       // XSS vulnerability

// ALWAYS: Escape output
echo htmlspecialchars($userInput, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

// In Blade templates (Laravel) — auto-escaped
{{ $name }}          // Escaped (safe)
{!! $trustedHtml !!} // Unescaped (only for trusted content)

// In Twig (Symfony) — auto-escaped by default
{{ name }}           // Escaped (safe)
{{ name|raw }}       // Unescaped (only for trusted content)
```

### CSRF Protection

```php
// Laravel: Blade form with CSRF token
<form method="POST" action="/order">
    @csrf
    <!-- form fields -->
</form>

// Symfony: form with built-in CSRF
{{ form_start(form) }}
    {# CSRF token is automatically included #}
{{ form_end(form) }}

// API: Use token-based auth (Sanctum/JWT) instead of CSRF
```

## Null Coalescing vs Ternary

```php
declare(strict_types=1);

// Null coalescing (??) — use for default values when key/property might not exist
$name = $data['name'] ?? 'Anonymous';           // If null or undefined
$city = $user->address?->city ?? 'Unknown';     // Chain with nullsafe
$config = $_ENV['APP_DEBUG'] ?? false;

// Null coalescing assignment (??=) — set only if null
$options['timeout'] ??= 30;

// Ternary (?:) — use for falsy check (null, 0, '', false, [])
$display = $name ?: 'No name provided';          // '' would trigger default
$count = $items ?: [];                            // 0 or [] would trigger default

// Nullsafe operator (?->) — short-circuit on null
$zipCode = $user?->getAddress()?->getZipCode();  // null if any step is null
// Replaces: $user !== null && $user->getAddress() !== null ? $user->getAddress()->getZipCode() : null
```

## Error Handling

```php
declare(strict_types=1);

// NEVER: Suppress errors with @
$data = @file_get_contents($path); // Hides errors silently

// ALWAYS: Explicit try/catch
try {
    $data = file_get_contents($path);
    if ($data === false) {
        throw new RuntimeException("Failed to read file: {$path}");
    }
} catch (Throwable $e) {
    // Catch everything: Exception + Error
    logger()->error('File read failed', [
        'path' => $path,
        'error' => $e->getMessage(),
    ]);
    throw $e; // Re-throw or handle appropriately
}

// Custom exception hierarchy
class DomainException extends RuntimeException {}
class OrderNotFoundException extends DomainException
{
    public static function withId(int $id): self
    {
        return new self("Order #{$id} not found");
    }
}

// Laravel exception handler (app/Exceptions/Handler.php)
public function register(): void
{
    $this->renderable(function (OrderNotFoundException $e, Request $request) {
        if ($request->expectsJson()) {
            return response()->json(['error' => $e->getMessage()], 404);
        }
        return response()->view('errors.order-not-found', [], 404);
    });
}
```

## CI/CD Tooling Pipeline

```yaml
# GitHub Actions example
name: PHP CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.4'
          coverage: xdebug

      # 1. Static Analysis — catch type errors without running code
      - run: vendor/bin/phpstan analyse --level=10 src/

      # 2. Code Style — enforce consistent formatting
      - run: vendor/bin/php-cs-fixer fix --dry-run --diff

      # 3. Tests — verify behavior
      - run: vendor/bin/pest --coverage --min=80

      # 4. Automated Refactoring — check for upgrade opportunities
      - run: vendor/bin/rector process --dry-run

      # 5. Mutation Testing — verify test quality (optional, slow)
      - run: vendor/bin/infection --min-msi=70 --min-covered-msi=80
```

### PHPStan Configuration (phpstan.neon)

```neon
parameters:
    level: 10
    paths:
        - src
        - app
    excludePaths:
        - vendor
        - storage
    checkGenericClassInNonGenericObjectType: false
    reportUnmatchedIgnoredErrors: false
includes:
    - vendor/larastan/larastan/extension.neon  # Laravel support
```
